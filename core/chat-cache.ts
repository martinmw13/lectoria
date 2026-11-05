import { createHash } from "node:crypto";
import { CHAT_MODEL } from "./chat";

// Ask the Book answers to common recap-type questions are shared across
// readers. Bump when the cached-answer rules or prompt shape change; the
// system prompt's own hash is in the key as well.
export const CHAT_CACHE_VERSION = 1;
export const CHAT_CACHE_TTL_SEC = 30 * 24 * 60 * 60;
const MAX_NORMALIZED = 160;

// Lowercase, straight quotes, punctuation dropped, spaces collapsed.
export function normalizeQuestion(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NORMALIZED);
}

// Recap questions: the same answer suits every reader at the same place.
const COMMON = [
  /\brecap\b/,
  /\bsummar(y|ize|ise)\b/,
  /\bremind me\b/,
  /\bcatch me up\b/,
  /\bwhat (should|do) i (need to )?remember\b/,
  /\bwhat (has )?happened so far\b/,
  /\bso far\b.*\bhappen/,
  /\bprevious(ly)? chapters?\b/,
  /\bthe story so far\b/,
];

export function isCommonQuestion(normalized: string): boolean {
  return normalized.length > 0 && COMMON.some((re) => re.test(normalized));
}

export interface AnswerCacheKeyParts {
  bookId: string;
  textVersion: string;
  /** The scene the reader is in; the answer only sees text before it. */
  sceneId: string;
  normalizedQuestion: string;
  systemPrompt: string;
}

// The key is a hash, so no question text or book id reaches the store.
export function answerCacheKey(p: AnswerCacheKeyParts): string {
  const promptHash = createHash("sha256").update(p.systemPrompt).digest("hex");
  const raw = JSON.stringify([CHAT_CACHE_VERSION, CHAT_MODEL, promptHash, p.bookId, p.textVersion, p.sceneId, p.normalizedQuestion]);
  return `chat:answer:v${CHAT_CACHE_VERSION}:${createHash("sha256").update(raw).digest("hex")}`;
}
