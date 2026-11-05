// @vitest-environment jsdom
// Upload validation against fixture EPUBs in core/fixtures/epub (made by
// scripts/make-epub-fixtures.mjs).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { EPUB_ERROR_MESSAGES, EpubError, parseEpubWithSections, readEpubFileWithSections } from "./epub";
import { MIN_BOOK_WORDS } from "./upload-policy";

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, "fixtures", "epub", name)));

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
  } catch (e) {
    return e instanceof EpubError ? e.code : `raw: ${String(e)}`;
  }
  return null;
}

function fileOf(bytes: Uint8Array, name = "book.epub"): File {
  return new File([bytes as BlobPart], name, { type: "application/epub+zip" });
}

describe("EPUB upload validation", () => {
  it("accepts a valid book with at least one page of text", () => {
    const { book } = parseEpubWithSections(fixture("valid.epub"));
    expect(book.words).toBeGreaterThanOrEqual(MIN_BOOK_WORDS);
    expect(book.chapters).toHaveLength(1);
  });

  it.each([
    ["empty.epub", "empty"],
    ["not-a-zip.epub", "not_epub"],
    ["no-opf.epub", "not_epub"],
    ["no-spine.epub", "too_short"],
    ["no-content.epub", "too_short"],
    ["tiny.epub", "too_short"],
  ])("rejects %s as %s", (name, code) => {
    expect(codeOf(() => parseEpubWithSections(fixture(name)))).toBe(code);
  });

  it("checks empty and non-zip files before reading them whole", async () => {
    await expect(readEpubFileWithSections(fileOf(fixture("empty.epub")))).rejects.toMatchObject({ code: "empty" });
    await expect(readEpubFileWithSections(fileOf(fixture("not-a-zip.epub")))).rejects.toMatchObject({
      code: "not_epub",
    });
    await expect(readEpubFileWithSections(fileOf(fixture("tiny.epub")))).rejects.toMatchObject({ code: "too_short" });
    await expect(readEpubFileWithSections(fileOf(fixture("valid.epub")))).resolves.toBeTruthy();
  });

  it("refuses zips that would inflate past the total cap, before inflating", () => {
    const chunk = new Uint8Array(7 * 1024 * 1024);
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 9; i++) files[`OEBPS/pad${i}.bin`] = chunk;
    expect(codeOf(() => parseEpubWithSections(zipSync(files, { level: 9 })))).toBe("too_large");
  });

  it("refuses zips with an absurd number of entries", () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 10_001; i++) files[`f${i}`] = new Uint8Array(0);
    expect(codeOf(() => parseEpubWithSections(zipSync(files, { level: 0 })))).toBe("too_large");
  });

  it("has a friendly message for every rejection", () => {
    expect(EPUB_ERROR_MESSAGES.too_short).toBe(
      "This EPUB looks empty or too short. It needs at least one page of text.",
    );
    expect(EPUB_ERROR_MESSAGES.empty).toMatch(/empty/);
  });
});
