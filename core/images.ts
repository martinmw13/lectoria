// Pure image logic: validation, cache keys, prompts, quota and budget
// helpers. No env reads, no network, no secrets. Server modules inject
// the KV, store, and generator clients defined here.
import { hasDenslowLook } from "./book-capabilities";
import {
  ImageValidationError,
  parseStyleChoice,
  styleDescriptorLine,
  styleSegment,
} from "./image-style";
import type { ImageStyle, StyleBook } from "./image-style";
import { guardLine, sentence, stripColorWords, stylePromptFor } from "./style-prompts";
import { CHAPTER_PROMPT_VERSION, IMAGE_COST_MICRO, PROMPT_VERSION } from "./types";
import type { ImageKind, ImageRequest } from "./types";

export type { ImageErrorCode, ImageKind, ImageRequest, ImageResponse, KV } from "./types";
import type { KV } from "./types";
export { ImageStyleError, ImageValidationError } from "./image-style";
export type { ImageStyle, ImageStylePresetId, StyleBook, StyleChoice } from "./image-style";

export const DAILY_IMAGE_LIMIT = 5;
export const QUOTA_TTL_SEC = 48 * 3600;
// Body cap for the image route; the guard reader enforces it.
export const MAX_IMAGE_BODY_BYTES = 8192 as const;
export const LOCK_TTL_SEC = 150;
export const MAX_PASSAGE_CHARS = 600;
export const MAX_SCENE_CLIP_CHARS = 1200;

export const MSG_BAD_REQUEST = "Something went wrong there. Try again?";
export const MSG_QUOTA = "That's all five pictures for today. More tomorrow.";
export const MSG_CREDITS_OUT =
  "So many people loved this that we've run out of credits to share. " +
  "Feel free to bring your own key! Meanwhile, your book " +
  "is ready to read, with its soundtrack and illustrations.";
export const CREDITS_OUT_LIBRARY_HREF = "/";
export const MSG_UNAVAILABLE = "Pictures aren't available right now.";
export const MSG_FAILED = "That picture didn't come out. Try again?";
export const MSG_RETRY = "This one is taking a while. Try again in a moment.";
export const MSG_HUMAN = "One quick check that you're a person first.";
export const MSG_STYLE = "That style won't work here. Try another?";
// Never the provider's own words: those can echo request details.
export const MSG_BYOK_IMAGES =
  "Your key couldn't make this picture. Pictures need a Meta key with image access.";

export interface ImageStore {
  findUrl(path: string): Promise<string | null>;
  save(path: string, bytes: Uint8Array): Promise<string>;
}

export interface ImageGenerator {
  generate(prompt: string): Promise<Uint8Array>;
}

function isRecord(json: unknown): json is Record<string, unknown> {
  return typeof json === "object" && json !== null && !Array.isArray(json);
}

