// @vitest-environment jsdom
// Reader landmarks and tab order: one h1, chapter h2s inside main#story,
// and only the current chapter's "relive" button in the tab order, so
// keyboard users reach the player without scrolling through the book.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReaderModel } from "@/core/reader";
import { NarrationProvider } from "../narration/context";
import { BookView } from "./book-view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../folio/image-pane", () => ({
  ImagePane: () => null,
}));
vi.mock("../folio/use-pictures", () => ({
  poll: () => new Promise(() => {}),
  usePictures: () => ({
    card: { phase: "idle" },
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

const MODEL = {
  bookId: "oz",
  textVersion: "v",
  title: "The Book",
  author: "A",
  chapters: [1, 2, 3].map((ch) => ({
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
const SCENES = [
  { id: "c1s1", ch: 1, startN: 1, endN: 1 },
  { id: "c2s1", ch: 2, startN: 2, endN: 2 },
  { id: "c3s1", ch: 3, startN: 3, endN: 3 },
];

let ioCb: IntersectionObserverCallback | null = null;
beforeEach(() => {
  ioCb = null;
  window.history.replaceState(null, "", "/");
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: IntersectionObserverCallback) {
        ioCb = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

const roots: Root[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function mount(initialSceneId = "c1s1"): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <NarrationProvider entries={[]} scenes={SCENES}>
        <BookView model={MODEL} initialSceneId={initialSceneId} panelsByChapter={[]} />
      </NarrationProvider>,
    );
  });
  return host;
}

function reliveButtons(host: HTMLElement): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>(".chapter-relive .panels-link")];
}

test("one h1 and chapter h2s inside main#story", async () => {
  const host = await mount();
  const h1s = host.querySelectorAll("h1");
  expect(h1s).toHaveLength(1);
  expect(h1s[0]?.textContent).toBe("The Book");
  expect(h1s[0]?.className).toContain("sr-only");
  const main = host.querySelector("main#story");
  expect(main).not.toBeNull();
  expect(main?.querySelectorAll("h2.chapter-title")).toHaveLength(3);
  expect(host.querySelectorAll("h1.chapter-title")).toHaveLength(0);
});

test("only the current chapter's relive button is in tab order", async () => {
  const host = await mount();
  // Chapters 1 and 2 have buttons; the last chapter ends the book instead.
  const buttons = reliveButtons(host);
  expect(buttons).toHaveLength(2);
  expect(buttons[0]?.getAttribute("tabindex")).toBeNull();
  expect(buttons[1]?.getAttribute("tabindex")).toBe("-1");
});

test("focus in a far chapter never commits a later scene", async () => {
  const host = await mount();
  const buttons = reliveButtons(host);
  const section2 = host.querySelector('[data-scene-id="c2s1"]')!;
  const entry = { target: section2, isIntersecting: true, intersectionRatio: 1 };

  // Tabbing (programmatically, as tabindex -1 allows) into chapter 2
  // scrolls it under the reading line, but the commit is dropped.
  buttons[1]?.focus();
  await act(async () => {
    ioCb!([entry] as unknown as IntersectionObserverEntry[], null as unknown as IntersectionObserver);
  });
  expect(window.location.pathname).toBe("/");

  // The same scroll with focus elsewhere commits as usual.
  buttons[1]?.blur();
  await act(async () => {
    ioCb!([entry] as unknown as IntersectionObserverEntry[], null as unknown as IntersectionObserver);
  });
  expect(window.location.pathname).toBe("/read/oz/c2s1");
});
