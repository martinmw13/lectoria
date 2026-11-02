// Pure upload contract: limits, ids, strict parsing, word counts, part
// splitting, key builders, error codes. No env reads, no network, no
// secrets. Server modules in server/uploads/ build on it.
import type { RawSection } from "./clean-types";
import { BYOK_BOOK_MAX_WORDS, FREE_BOOK_MAX_WORDS } from "./upload-policy";

export { BYOK_BOOK_MAX_WORDS, FREE_BOOK_MAX_WORDS };
// Under the Hobby 4.5 MB request limit with JSON overhead to spare.
export const UPLOAD_MAX_BODY_BYTES = 4_000_000;
export const UPLOAD_STEP_BODY_BYTES = 4096;
export const UPLOAD_MAX_SECTIONS = 600;
export const UPLOAD_MAX_BLOCKS_PER_SECTION = 2000;
export const UPLOAD_MAX_BLOCK_CHARS = 20_000;
export const UPLOAD_MAX_TITLE_CHARS = 300;
export const UPLOAD_MAX_CHAPTERS = 500;
// One part fits one segment call plus its scenes inside the route budget.
export const UPLOAD_MAX_PART_PARAGRAPHS = 150;
// Global free-upload spend: USD 1 per UTC day, shared across readers.
export const UPLOAD_DAILY_SPEND_CAP_MICRO = 1_000_000;
// Ceiling on the per-book hold; the real cost reconciles at finalize.
export const UPLOAD_RESERVE_MICRO = 250_000;
// Friend books run longer, so their hold gets a higher ceiling.
export const FRIEND_UPLOAD_RESERVE_MICRO = 500_000;
export const UPLOAD_RESERVE_FLOOR_MICRO = 50_000;
export const UPLOAD_RESERVE_PER_PART_MICRO = 5_000;

// Measured: a 3,955-word book cost USD 0.0027 (~0.7 micro/word). The hold
// prices 1 micro/word plus 5k micro/part for the judge and retries, so a
// 50k-word book holds ~110k micro, well under the USD 1/day cap. A
// 250k-word friend book costs ~175k micro, but its sized hold is
// ~350k, so friend books hold against the higher friend ceiling.
export function uploadReserveMicro(parts: number, words: number, ceiling = UPLOAD_RESERVE_MICRO): number {
  const sized = Math.max(UPLOAD_RESERVE_FLOOR_MICRO, parts * UPLOAD_RESERVE_PER_PART_MICRO + Math.max(0, Math.round(words)));
  return Math.min(ceiling, sized);
}
export const UPLOAD_TTL_DAYS = 30;
export const UPLOAD_JOB_TTL_SEC = 30 * 24 * 3600;
export const UPLOAD_MODEL = "muse-spark-1.3-contributor";
export const UPLOAD_JEV_MODEL = "jev-1.14.0";

export type UploadErrorCode =
  | "too_long"
  | "daily_books_reached"
  | "daily_budget_reached"
  | "human_required"
  | "bad_request"
  | "unavailable"
  | "not_found"
  | "expired";

export const UPLOAD_MESSAGES: Record<UploadErrorCode, string> = {
  too_long: "This one is longer than the free book covers. With your own Meta key you can still read it with a soundtrack.",
  daily_books_reached: "That's your free book for today. More tomorrow, or use your own key for this one.",
  daily_budget_reached: "So many people loved this that we've run out of credits to share today. Try again tomorrow, or bring your own key.",
  human_required: "One quick check that you're a person first.",
  bad_request: "Something went wrong there. Try again?",
  unavailable: "We couldn't process this book right now. Try again in a moment.",
  not_found: "We couldn't find this upload. It may have expired.",
  expired: "This upload expired after 30 days. Upload the book again to read it.",
};

export const UPLOAD_HTTP_STATUS: Record<UploadErrorCode, number> = {
  too_long: 413,
  daily_books_reached: 429,
  daily_budget_reached: 503,
  human_required: 403,
  bad_request: 400,
  unavailable: 503,
  not_found: 404,
  expired: 410,
};

