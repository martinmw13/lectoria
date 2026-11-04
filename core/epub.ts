// Client-safe EPUB reader: fflate plus an injected parser (jsdom in Node,
// the global DOMParser in the browser). No node imports, no env reads, so
// the home upload page can run it in the browser.
import { unzipSync } from "fflate";
import { cleanDeterministic } from "./clean";
import type { RawSection } from "./clean";
import { MIN_BOOK_WORDS } from "./upload-policy";

export const MAX_EPUB_BYTES = 20 * 1024 * 1024;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_INFLATED_BYTES = 60 * 1024 * 1024;
const MAX_ENTRIES = 10_000;

export type EpubErrorCode = "not_epub" | "too_large" | "drm" | "unreadable" | "empty" | "too_short";

export class EpubError extends Error {
  code: EpubErrorCode;
  constructor(code: EpubErrorCode) {
    super(code);
    this.name = "EpubError";
    this.code = code;
  }
}

export const EPUB_ERROR_MESSAGES: Record<EpubErrorCode, string> = {
  not_epub: "That doesn't look like an EPUB. Try a file that ends in .epub.",
  too_large: "That file is bigger than 20 MB. Most novels are far smaller, so try another edition.",
  drm: "This book is copy-protected, so we can't open it. Free classics from Project Gutenberg or Standard Ebooks work well.",
  unreadable: "We couldn't read this EPUB. It might be damaged. Try another copy.",
  empty: "That file is empty. Try another copy of the book.",
  too_short: "This EPUB looks empty or too short. It needs at least one page of text.",
};

export interface EpubBook {
  title: string;
  author: string | null;
  chapters: string[];
  words: number;
  cover: { bytes: Uint8Array; mediaType: string } | null;
}

export type XmlParser = (
  text: string,
  type: "application/xhtml+xml" | "text/html" | "application/xml",
) => Document;

function browserParse(
  text: string,
  type: "application/xhtml+xml" | "text/html" | "application/xml",
): Document {
  return new DOMParser().parseFromString(text, type);
}

const FONT_ALGORITHMS = new Set([
  "http://www.idpf.org/2008/embedding",
  "http://ns.adobe.com/pdf/enc#RC",
]);

