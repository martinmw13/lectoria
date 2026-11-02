import "server-only";
import { notFound } from "next/navigation";
import { shelfReadyIds } from "@/core/library";
import type { AnalyzedScene, Book } from "@/core/types";
import { isUploadId } from "@/core/uploads";
import { loadUploadedBook } from "./uploads/loader";

export interface BookPayload {
  book: Pick<Book, "id" | "title" | "author" | "chapters" | "paragraphs" | "textVersion">;
  scenes: AnalyzedScene[];
}

// Joins one book's two JSON chunks. The import() calls stay inline in
// LOADERS below so the bundler sees each book as its own chunk.
async function pair(
  book: Promise<{ default: unknown }>,
  analysis: Promise<{ default: unknown }>,
): Promise<BookPayload> {
  const [b, a] = await Promise.all([book, analysis]);
  return {
    book: b.default as BookPayload["book"],
    scenes: (a.default as { scenes: AnalyzedScene[] }).scenes,
  };
}

// One lazy entry per processed book: a route loads only its own book,
// and unknown ids simply miss the map, so traversal input can never
// name a file. One entry per book; the pipeline adds the rest.
const LOADERS: Record<string, () => Promise<BookPayload>> = {
  oz: () => pair(import("../data/books/oz/book.json"), import("../data/books/oz/analysis.json")),
  alice: () =>
    pair(import("../data/books/alice/book.json"), import("../data/books/alice/analysis.json")),
  carol: () =>
    pair(import("../data/books/carol/book.json"), import("../data/books/carol/analysis.json")),
  dracula: () =>
    pair(import("../data/books/dracula/book.json"), import("../data/books/dracula/analysis.json")),
  frankenstein: () =>
    pair(
      import("../data/books/frankenstein/book.json"),
      import("../data/books/frankenstein/analysis.json"),
    ),
  jungle: () =>
    pair(import("../data/books/jungle/book.json"), import("../data/books/jungle/analysis.json")),
  peterpan: () =>
    pair(
      import("../data/books/peterpan/book.json"),
      import("../data/books/peterpan/analysis.json"),
    ),
  pride: () =>
    pair(import("../data/books/pride/book.json"), import("../data/books/pride/analysis.json")),
  sherlock: () =>
    pair(
      import("../data/books/sherlock/book.json"),
      import("../data/books/sherlock/analysis.json"),
    ),
  treasure: () =>
    pair(
      import("../data/books/treasure/book.json"),
      import("../data/books/treasure/analysis.json"),
    ),
};

export function isKnownBookId(id: unknown): id is string {
  return typeof id === "string" && Object.hasOwn(LOADERS, id);
}

const readyIds = new Set(shelfReadyIds());

// Known plus listed on the shelf with status ready. The shelf manifest
// is the owner's switch: data alone does not publish a book.
export function isReadyBookId(id: unknown): boolean {
  return isKnownBookId(id) && readyIds.has(id);
}

export function readyBookIds(): string[] {
  return shelfReadyIds().filter(isKnownBookId);
}

// Parsed once per book per process; import failures are deterministic
// (a missing chunk never heals), so failed loads stay failed.
const cache = new Map<string, Promise<BookPayload>>();

function readPayload(id: string): Promise<BookPayload> {
  const hit = cache.get(id);
  if (hit) return hit;
  const load = LOADERS[id];
  if (!load) notFound();
  const pending = load();
  cache.set(id, pending);
  return pending;
}

// Processed data for any known id. Chat uses this: a question about a
// processed book is answerable whether the shelf lists it or not.
// Unknown ids throw notFound() synchronously, before any work starts.
// Uploads never load here, so chat stays shelf-only; pictures load
// uploads through loadBook below instead.
export function loadBookData(bookId: string): Promise<BookPayload> {
  if (!isKnownBookId(bookId)) notFound();
  return readPayload(bookId);
}

// Shelf books plus finished uploads. Missing, unfinished, or expired
// uploads 404 like unknown ids. Uploads bypass the module cache: they
// expire after 30 days, so a forever entry would serve a dead book.
export function loadBook(bookId: string): Promise<BookPayload> {
  if (isUploadId(bookId)) {
    return loadUploadedBook(bookId).then((payload) => {
      if (!payload) notFound();
      return payload;
    });
  }
  if (!isReadyBookId(bookId)) notFound();
  return readPayload(bookId);
}