// Strict parse at the trust boundary: exact fields only, so a client
// bug cannot silently spend budget on a misread request.
export function parseImageRequest(json: unknown): ImageRequest {
  if (!isRecord(json)) throw new ImageValidationError();
  const { kind } = json;
  // The token is single-use proof, never part of imageKey.
  if (
    json.turnstileToken !== undefined &&
    (typeof json.turnstileToken !== "string" || json.turnstileToken.length > 2048)
  ) {
    throw new ImageValidationError();
  }
  const token = typeof json.turnstileToken === "string" ? json.turnstileToken : undefined;
  if (kind === "passage") {
    const keys = Object.keys(json).sort().join(",");
    if (
      keys !== "bookId,kind,n,textVersion" &&
      keys !== "bookId,kind,n,style,textVersion" &&
      keys !== "bookId,endN,kind,n,textVersion" &&
      keys !== "bookId,endN,kind,n,style,textVersion" &&
      keys !== "bookId,kind,n,textVersion,turnstileToken" &&
      keys !== "bookId,kind,n,style,textVersion,turnstileToken" &&
      keys !== "bookId,endN,kind,n,textVersion,turnstileToken" &&
      keys !== "bookId,endN,kind,n,style,textVersion,turnstileToken"
    ) {
      throw new ImageValidationError();
    }
    if (typeof json.bookId !== "string" || json.bookId.length === 0) throw new ImageValidationError();
    if (typeof json.textVersion !== "string" || json.textVersion.length === 0) {
      throw new ImageValidationError();
    }
    if (typeof json.n !== "number" || !Number.isInteger(json.n)) throw new ImageValidationError();
    const endN = json.endN;
    if (endN !== undefined && (typeof endN !== "number" || !Number.isInteger(endN))) {
      throw new ImageValidationError();
    }
    const style = parseStyleChoice(json.style);
    return {
      kind: "passage",
      bookId: json.bookId,
      textVersion: json.textVersion,
      n: json.n,
      ...(endN === undefined ? {} : { endN }),
      ...(style === undefined ? {} : { style }),
      ...(token === undefined ? {} : { turnstileToken: token }),
    };
  }
  if (kind === "scene") {
    const keys = Object.keys(json).sort().join(",");
    if (
      keys !== "bookId,kind,sceneId,textVersion" &&
      keys !== "bookId,kind,sceneId,style,textVersion" &&
      keys !== "bookId,kind,sceneId,textVersion,turnstileToken" &&
      keys !== "bookId,kind,sceneId,style,textVersion,turnstileToken"
    ) {
      throw new ImageValidationError();
    }
    if (typeof json.bookId !== "string" || json.bookId.length === 0) throw new ImageValidationError();
    if (typeof json.textVersion !== "string" || json.textVersion.length === 0) {
      throw new ImageValidationError();
    }
    if (typeof json.sceneId !== "string" || json.sceneId.length === 0) throw new ImageValidationError();
    const style = parseStyleChoice(json.style);
    return {
      kind: "scene",
      bookId: json.bookId,
      textVersion: json.textVersion,
      sceneId: json.sceneId,
      ...(style === undefined ? {} : { style }),
      ...(token === undefined ? {} : { turnstileToken: token }),
    };
  }
  if (kind === "chapter") {
    const keys = Object.keys(json).sort().join(",");
    if (
      keys !== "bookId,ch,kind,reachedCh,textVersion" &&
      keys !== "bookId,ch,kind,reachedCh,style,textVersion" &&
      keys !== "bookId,ch,kind,reachedCh,textVersion,turnstileToken" &&
      keys !== "bookId,ch,kind,reachedCh,style,textVersion,turnstileToken"
    ) {
      throw new ImageValidationError();
    }
    if (typeof json.bookId !== "string" || json.bookId.length === 0) throw new ImageValidationError();
    if (typeof json.textVersion !== "string" || json.textVersion.length === 0) {
      throw new ImageValidationError();
    }
    if (typeof json.ch !== "number" || !Number.isInteger(json.ch) || json.ch < 1) {
      throw new ImageValidationError();
    }
    if (typeof json.reachedCh !== "number" || !Number.isInteger(json.reachedCh) || json.reachedCh < 1) {
      throw new ImageValidationError();
    }
    const style = parseStyleChoice(json.style);
    return {
      kind: "chapter",
      bookId: json.bookId,
      textVersion: json.textVersion,
      ch: json.ch,
      reachedCh: json.reachedCh,
      ...(style === undefined ? {} : { style }),
      ...(token === undefined ? {} : { turnstileToken: token }),
    };
  }
  throw new ImageValidationError();
}

export interface BookRef {
  id: string;
  textVersion: string;
  paragraphNs: Set<number>;
  sceneIds: Set<string>;
  chapters: Set<number>;
}

// Checks the parsed request against the frozen book text.
export function validateAgainstBook(req: ImageRequest, book: BookRef): void {
  if (req.bookId !== book.id) throw new ImageValidationError();
  if (req.textVersion !== book.textVersion) throw new ImageValidationError();
  if (req.kind === "passage") {
    if (!book.paragraphNs.has(req.n)) throw new ImageValidationError();
    if (req.endN !== undefined && (req.endN < req.n || !book.paragraphNs.has(req.endN))) {
      throw new ImageValidationError();
    }
    return;
  }
  if (req.kind === "scene") {
    if (!book.sceneIds.has(req.sceneId)) throw new ImageValidationError();
    return;
  }
  if (!book.chapters.has(req.ch)) throw new ImageValidationError();
  if (!book.chapters.has(req.reachedCh) || req.ch > req.reachedCh) {
    throw new ImageValidationError();
  }
}

