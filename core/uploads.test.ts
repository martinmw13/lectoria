import { describe, expect, it } from "vitest";
import {
  BYOK_BOOK_MAX_WORDS,
  FREE_BOOK_MAX_WORDS,
  UPLOAD_DAILY_SPEND_CAP_MICRO,
  UPLOAD_HTTP_STATUS,
  UPLOAD_MESSAGES,
  UPLOAD_RESERVE_MICRO,
  countChapterWords,
  countWords,
  isUploadId,
  newUploadId,
  parseStepBody,
  parseUploadCreate,
  partKey,
  splitChapterParts,
  uploadAnalysisPath,
  uploadBookPath,
  uploadDailySpendKey,
  uploadPartPath,
  uploadReserveMicro,
  UploadValidationError,
} from "./uploads";
import type { RawSection } from "./clean-types";

function section(over: Partial<RawSection> = {}): RawSection {
  return {
    id: "s1",
    href: "ch1.xhtml",
    linear: true,
    types: [],
    docTitle: null,
    navLabel: "One",
    blocks: [{ text: "Hello world.", heading: false }],
    ...over,
  };
}

function body(over: Record<string, unknown> = {}): unknown {
  return { title: "A Book", author: "Anon", sections: [section()], ...over };
}

describe("upload ids", () => {
  it("mints prefixed 128-bit ids that validate", () => {
    const id = newUploadId();
    expect(isUploadId(id)).toBe(true);
    expect(id).toMatch(/^u-/);
    expect(newUploadId()).not.toBe(id);
  });

  it("rejects paths and short ids", () => {
    for (const bad of ["", "u-", "u-short", "u-../book.json", "oz", null, 42]) {
      expect(isUploadId(bad)).toBe(false);
    }
  });
});

describe("parseUploadCreate", () => {
  it("accepts a minimal body", () => {
    expect(parseUploadCreate(body())).toEqual({
      title: "A Book",
      author: "Anon",
      sections: [section()],
    });
  });

  it("allows missing author and a turnstile token", () => {
    const parsed = parseUploadCreate(body({ author: undefined, turnstileToken: "tok" }));
    expect(parsed.author).toBeNull();
    expect(parsed.turnstileToken).toBe("tok");
  });

  it("accepts an optional friend code within its length cap", () => {
    expect(parseUploadCreate(body({ friendCode: "maple" })).friendCode).toBe("maple");
    expect(parseUploadCreate(body({ author: undefined, friendCode: "maple", turnstileToken: "tok" })).friendCode).toBe(
      "maple",
    );
    expect(() => parseUploadCreate(body({ friendCode: "x".repeat(65) }))).toThrow(UploadValidationError);
    expect(() => parseUploadCreate(body({ friendCode: 42 }))).toThrow(UploadValidationError);
  });

  it("rejects unknown fields and bad shapes", () => {
    expect(() => parseUploadCreate(body({ extra: 1 }))).toThrow(UploadValidationError);
    expect(() => parseUploadCreate(body({ title: "  " }))).toThrow(UploadValidationError);
    expect(() => parseUploadCreate(body({ sections: [] }))).toThrow(UploadValidationError);
    expect(() => parseUploadCreate(body({ sections: [{ ...section(), linear: "yes" }] }))).toThrow(
      UploadValidationError,
    );
    expect(() => parseUploadCreate(body({ sections: [{ ...section(), blocks: "x" }] }))).toThrow(
      UploadValidationError,
    );
  });

  it("rejects oversize strings and lists", () => {
    expect(() => parseUploadCreate(body({ title: "x".repeat(301) }))).toThrow(UploadValidationError);
    expect(() =>
      parseUploadCreate(body({ sections: [section({ blocks: [{ text: "x".repeat(20_001), heading: false }] })] })),
    ).toThrow(UploadValidationError);
    expect(() =>
      parseUploadCreate(body({ sections: new Array(601).fill(section()) })),
    ).toThrow(UploadValidationError);
  });
});

describe("words and parts", () => {
  it("counts unicode words like the browser", () => {
    expect(countWords("Hello, world! Don't stop.")).toBe(4);
    expect(countChapterWords([{ paragraphs: ["one two", "three"] }])).toBe(3);
  });

  it("keeps short chapters whole and splits long ones", () => {
    expect(splitChapterParts([{ ch: 1, start_n: 1, end_n: 100 }])).toEqual([
      { ch: 1, part: 1, startN: 1, endN: 100 },
    ]);
    expect(splitChapterParts([{ ch: 2, start_n: 1, end_n: 400 }], 150)).toEqual([
      { ch: 2, part: 1, startN: 1, endN: 150 },
      { ch: 2, part: 2, startN: 151, endN: 300 },
      { ch: 2, part: 3, startN: 301, endN: 400 },
    ]);
    expect(partKey({ ch: 2, part: 3 })).toBe("ch2p3");
  });

  it("parses the step body", () => {
    expect(parseStepBody({})).toEqual({});
    expect(parseStepBody({ chapter: 3 })).toEqual({ chapter: 3 });
    expect(parseStepBody({ chapter: 3, turnstileToken: "tok" })).toEqual({ chapter: 3, turnstileToken: "tok" });
    expect(() => parseStepBody({ chapter: 0 })).toThrow(UploadValidationError);
    expect(() => parseStepBody({ chapter: 1, extra: 1 })).toThrow(UploadValidationError);
  });
});

describe("keys and codes", () => {
  it("builds blob paths and the spend key", () => {
    const id = "u-" + "a".repeat(22);
    expect(uploadBookPath(id)).toBe(`uploads/${id}/book.json`);
    expect(uploadPartPath(id, "ch1p1")).toBe(`uploads/${id}/part-ch1p1.json`);
    expect(uploadAnalysisPath(id)).toBe(`uploads/${id}/analysis.json`);
    expect(uploadDailySpendKey("2026-10-30")).toBe("upload:spend:daily:2026-10-30");
  });

  it("pins the money constants", () => {
    expect(FREE_BOOK_MAX_WORDS).toBe(50_000);
    expect(BYOK_BOOK_MAX_WORDS).toBe(400_000);
    expect(UPLOAD_DAILY_SPEND_CAP_MICRO).toBe(1_000_000);
    expect(UPLOAD_RESERVE_MICRO).toBe(250_000);
  });

  it("covers every code with a message and status", () => {
    for (const code of Object.keys(UPLOAD_MESSAGES) as (keyof typeof UPLOAD_MESSAGES)[]) {
      expect(UPLOAD_MESSAGES[code].length).toBeGreaterThan(0);
      expect(UPLOAD_HTTP_STATUS[code]).toBeGreaterThanOrEqual(400);
    }
    expect(UPLOAD_HTTP_STATUS.too_long).toBe(413);
    expect(UPLOAD_HTTP_STATUS.daily_books_reached).toBe(429);
    expect(UPLOAD_HTTP_STATUS.expired).toBe(410);
  });
});

describe("uploadReserveMicro", () => {
  it("floors tiny books", () => {
    expect(uploadReserveMicro(2, 60)).toBe(50_000);
  });

  it("scales with parts and words", () => {
    expect(uploadReserveMicro(12, 50_000)).toBe(110_000);
  });

  it("caps huge books at the ceiling", () => {
    expect(uploadReserveMicro(500, 400_000)).toBe(250_000);
  });

  it("covers the measured cost many times over", () => {
    expect(uploadReserveMicro(4, 3955)).toBeGreaterThan(2700);
  });
});
