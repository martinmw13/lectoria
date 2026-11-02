import { describe, expect, it } from "vitest";
import { approxPages, BYOK_BOOK_MAX_WORDS, FREE_BOOK_MAX_WORDS, FREE_BOOKS_PER_DAY, uploadRoute, WORDS_PER_PAGE } from "./upload-policy";

describe("upload-policy", () => {
  it("derives about 200 free pages from the constants", () => {
    expect(WORDS_PER_PAGE).toBe(250);
    expect(approxPages(FREE_BOOK_MAX_WORDS)).toBe(200);
  });

  it("allows one free book a day like the server", () => {
    expect(FREE_BOOKS_PER_DAY).toBe(1);
    expect(uploadRoute(1000, 0)).toEqual({ kind: "free" });
    expect(uploadRoute(FREE_BOOK_MAX_WORDS, 0)).toEqual({ kind: "free" });
    expect(uploadRoute(1000, 1)).toEqual({ kind: "byok", reason: "free_used" });
    expect(uploadRoute(1000, 2)).toEqual({ kind: "byok", reason: "free_used" });
  });

  it("routes long books to BYOK, long first", () => {
    expect(uploadRoute(FREE_BOOK_MAX_WORDS + 1, 0)).toEqual({ kind: "byok", reason: "too_long" });
    expect(uploadRoute(FREE_BOOK_MAX_WORDS + 1, 1)).toEqual({ kind: "byok", reason: "too_long" });
  });

  it("lifts the word cap and the used check for friends", () => {
    expect(uploadRoute(200_000, 0, true)).toEqual({ kind: "free" });
    expect(uploadRoute(200_000, 1, true)).toEqual({ kind: "free" });
    expect(uploadRoute(BYOK_BOOK_MAX_WORDS, 0, true)).toEqual({ kind: "free" });
    expect(uploadRoute(BYOK_BOOK_MAX_WORDS + 1, 0, true)).toEqual({ kind: "byok", reason: "too_long" });
    expect(uploadRoute(60_000, 0)).toEqual({ kind: "byok", reason: "too_long" });
  });
});