// One paragraph maps to one image; one scene maps to one image; one
// chapter maps to one comic page. A styled image keeps the same base with
// a style segment before the file name, so an omitted style keys
// byte-identically to today. A multi-paragraph passage keeps pN when endN
// is absent or equals n, so old images keep hitting; a wider range gets
// pN-M.
export function imageKey(req: ImageRequest): string {
  const base = `images/${req.bookId}/${req.textVersion}/${PROMPT_VERSION}`;
  const file =
    req.kind === "passage"
      ? req.endN === undefined || req.endN === req.n
        ? `p${req.n}.webp`
        : `p${req.n}-${req.endN}.webp`
      : req.kind === "scene"
        ? `scene-${req.sceneId}.webp`
        : `chapter-${req.ch}-${CHAPTER_PROMPT_VERSION}.webp`;
  return req.style === undefined ? `${base}/${file}` : `${base}/${styleSegment(req.style)}/${file}`;
}

export function indexKeyFor(key: string): string {
  return `img:index:${key}`;
}

export function lockKeyFor(key: string): string {
  return `img:lock:${key}`;
}

// Runs fn while holding the image lock; a concurrent holder gets null
// instead of generating the same image twice. The lock always releases,
// so a throw never wedges the key until TTL.
export async function withImageLock<T>(
  kv: KV,
  key: string,
  token: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  if (!(await kv.setNxEx(lockKeyFor(key), token, LOCK_TTL_SEC))) return null;
  try {
    return await fn();
  } finally {
    try {
      await kv.releaseIfToken(lockKeyFor(key), token);
    } catch {
      // Lock expires on its own; nothing to do.
    }
  }
}

export function quotaKeys(args: { day: string; ipHash: string; anonId: string }): {
  ip: string;
  anon: string;
} {
  return {
    ip: `img:quota:ip:${args.day}:${args.ipHash}`,
    anon: `img:quota:anon:${args.day}:${args.anonId}`,
  };
}

export function overQuota(count: number): boolean {
  return count > DAILY_IMAGE_LIMIT;
}

export function imageCostMicro(): number {
  return IMAGE_COST_MICRO;
}

// Lets the route compare lock tokens without touching Redis twice.
export function canRelease(expected: string, actual: string | null): boolean {
  return actual !== null && actual === expected;
}

export function clipText(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max).trimEnd();
}

// Trusted book.json text, still stripped of control chars for the prompt.
function cleanBookField(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
}

// The illustration style line, shared by scene and chapter prompts: Oz
// keeps the Denslow sentence by default, the parsed style's descriptor
// otherwise; other books get the generic period-faithful line.
export function styleLine(style: ImageStyle | undefined, book?: StyleBook): string {
  if (style !== undefined) return styleDescriptorLine(style, book);
  if (book === undefined || hasDenslowLook(book.id)) {
    return (
      "Illustration in the style of W. W. Denslow's 1900 first-edition " +
      "illustrations for The Wonderful Wizard of Oz: flat color, bold black " +
      "ink outlines, limited palette. Dorothy wears silver shoes. Nothing " +
      "from the 1939 MGM film, no ruby slippers, no film look. No text, " +
      "no captions, no lettering in the image."
    );
  }
  const title = cleanBookField(book.title);
  const author = cleanBookField(book.author);
  return (
    `Classic book illustration for ${title} by ${author}: ink and watercolor, ` +
    `faithful to the book's own text and period, not any film or TV adaptation. ` +
    `No text, no captions, no lettering in the image.`
  );
}

