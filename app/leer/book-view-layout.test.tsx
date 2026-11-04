// @vitest-environment jsdom
// Layout parity: every book renders the same folio columns as Oz
// (image pane, divider, reading column, margin, pager), so the text
// sits centered on wide screens for generic books too.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReaderModel } from "@/core/reader";
import { NarrationProvider } from "../narration/context";
import { BookView } from "./book-view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Pictures (Meta/Blob/Redis) stay mocked: layout must not need network.
vi.mock("../folio/use-pictures", () => ({
  poll: () => new Promise(() => {}),
  usePictures: () => ({
    card: { phase: "idle" },
    needHuman: false,
    submitHumanToken: () => {},
    figures: [],
    vaultScenes: [],
    popover: null,
    viewRef: () => {},
    popRef: { current: null },
    illustrateScene: () => {},
    illustratePassage: () => {},
    hidePopover: () => {},
    rescan: () => {},
    clearScene: () => {},
    removeFigure: () => {},
    retryFigure: () => {},
    lightbox: { item: null, open: () => {}, close: () => {} },
  }),
}));

const LAYOUT = [".img-pane", ".pane-divider", ".read-col", ".vault", ".band-pager"];

function modelFor(bookId: string): ReaderModel {
  return {
    bookId,
    textVersion: "v",
    title: "T",
    author: "A",
    chapters: [
      {
        ch: 1,
        title: "One",
        scenes: [{ id: "c1s1", title: "S1", paragraphs: [{ id: "p1", n: 1, text: "Hello world." }] }],
      },
    ],
  } as unknown as ReaderModel;
}

const roots: Root[] = [];
beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("no network in layout test");
    }),
  );
});
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function columnsOf(bookId: string): Promise<string[]> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <NarrationProvider entries={[]} scenes={[{ id: "c1s1", ch: 1, startN: 1, endN: 1 }]}>
        <BookView model={modelFor(bookId)} initialSceneId="c1s1" panelsByChapter={[]} />
      </NarrationProvider>,
    );
  });
  expect(host.querySelector("#p1")?.textContent).toBe("Hello world.");
  return LAYOUT.filter((sel) => host.querySelector(sel) !== null);
}

test("generic books render the same folio columns as Oz", async () => {
  expect(await columnsOf("oz")).toEqual(LAYOUT);
  expect(await columnsOf("alice")).toEqual(LAYOUT);
  expect(await columnsOf("dracula")).toEqual(LAYOUT);
});
