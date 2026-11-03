import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { shelfReadyIds } from "@/core/library";
import { buildReaderModel } from "@/core/reader";
import { firstSceneHrefs, isKnownBookId, isReadyBookId, loadBook, loadBookData, readyBookIds } from "./books";
import { loadUploadedBook } from "./uploads/loader";

vi.mock("./uploads/loader", () => ({ loadUploadedBook: vi.fn() }));

const mockedLoader = vi.mocked(loadUploadedBook);

function notFoundDigest(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return String((e as { digest?: unknown }).digest ?? (e as Error).message);
  }
  throw new Error("expected notFound() to throw");
}

describe("book registry", () => {
  it("loads the shelf book with its scenes", async () => {
    const { book, scenes } = await loadBook("oz");
    expect(book.id).toBe("oz");
    expect(book.title).toContain("Oz");
    expect(scenes.length).toBeGreaterThan(0);
    expect(readyBookIds()).toContain("oz");
    expect(isReadyBookId("oz")).toBe(true);
  });

  it("loads processed data for a known book off the shelf", async () => {
    expect(isKnownBookId("alice")).toBe(true);
    const { book, scenes } = await loadBookData("alice");
    expect(book.id).toBe("alice");
    expect(scenes.length).toBeGreaterThan(0);
  });

  it.each(["dracula", "pride", "sherlock"])("loads processed data for %s", async (id) => {
    expect(isKnownBookId(id)).toBe(true);
    expect(isReadyBookId(id)).toBe(true);
    const { book, scenes } = await loadBook(id);
    expect(book.id).toBe(id);
    expect(scenes.length).toBeGreaterThan(0);
  });

  it("404s on unknown ids", () => {
    expect(isKnownBookId("nope")).toBe(false);
    expect(isReadyBookId("nope")).toBe(false);
    expect(notFoundDigest(() => loadBook("nope"))).toContain("404");
    expect(notFoundDigest(() => loadBookData("nope"))).toContain("404");
  });

  it("404s on traversal-ish ids without resolving a path", () => {
    for (const id of ["../..", "..\\..", "oz/../alice", "oz/../../etc/passwd", "", "OZ", " oz ", "alice\0"]) {
      expect(isKnownBookId(id)).toBe(false);
      expect(notFoundDigest(() => loadBook(id))).toContain("404");
    }
  });

  it("derives the ready list from the shared shelf order", () => {
    expect(readyBookIds()).toEqual(shelfReadyIds().filter(isKnownBookId));
  });

  it("keeps the loader map and the on-disk books in sync", () => {
    for (const id of readyBookIds()) {
      expect(existsSync(join(process.cwd(), "data/books", id))).toBe(true);
    }
    const onDisk = readdirSync(join(process.cwd(), "data/books"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const id of shelfReadyIds()) {
      if (existsSync(join(process.cwd(), "data/books", id, "book.json"))) {
        expect(onDisk).toContain(id);
        expect(isKnownBookId(id)).toBe(true);
      }
    }
  });
});

const UPLOAD_ID = "u-AAAAAAAAAAAAAAAAAAAAAA";

async function rejectedDigest(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    return String((e as { digest?: unknown }).digest ?? (e as Error).message);
  }
  throw new Error("expected notFound() to reject");
}

describe("first scene hrefs", () => {
  it("links every ready book to the scene its redirect would pick", async () => {
    const hrefs = await firstSceneHrefs();
    expect(Object.keys(hrefs).sort()).toEqual([...readyBookIds()].sort());
    for (const id of readyBookIds()) {
      const { book, scenes } = await loadBook(id);
      const first = buildReaderModel(book, { scenes }).chapters[0]?.scenes[0];
      expect(hrefs[id]).toBe(`/read/${id}/${first?.id}`);
    }
    expect(mockedLoader).not.toHaveBeenCalled();
  });
});

describe("upload ids", () => {
  beforeEach(() => {
    mockedLoader.mockReset();
  });

  it("delegates valid u- ids to the upload loader", async () => {
    const payload = {
      book: { id: UPLOAD_ID, title: "Middlemarch", author: "G. Eliot", chapters: [], paragraphs: [], textVersion: "v" },
      scenes: [],
    };
    mockedLoader.mockResolvedValue(payload as never);
    await expect(loadBook(UPLOAD_ID)).resolves.toEqual(payload);
    expect(mockedLoader).toHaveBeenCalledWith(UPLOAD_ID);
    expect(isKnownBookId(UPLOAD_ID)).toBe(false);
    expect(isReadyBookId(UPLOAD_ID)).toBe(false);
  });

  it("404s missing or expired uploads", async () => {
    mockedLoader.mockResolvedValue(null);
    await expect(rejectedDigest(loadBook(UPLOAD_ID))).resolves.toContain("404");
  });

  it("404s malformed u- ids without calling the loader", async () => {
    for (const id of ["u-", "u-short", "u-AAAAAAAAAAAAAAAAAAAAA", `x${UPLOAD_ID}`, `${UPLOAD_ID}x`, "u-AAAAAAAAAAAAAAAAAAAAA!"]) {
      expect(notFoundDigest(() => loadBook(id))).toContain("404");
    }
    expect(mockedLoader).not.toHaveBeenCalled();
  });

  it("keeps loadBookData shelf-only for upload ids", () => {
    expect(notFoundDigest(() => loadBookData(UPLOAD_ID))).toContain("404");
    expect(mockedLoader).not.toHaveBeenCalled();
  });
});