// Base prompt from trusted server-side book text only. The client sends
// ordinals and ids, never free text, so there is no injection path. Only
// the optional parsed style reaches the prompt, never raw client text.
// Styles with an approved prompt get the structured form with the
// validated, clipped bookmap reference before the style reminder; the
// rest keep the legacy descriptor line with the reference appended.
export function buildPrompt(args: {
  kind: Exclude<ImageKind, "chapter">;
  passageText: string;
  sceneTitle: string;
  sceneClip: string;
  style?: ImageStyle;
  book?: StyleBook;
  reference?: string;
}): string {
  const prompt = stylePromptFor(args.style, args.book);
  if (prompt !== undefined) {
    const content =
      args.kind === "scene"
        ? [sentence(clipText(args.sceneClip, MAX_SCENE_CLIP_CHARS))]
        : [
            `Passage: ${sentence(clipText(args.passageText, MAX_PASSAGE_CHARS))}`,
            `Context: ${sentence(clipText(args.sceneClip, MAX_SCENE_CLIP_CHARS))}`,
          ];
    return [
      `STYLE: ${prompt.lead}`,
      prompt.composition,
      `CONTENT: Scene "${args.sceneTitle}".`,
      ...content,
      referencePart(args.reference, prompt.monochrome),
      `STYLE REMINDER: the whole image is drawn in this one style. ${prompt.reminder}`,
      guardLine(args.book),
    ]
      .filter((p) => p !== "")
      .join(" ");
  }
  const style = styleLine(args.style, args.book);
  const base =
    args.kind === "scene"
      ? `Scene "${args.sceneTitle}". ${sentence(clipText(args.sceneClip, MAX_SCENE_CLIP_CHARS))} ${style}`
      : `Scene "${args.sceneTitle}". Passage: ${sentence(clipText(args.passageText, MAX_PASSAGE_CHARS))} ` +
        `Context: ${sentence(clipText(args.sceneClip, MAX_SCENE_CLIP_CHARS))} ${style}`;
  return args.reference ? `${base} ${args.reference}` : base;
}

// Reference block for the structured form: monochrome styles drop hue
// words so the book's colors do not leak into a grayscale drawing.
export function referencePart(reference: string | undefined, monochrome: boolean): string {
  if (!reference) return "";
  const text = monochrome ? stripColorWords(reference).trim() : reference;
  return text;
}

export function buildCaption(args: {
  kind: ImageKind;
  sceneTitle: string;
  passageText: string;
}): string {
  if (args.kind === "scene" || args.kind === "chapter") return args.sceneTitle;
  const words = args.passageText.replace(/\s+/g, " ").trim().split(" ").slice(0, 10);
  const head = words.join(" ");
  return words.length >= 10 ? `${head}…` : head;
}

// In-memory KV for tests. Expiries are checked against Date.now.
export function createMemoryKV(): KV & { clear(): void } {
  const values = new Map<string, string>();
  const expiresAt = new Map<string, number>();
  function live(key: string): boolean {
    const until = expiresAt.get(key);
    if (until !== undefined && Date.now() >= until) {
      values.delete(key);
      expiresAt.delete(key);
      return false;
    }
    return true;
  }
  function num(key: string): number {
    return Number(values.get(key) ?? "0");
  }
  return {
    async get(key: string): Promise<string | null> {
      if (!live(key)) return null;
      return values.get(key) ?? null;
    },
    async setNxEx(key: string, value: string, exSec: number): Promise<boolean> {
      if (live(key) && values.has(key)) return false;
      values.set(key, value);
      expiresAt.set(key, Date.now() + exSec * 1000);
      return true;
    },
    async set(key: string, value: string): Promise<void> {
      values.set(key, value);
      expiresAt.delete(key);
    },
    async incr(key: string): Promise<number> {
      const next = num(key) + 1;
      values.set(key, String(next));
      return next;
    },
    async incrBy(key: string, by: number): Promise<number> {
      const next = num(key) + by;
      values.set(key, String(next));
      return next;
    },
    async decr(key: string): Promise<number> {
      const next = num(key) - 1;
      values.set(key, String(next));
      return next;
    },
    async decrBy(key: string, by: number): Promise<number> {
      const next = num(key) - by;
      values.set(key, String(next));
      return next;
    },
    async expire(key: string, sec: number): Promise<void> {
      if (values.has(key)) expiresAt.set(key, Date.now() + sec * 1000);
    },
    async releaseIfToken(key: string, token: string): Promise<boolean> {
      if (!live(key)) return false;
      if (values.get(key) !== token) return false;
      values.delete(key);
      expiresAt.delete(key);
      return true;
    },
    clear(): void {
      values.clear();
      expiresAt.clear();
    },
  };
}