export class UploadValidationError extends Error {
  constructor(message = "invalid upload request") {
    super(message);
    this.name = "UploadValidationError";
  }
}

// 128-bit random, base64url without padding (22 chars), prefixed so ids
// never collide with paragraph or scene ids.
export const UPLOAD_ID_RE = /^u-[A-Za-z0-9_-]{22}$/;

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function newUploadId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let out = "u-";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += B64URL[(value >> bits) & 63];
    }
  }
  if (bits > 0) out += B64URL[(value << (6 - bits)) & 63];
  return out;
}

export function isUploadId(id: unknown): id is string {
  return typeof id === "string" && UPLOAD_ID_RE.test(id);
}

export function parseUploadId(id: unknown): string {
  if (!isUploadId(id)) throw new UploadValidationError("bad upload id");
  return id;
}

export interface UploadCreateBody {
  title: string;
  author: string | null;
  sections: RawSection[];
  turnstileToken?: string;
  friendCode?: string;
}

// Optional friend code on the create body: checked server-side only,
// never logged or echoed back. Longer than this is rejected outright.
export const FRIEND_CODE_MAX_LEN = 64;

function isRecord(json: unknown): json is Record<string, unknown> {
  return typeof json === "object" && json !== null && !Array.isArray(json);
}

function isStringArray(value: unknown, maxItems: number, maxChars: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every((t) => typeof t === "string" && t.length <= maxChars)
  );
}

// Strict parse at the trust boundary: exact fields only, defensive caps on
// every list and string, so a bad client cannot push unbounded work in.
export function parseUploadCreate(json: unknown): UploadCreateBody {
  if (!isRecord(json)) throw new UploadValidationError();
  const keys = Object.keys(json).sort().join(",");
  const base = "author,sections,title";
  if (
    keys !== base &&
    keys !== "sections,title" &&
    keys !== `${base},turnstileToken` &&
    keys !== "sections,title,turnstileToken" &&
    keys !== "author,friendCode,sections,title" &&
    keys !== "friendCode,sections,title" &&
    keys !== "author,friendCode,sections,title,turnstileToken" &&
    keys !== "friendCode,sections,title,turnstileToken"
  ) {
    throw new UploadValidationError();
  }
  const title = json.title;
  if (typeof title !== "string" || title.trim().length === 0 || title.length > UPLOAD_MAX_TITLE_CHARS) {
    throw new UploadValidationError();
  }
  const author = json.author;
  if (author !== undefined && author !== null && (typeof author !== "string" || author.length > UPLOAD_MAX_TITLE_CHARS)) {
    throw new UploadValidationError();
  }
  const sections = json.sections;
  if (!Array.isArray(sections) || sections.length === 0 || sections.length > UPLOAD_MAX_SECTIONS) {
    throw new UploadValidationError();
  }
  const parsed: RawSection[] = sections.map((sec) => {
    if (!isRecord(sec)) throw new UploadValidationError();
    if (Object.keys(sec).sort().join(",") !== "blocks,docTitle,href,id,linear,navLabel,types") {
      throw new UploadValidationError();
    }
    if (typeof sec.id !== "string" || sec.id.length === 0 || sec.id.length > UPLOAD_MAX_TITLE_CHARS) {
      throw new UploadValidationError();
    }
    if (typeof sec.href !== "string" || sec.href.length > 2000) throw new UploadValidationError();
    if (typeof sec.linear !== "boolean") throw new UploadValidationError();
    if (!isStringArray(sec.types, 20, 100)) throw new UploadValidationError();
    for (const key of ["docTitle", "navLabel"] as const) {
      const value = sec[key];
      if (value !== null && (typeof value !== "string" || value.length > UPLOAD_MAX_TITLE_CHARS)) {
        throw new UploadValidationError();
      }
    }
    if (!Array.isArray(sec.blocks) || sec.blocks.length > UPLOAD_MAX_BLOCKS_PER_SECTION) {
      throw new UploadValidationError();
    }
    const blocks = sec.blocks.map((block) => {
      if (!isRecord(block)) throw new UploadValidationError();
      if (Object.keys(block).sort().join(",") !== "heading,text") throw new UploadValidationError();
      if (typeof block.text !== "string" || block.text.length > UPLOAD_MAX_BLOCK_CHARS) {
        throw new UploadValidationError();
      }
      if (typeof block.heading !== "boolean") throw new UploadValidationError();
      return { text: block.text, heading: block.heading };
    });
    return {
      id: sec.id,
      href: sec.href,
      linear: sec.linear,
      types: sec.types as string[],
      docTitle: sec.docTitle as string | null,
      navLabel: sec.navLabel as string | null,
      blocks,
    };
  });
  const out: UploadCreateBody = {
    title: title.trim(),
    author: typeof author === "string" && author.trim() !== "" ? author.trim() : null,
    sections: parsed,
  };
  if (json.turnstileToken !== undefined) {
    if (typeof json.turnstileToken !== "string" || json.turnstileToken.length > 2048) {
      throw new UploadValidationError();
    }
    out.turnstileToken = json.turnstileToken;
  }
  if (json.friendCode !== undefined) {
    if (typeof json.friendCode !== "string" || json.friendCode.length > FRIEND_CODE_MAX_LEN) {
      throw new UploadValidationError();
    }
    out.friendCode = json.friendCode;
  }
  return out;
}