const COVER_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const WORD_RE = /[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu;

const BLOCK_TAGS = new Set([
  "p",
  "div",
  "li",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "td",
  "dt",
  "dd",
  "pre",
  "figcaption",
]);

// Zip-bomb guard, checked in the inflate filter so big entries never load.
export function assertEntrySize(originalSize: number | undefined): void {
  if (typeof originalSize === "number" && originalSize > MAX_ENTRY_BYTES) {
    throw new EpubError("unreadable");
  }
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function clean(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function elsByLocal(scope: Document | Element, local: string): Element[] {
  const found = scope.getElementsByTagName("*");
  const out: Element[] = [];
  for (let i = 0; i < found.length; i++) {
    const el = found[i];
    if (el && el.localName === local) out.push(el);
  }
  return out;
}

function mustParse(parse: XmlParser, text: string, type: "application/xml"): Document {
  let doc: Document;
  try {
    doc = parse(text, type);
  } catch {
    throw new EpubError("unreadable");
  }
  if (doc.getElementsByTagName("parsererror").length > 0) throw new EpubError("unreadable");
  return doc;
}

// OPF hrefs resolve against the OPF directory; decode %20 and drop #fragments.
function resolveHref(opfPath: string, href: string): string {
  let path = href.split("#")[0] ?? "";
  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep the raw path when decoding fails.
  }
  const dir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const parts: string[] = [];
  for (const seg of (dir + path).split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

// META-INF/rights.xml means Adobe DRM. An encryption.xml that lists
// anything but font obfuscation means the content is encrypted.
function assertNoDrm(files: Record<string, Uint8Array>, parse: XmlParser): void {
  if ("META-INF/rights.xml" in files) throw new EpubError("drm");
  const enc = files["META-INF/encryption.xml"];
  if (enc === undefined) return;
  const doc = mustParse(parse, decode(enc), "application/xml");
  for (const method of elsByLocal(doc, "EncryptionMethod")) {
    if (!FONT_ALGORITHMS.has(method.getAttribute("Algorithm") ?? "")) throw new EpubError("drm");
  }
}

// First label wins: several nav entries can point at one file (the license
// entry may share the last chapter file), and the first in document order
// names the chapter.
function navLabels(doc: Document, keyOf: (href: string) => string): Map<string, string> {
  const labels = new Map<string, string>();
  const navs = elsByLocal(doc, "nav");
  const scope =
    navs.find((nav) => (nav.getAttribute("epub:type") ?? "").split(/\s+/).includes("toc")) ??
    navs[0] ??
    doc.documentElement;
  if (!scope) return labels;
  for (const a of elsByLocal(scope, "a")) {
    const href = a.getAttribute("href");
    if (href === null) continue;
    const key = keyOf(href.split("#")[0] ?? "");
    if (!labels.has(key)) labels.set(key, clean(a.textContent));
  }
  return labels;
}

function ncxLabels(doc: Document, keyOf: (href: string) => string): Map<string, string> {
  const labels = new Map<string, string>();
  for (const point of elsByLocal(doc, "navPoint")) {
    const label = elsByLocal(point, "navLabel")[0];
    const content = elsByLocal(point, "content")[0];
    const src = content?.getAttribute("src");
    if (label === undefined || src === undefined || src === null) continue;
    const key = keyOf(src.split("#")[0] ?? "");
    if (!labels.has(key)) labels.set(key, clean(elsByLocal(label, "text")[0]?.textContent));
  }
  return labels;
}

function epubTypes(el: Element): string[] {
  const raw = [el.getAttribute("epub:type"), el.getAttributeNS("http://www.idpf.org/2007/ops", "type")];
  const out: string[] = [];
  for (const value of raw) {
    if (value !== null) out.push(...value.split(/\s+/).filter((t) => t.length > 0));
  }
  return [...new Set(out)];
}

function spineBlocks(doc: Document): { text: string; heading: boolean }[] {
  for (const el of doc.querySelectorAll("script, style")) el.remove();
  for (const el of doc.querySelectorAll("[id]")) {
    const id = el.getAttribute("id") ?? "";
    if (id.startsWith("pg-") || id === "project-gutenberg-license") el.remove();
  }
  for (const br of doc.getElementsByTagName("br")) br.replaceWith(doc.createTextNode(" "));
  const blocks: { text: string; heading: boolean }[] = [];
  for (const el of doc.querySelectorAll("*")) {
    if (!BLOCK_TAGS.has(el.tagName.toLowerCase())) continue;
    if ([...el.querySelectorAll("*")].some((child) => BLOCK_TAGS.has(child.tagName.toLowerCase()))) continue;
    const text = clean(el.textContent);
    if (text.length === 0) continue;
    blocks.push({ text, heading: /^h[1-6]$/i.test(el.tagName) });
  }
  return blocks;
}

interface EpubPackage {
  mimetype: string;
  title: string;
  author: string | null;
  sections: RawSection[];
  cover: { bytes: Uint8Array; mediaType: string } | null;
}

// Counts every word; long books route to BYOK in the UI, never an error.
function countWords(text: string, start: number): number {
  WORD_RE.lastIndex = 0;
  let count = start;
  let match: RegExpExecArray | null;
  while ((match = WORD_RE.exec(text)) !== null && match[0].length > 0) {
    count += 1;
  }
  return count;
}

function parseSpineDoc(parse: XmlParser, text: string): Document | null {
  let doc: Document;
  try {
    doc = parse(text, "application/xhtml+xml");
  } catch {
    doc = parse(text, "text/html");
    return doc;
  }
  if (doc.getElementsByTagName("parsererror").length > 0) {
    try {
      return parse(text, "text/html");
    } catch {
      return null;
    }
  }
  return doc;
}

function openEpub(
  bytes: Uint8Array,
  parse: XmlParser,
  opts: { checkMimetype: boolean; strictSpine: boolean },
): EpubPackage {
  if (bytes.length === 0) throw new EpubError("empty");
  if (bytes.length > MAX_EPUB_BYTES) throw new EpubError("too_large");
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    throw new EpubError("not_epub");
  }
  // Zip-bomb guards run in the filter, before anything inflates: fflate
  // inflates each entry into a buffer of its declared size, so the
  // declared sizes bound memory. Too many entries or too much declared
  // output rejects the whole file; one oversize entry is skipped.
  let files: Record<string, Uint8Array>;
  let entries = 0;
  let declared = 0;
  try {
    files = unzipSync(bytes, {
      filter: (entry) => {
        entries += 1;
        if (entries > MAX_ENTRIES) throw new EpubError("too_large");
        if (typeof entry.originalSize === "number" && entry.originalSize > MAX_ENTRY_BYTES) return false;
        declared += entry.originalSize ?? 0;
        if (declared > MAX_INFLATED_BYTES) throw new EpubError("too_large");
        return true;
      },
    }) as Record<string, Uint8Array>;
  } catch (e) {
    if (e instanceof EpubError) throw e;
    throw new EpubError("not_epub");
  }
  let total = 0;
  for (const data of Object.values(files)) total += data.length;
  if (total > MAX_INFLATED_BYTES) throw new EpubError("too_large");
  const mimetypeRaw = files["mimetype"];
  const mimetype = mimetypeRaw ? clean(decode(mimetypeRaw)) : "";
  // The browser entry point rejects wrong mimetype first, like task 20 did;
  // the section reader skips the check so pipeline fixtures need no mimetype.
  if (opts.checkMimetype && mimetype !== "application/epub+zip") throw new EpubError("not_epub");
  assertNoDrm(files, parse);
  if (!("META-INF/container.xml" in files)) throw new EpubError("not_epub");
  const containerText = decode(files["META-INF/container.xml"] as Uint8Array);
  const opfPath = elsByLocal(mustParse(parse, containerText, "application/xml"), "rootfile")[0]?.getAttribute(
    "full-path",
  );
  const opfRaw = opfPath !== undefined && opfPath !== null ? files[opfPath] : undefined;
  // No package document means this zip is not an EPUB.
  if (opfPath === undefined || opfPath === null || opfRaw === undefined) throw new EpubError("not_epub");
  const opf = mustParse(parse, decode(opfRaw), "application/xml");

  const metadata = elsByLocal(opf, "metadata")[0];
  let title = "Untitled";
  let author: string | null = null;
  if (metadata) {
    const dcTitle =
      metadata.getElementsByTagNameNS("http://purl.org/dc/elements/1.1/", "title")[0]?.textContent ??
      elsByLocal(metadata, "title")[0]?.textContent;
    const cleaned = clean(dcTitle);
    if (cleaned) title = cleaned;
    const dcCreator =
      metadata.getElementsByTagNameNS("http://purl.org/dc/elements/1.1/", "creator")[0]?.textContent ??
      elsByLocal(metadata, "creator")[0]?.textContent;
    const cleanedAuthor = clean(dcCreator);
    author = cleanedAuthor ? cleanedAuthor : null;
  }

  const manifest = new Map<string, { href: string; mediaType: string; properties: string }>();
  for (const item of elsByLocal(elsByLocal(opf, "manifest")[0] ?? opf, "item")) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id && href) {
      manifest.set(id, {
        href: resolveHref(opfPath, href),
        mediaType: item.getAttribute("media-type") ?? "",
        properties: item.getAttribute("properties") ?? "",
      });
    }
  }
  const spineEl = elsByLocal(opf, "spine")[0];
  const tocId = spineEl?.getAttribute("toc") ?? "";
  const spineRefs = elsByLocal(opf, "itemref").map((ref) => ({
    idref: ref.getAttribute("idref") ?? "",
    linear: ref.getAttribute("linear") !== "no",
  }));

  let labels = new Map<string, string>();
  // Nav hrefs resolve against the OPF directory, like manifest hrefs.
  const keyOf = (href: string): string => resolveHref(opfPath, href);
  const tocItem = tocId ? manifest.get(tocId) : undefined;
  const ncxEntry = tocItem ?? [...manifest.values()].find((item) => /\.ncx$/i.test(item.href));
  const navEntry = [...manifest.values()].find((item) => item.properties.split(/\s+/).includes("nav"));
  for (const entry of [navEntry, ncxEntry]) {
    if (entry === undefined) continue;
    const raw = files[entry.href];
    if (raw === undefined) continue;
    let doc: Document;
    try {
      doc = parse(decode(raw), entry === navEntry ? "application/xhtml+xml" : "application/xml");
    } catch {
      continue;
    }
    labels = entry === navEntry ? navLabels(doc, keyOf) : ncxLabels(doc, keyOf);
    if (labels.size > 0) break;
  }

  let cover: EpubPackage["cover"] = null;
  let coverPath: string | null = null;
  let coverType = "";
  for (const item of manifest.values()) {
    if (item.properties.split(/\s+/).includes("cover-image")) {
      coverPath = item.href;
      coverType = item.mediaType;
    }
  }
  if (!coverPath) {
    const coverId = elsByLocal(opf, "meta").find((m) => m.getAttribute("name") === "cover")?.getAttribute("content");
    const coverItem = coverId ? manifest.get(coverId) : undefined;
    if (coverItem) {
      coverPath = coverItem.href;
      coverType = coverItem.mediaType;
    }
  }
  if (coverPath && COVER_TYPES.has(coverType)) {
    const raw = files[coverPath];
    if (raw) cover = { bytes: raw, mediaType: coverType };
  }

  const sections: RawSection[] = [];
  for (const ref of spineRefs) {
    const manifestItem = manifest.get(ref.idref);
    if (manifestItem === undefined) throw new EpubError("unreadable");
    // Non-document spine entries (audio, video) carry no chapter text.
    if (
      manifestItem.mediaType !== "" &&
      manifestItem.mediaType !== "application/xhtml+xml" &&
      manifestItem.mediaType !== "text/html"
    ) {
      continue;
    }
    const name = manifestItem.href;
    const data = files[name];
    // The browser entry point skips unreadable spine docs, like task 20
    // did; the section reader throws so the pipeline fails loudly.
    if (data === undefined) {
      if (opts.strictSpine) throw new EpubError("unreadable");
      continue;
    }
    const text = decode(data);
    const doc = parseSpineDoc(parse, text);
    if (doc === null) {
      if (!opts.strictSpine) continue;
      sections.push({
        id: name,
        href: manifestItem.href,
        linear: ref.linear,
        types: [],
        docTitle: null,
        navLabel: labels.get(manifestItem.href) ?? null,
        blocks: [],
      });
      continue;
    }
    const body = elsByLocal(doc, "body")[0] ?? doc.documentElement;
    const types = body ? epubTypes(body) : [];
    if (body) {
      for (const child of [...body.children]) {
        if (["section", "article", "div"].includes(child.tagName.toLowerCase())) {
          types.push(...epubTypes(child));
        }
      }
    }
    const titleEl = elsByLocal(doc, "title")[0];
    const docTitle = titleEl === undefined ? null : clean(titleEl.textContent) || null;
    sections.push({
      id: name,
      href: manifestItem.href,
      linear: ref.linear,
      types: [...new Set(types)],
      docTitle,
      navLabel: labels.get(manifestItem.href) ?? null,
      blocks: spineBlocks(doc),
    });
  }
  // A spine with no readable documents has no text to read.
  if (sections.length === 0) throw new EpubError("too_short");

  return { mimetype, title, author, sections, cover };
}

export function readEpubSections(
  bytes: Uint8Array,
  parse: XmlParser = browserParse,
): Pick<EpubPackage, "title" | "author" | "sections"> {
  const { title, author, sections } = openEpub(bytes, parse, { checkMimetype: false, strictSpine: true });
  return { title, author, sections };
}

export interface EpubParse {
  book: EpubBook;
  sections: RawSection[];
}

// The upload POSTs the same sections the card counts, parsed once.
// Rejects books under about one page of kept text (MIN_BOOK_WORDS); the
// server re-checks the same count on the cleaned sections.
export function parseEpubWithSections(bytes: Uint8Array, minWords: number = MIN_BOOK_WORDS): EpubParse {
  const { title, author, sections, cover } = openEpub(bytes, browserParse, {
    checkMimetype: true,
    strictSpine: false,
  });
  const { chapters } = cleanDeterministic(title, sections);
  let words = 0;
  const kept = chapters.slice(0, 500);
  for (const chapter of kept) {
    for (const paragraph of chapter.paragraphs) words = countWords(paragraph, words);
  }
  if (kept.length === 0 || words < minWords) throw new EpubError("too_short");
  return { book: { title, author, chapters: kept.map((chapter) => chapter.title), words, cover }, sections };
}

// Parse only, no length floor (fixtures and previews).
export function parseEpub(bytes: Uint8Array): EpubBook {
  return parseEpubWithSections(bytes, 0).book;
}

// Cheap checks on the File (size, zip signature) run before reading it all.
async function assertLooksLikeEpub(file: File): Promise<void> {
  if (typeof file.slice !== "function") return;
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (head[0] !== 0x50 || head[1] !== 0x4b || head[2] !== 0x03 || head[3] !== 0x04) throw new EpubError("not_epub");
}

export async function readEpubFile(file: File): Promise<EpubBook> {
  if (file.size === 0) throw new EpubError("empty");
  if (file.size > MAX_EPUB_BYTES) throw new EpubError("too_large");
  return parseEpub(new Uint8Array(await file.arrayBuffer()));
}

export async function readEpubFileWithSections(file: File): Promise<EpubParse> {
  if (file.size === 0) throw new EpubError("empty");
  if (file.size > MAX_EPUB_BYTES) throw new EpubError("too_large");
  await assertLooksLikeEpub(file);
  return parseEpubWithSections(new Uint8Array(await file.arrayBuffer()));
}
