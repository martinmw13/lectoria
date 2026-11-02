// Pure upload routing: which path a parsed book takes. Client-safe.
// The counts here are a hint only; the server enforces the real caps.
export const FREE_BOOK_MAX_WORDS = 50_000; // provisional, may change once we know the processing cost
export const WORDS_PER_PAGE = 250;
// Mirror of FREE_BOOKS_PER_PERSON in server/guard/quota.ts.
export const FREE_BOOKS_PER_DAY = 1;

export function approxPages(words: number): number {
  return Math.max(1, Math.round(words / WORDS_PER_PAGE));
}

export type UploadRoute = { kind: "free" } | { kind: "byok"; reason: "too_long" | "free_used" };

// A long book needs its own key even when free books remain today.
export function uploadRoute(words: number, freeBooksToday: number): UploadRoute {
  if (words > FREE_BOOK_MAX_WORDS) return { kind: "byok", reason: "too_long" };
  if (freeBooksToday >= FREE_BOOKS_PER_DAY) return { kind: "byok", reason: "free_used" };
  return { kind: "free" };
}