// Same word shape the browser counts for routing, so the server enforces
// the limit the client promised.
const WORD_RE = /[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu;

export function countWords(text: string): number {
  WORD_RE.lastIndex = 0;
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = WORD_RE.exec(text)) !== null && match[0].length > 0) count += 1;
  return count;
}

export function countChapterWords(chapters: { paragraphs: string[] }[]): number {
  let total = 0;
  for (const chapter of chapters) {
    for (const paragraph of chapter.paragraphs) total += countWords(paragraph);
  }
  return total;
}

export interface UploadPart {
  ch: number;
  part: number;
  startN: number;
  endN: number;
}

export function partKey(part: Pick<UploadPart, "ch" | "part">): string {
  return `ch${part.ch}p${part.part}`;
}

// Long chapters split into paragraph windows so one step stays in budget.
export function splitChapterParts(
  chapters: { ch: number; start_n: number; end_n: number }[],
  maxParas: number = UPLOAD_MAX_PART_PARAGRAPHS,
): UploadPart[] {
  const parts: UploadPart[] = [];
  for (const chapter of chapters) {
    let part = 1;
    for (let start = chapter.start_n; start <= chapter.end_n; start += maxParas, part += 1) {
      parts.push({ ch: chapter.ch, part, startN: start, endN: Math.min(start + maxParas - 1, chapter.end_n) });
    }
  }
  return parts;
}

export function parseStepBody(json: unknown): { chapter?: number; turnstileToken?: string } {
  if (!isRecord(json)) throw new UploadValidationError();
  const keys = Object.keys(json).sort().join(",");
  if (keys !== "" && keys !== "chapter" && keys !== "turnstileToken" && keys !== "chapter,turnstileToken") {
    throw new UploadValidationError();
  }
  const out: { chapter?: number; turnstileToken?: string } = {};
  if (json.chapter !== undefined) {
    if (typeof json.chapter !== "number" || !Number.isSafeInteger(json.chapter) || json.chapter < 1) {
      throw new UploadValidationError();
    }
    out.chapter = json.chapter;
  }
  if (json.turnstileToken !== undefined) {
    if (typeof json.turnstileToken !== "string" || json.turnstileToken.length > 2048) {
      throw new UploadValidationError();
    }
    out.turnstileToken = json.turnstileToken;
  }
  return out;
}

// Private Blob layout; the id is unguessable, URLs never leave the server.
export function uploadBookPath(id: string): string {
  return `uploads/${id}/book.json`;
}

export function uploadPartPath(id: string, part: string): string {
  return `uploads/${id}/part-${part}.json`;
}

export function uploadAnalysisPath(id: string): string {
  return `uploads/${id}/analysis.json`;
}

export function uploadDailySpendKey(day: string): string {
  return `upload:spend:daily:${day}`;
}
