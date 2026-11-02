// @vitest-environment jsdom
// Uploads read with chat and pictures: the launcher mounts for shelf
// books and u- ids alike (an upload finished with the reader's own key
// asks on that key); picture surfaces mount for uploads too and the
// images API serves them.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ReaderModel } from "@/core/reader";
import { Reader, type ChapterJump, type SlimScene } from "./reader";
import { BookView } from "./leer/book-view";

vi.mock("next/navigation", () => ({ useParams: () => ({}) }));
vi.mock("./chat/reader-chat", () => ({
  ReaderChat: () => <div data-testid="reader-chat" />,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom's AbortSignal may lack the static timeout helper the manifest
// fetch uses; the stub only satisfies the call signature.
if (typeof AbortSignal.timeout !== "function") {
  AbortSignal.timeout = (() => new AbortController().signal) as typeof AbortSignal.timeout;
}

const SCENES: SlimScene[] = [{ id: "c1s1", ch: 1, startN: 1, endN: 2, emotion: null }];
const CHAPTERS: ChapterJump[] = [{ ch: 1, title: "One", firstSceneId: "c1s1" }];

const UPLOAD_ID = "u-AAAAAAAAAAAAAAAAAAAAAA";

function bookModel(bookId: string): ReaderModel {
  return {
    bookId,
    textVersion: "v",
    title: "T",
    author: "A",
    chapters: [1, 2].map((ch) => ({
      ch,
      title: `Chapter ${ch}`,
      scenes: [
        {
          id: `c${ch}s1`,
          title: `S${ch}`,
          paragraphs: [{ id: `p${ch}`, n: ch, text: `Words ${ch}.` }],
        },
      ],
    })),
  } as unknown as ReaderModel;
}

const BOOK_SCENES: SlimScene[] = [
  { id: "c1s1", ch: 1, startN: 1, endN: 1, emotion: null },
  { id: "c2s1", ch: 2, startN: 2, endN: 2, emotion: null },
];
const BOOK_CHAPTERS: ChapterJump[] = [
  { ch: 1, title: "Chapter 1", firstSceneId: "c1s1" },
  { ch: 2, title: "Chapter 2", firstSceneId: "c2s1" },
];

let container: HTMLDivElement;
let root: Root | null = null;
let fetchMock: ReturnType<typeof vi.fn>;

async function renderReader(bookId: string) {
  await act(async () => {
    root?.render(
      <Reader
        bookId={bookId}
        scenes={SCENES}
        chapters={CHAPTERS}
        bookTitle="T"
        bookAuthor="A"
        narration={[]}
      >
        <div>story</div>
      </Reader>,
    );
  });
}

async function renderBook(bookId: string) {
  await act(async () => {
    root?.render(
      <Reader
        bookId={bookId}
        scenes={BOOK_SCENES}
        chapters={BOOK_CHAPTERS}
        bookTitle="T"
        bookAuthor="A"
        narration={[]}
      >
        <BookView model={bookModel(bookId)} initialSceneId="c1s1" panelsByChapter={[]} />
      </Reader>,
    );
  });
}

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ version: 2, tracks: [] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => {
    root?.unmount();
  });
  root = null;
  container.remove();
});

describe("reader chat gate", () => {
  test("mounts chat for a shelf book", async () => {
    await renderReader("oz");
    expect(container.querySelector('[data-testid="reader-chat"]')).toBeTruthy();
  });

  test("mounts chat for an upload id", async () => {
    await renderReader("u-AAAAAAAAAAAAAAAAAAAAAA");
    expect(container.querySelector('[data-testid="reader-chat"]')).toBeTruthy();
    expect(container.textContent).toContain("story");
  });
});

describe("reader visuals gate", () => {
  test("shows every picture surface for an upload id", async () => {
    await renderBook(UPLOAD_ID);
    expect(container.querySelector(".img-pane")).not.toBeNull();
    expect(container.querySelector(".pane-divider")).not.toBeNull();
    expect(container.querySelector(".vault")).not.toBeNull();
    expect(container.querySelector(".panels-link")).not.toBeNull();
    expect(container.querySelector(".folio")?.classList.contains("no-visuals")).toBe(false);
    expect(container.textContent).toContain("Words 1.");
    expect(container.textContent).toContain("Picture this");
    expect(container.textContent).toContain("Relive this chapter in panels");
  });

  test("keeps picture surfaces for a shelf book", async () => {
    await renderBook("oz");
    expect(container.querySelector(".img-pane")).not.toBeNull();
    expect(container.querySelector(".pane-divider")).not.toBeNull();
    expect(container.querySelector(".vault")).not.toBeNull();
    expect(container.querySelector(".panels-link")).not.toBeNull();
    expect(container.querySelector(".folio")?.classList.contains("no-visuals")).toBe(false);
    expect(container.textContent).toContain("Picture this");
  });
});
