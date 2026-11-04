// @vitest-environment jsdom
// Render isolation: narration state (play, volume, duck, word clock)
// re-renders only <ReadAlong>, never BookView and its paragraphs.
// ImagePane renders once per BookView render, so it counts them.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReaderModel } from "@/core/reader";
import { NarrationProvider, useNarration } from "../narration/context";
import type { NarrationController } from "../narration/use-narration";
import { BookView } from "./book-view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const counts = vi.hoisted(() => ({ book: 0, probe: 0, pictureChapter: null as null | ((o: HTMLElement | null) => void) }));

vi.mock("../folio/image-pane", () => ({
  ImagePane: (props: { onPictureChapter?: ((o: HTMLElement | null) => void) | null }) => {
    counts.book += 1;
    counts.pictureChapter = props.onPictureChapter ?? null;
    return null;
  },
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

const MODEL: ReaderModel = {
  bookId: "oz",
  textVersion: "v",
  title: "T",
  author: "A",
  chapters: [
    {
      ch: 1,
      title: "One",
      scenes: [
        {
          id: "c1s1",
          title: "S1",
          paragraphs: [
            { id: "p1", n: 1, text: "One two three." },
            { id: "p2", n: 2, text: "Four five six." },
          ],
        },
      ],
    },
  ],
} as unknown as ReaderModel;
const SCENES = [{ id: "c1s1", ch: 1, startN: 1, endN: 2 }];
const ENTRIES = [{ ch: 1, voice: "af_heart", src: "/narration/k1.mp3", manifest: "/narration/k1.json" }];
const MANIFEST = {
  format: 2,
  key: "k1",
  src: "/narration/k1.mp3",
  durationSec: 6,
  voice: "v",
  model: "m",
  speed: 1,
  chunks: [
    { n: 1, start: 0, end: 14, t0: 0, t1: 3, w: [0, 3, 0, 1, 4, 7, 1, 2, 8, 13, 2, 3] },
    { n: 2, start: 0, end: 14, t0: 3, t1: 6, w: [0, 4, 3, 4, 5, 9, 4, 5, 10, 13, 5, 6] },
  ],
};

let ctl: NarrationController | null = null;
function Probe() {
  // eslint-disable-next-line react-hooks/globals -- test probe captures the narration controller
  ctl = useNarration();
  // eslint-disable-next-line react-hooks/immutability -- test render counter
  counts.probe += 1;
  return null;
}

beforeEach(() => {
  counts.book = 0;
  counts.probe = 0;
  localStorage.clear();
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
    vi.fn(async () => new Response(JSON.stringify(MANIFEST), { headers: { "content-type": "application/json" } })),
  );
});
// Unmount every root so no React work runs after jsdom is torn down.
const roots: Root[] = [];
function mountRoot(host: HTMLElement): Root {
  const root = createRoot(host);
  roots.push(root);
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  ctl = null;
});

test("narration updates never re-render the book", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = mountRoot(host);
  await act(async () => {
    root.render(
      <NarrationProvider entries={ENTRIES} scenes={SCENES}>
        <Probe />
        <BookView model={MODEL} initialSceneId="c1s1" panelsByChapter={[]} />
      </NarrationProvider>,
    );
  });
  const audio = host.querySelector("audio")!;
  let t = 0;
  let paused = true;
  Object.defineProperty(audio, "currentTime", { get: () => t, set: (v: number) => void (t = v), configurable: true });
  Object.defineProperty(audio, "paused", { get: () => paused, configurable: true });
  audio.play = (() => {
    paused = false;
    audio.dispatchEvent(new Event("play"));
    return Promise.resolve();
  }) as () => Promise<void>;
  audio.pause = (() => {
    paused = true;
    audio.dispatchEvent(new Event("pause"));
  }) as () => void;

  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(host.querySelector("#p1")).not.toBeNull();
  const bookBefore = counts.book;
  const probeBefore = counts.probe;

  await act(async () => {
    ctl!.toggle();
    await new Promise((r) => setTimeout(r, 0));
  });
  for (const time of [0.5, 1.5, 2.5, 3.5, 4.5]) {
    await act(async () => {
      t = time;
      audio.dispatchEvent(new Event("timeupdate"));
      await new Promise((r) => setTimeout(r, 20));
    });
  }
  for (const v of [0.2, 0.4, 0.6]) {
    await act(async () => {
      ctl!.setVolume(v);
    });
  }

  // The narration context did change many times...
  expect(counts.probe).toBeGreaterThan(probeBefore + 3);
  // ...and the book rendered not once more.
  expect(counts.book).toBe(bookBefore);
});

test("each scene section carries its number and its chapter's scene count, past 30", async () => {
  const scenes = Array.from({ length: 31 }, (_, i) => ({
    id: `c1s${i + 1}`,
    title: `S${i + 1}`,
    paragraphs: [{ id: `q${i + 1}`, n: i + 1, text: "Words." }],
  }));
  const model = { ...MODEL, chapters: [{ ...MODEL.chapters[0], scenes }] } as unknown as ReaderModel;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = mountRoot(host);
  await act(async () => {
    root.render(
      <NarrationProvider entries={ENTRIES} scenes={SCENES}>
        <BookView model={model} initialSceneId="c1s1" panelsByChapter={[]} />
      </NarrationProvider>,
    );
  });
  const sections = [...host.querySelectorAll<HTMLElement>(".chapter-block > .book-section")];
  expect(sections).toHaveLength(31);
  expect(sections[1]!.style.getPropertyValue("--scene-n")).toBe('"2"');
  expect(sections[30]!.style.getPropertyValue("--scene-n")).toBe('"31"');
  expect(sections[30]!.style.getPropertyValue("--scene-of")).toBe('" of 31"');
});

test("non-Oz books show picture controls with the text", async () => {
  const model = {
    ...MODEL,
    bookId: "alice",
    chapters: [
      MODEL.chapters[0],
      { ch: 2, title: "Two", scenes: [{ id: "c2s1", title: "S1", paragraphs: [{ id: "p3", n: 3, text: "More words." }] }] },
    ],
  } as unknown as ReaderModel;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = mountRoot(host);
  await act(async () => {
    root.render(
      <NarrationProvider entries={[]} scenes={SCENES}>
        <BookView model={model} initialSceneId="c1s1" panelsByChapter={[]} />
      </NarrationProvider>,
    );
  });
  expect(counts.book).toBeGreaterThan(0);
  expect(host.querySelector(".vault")).not.toBeNull();
  expect(host.querySelector(".panels-link")).not.toBeNull();
  expect(host.querySelector("#p1")).not.toBeNull();
  expect(host.querySelector("#p3")).not.toBeNull();
});

test("scene moves rewrite the deep link with the current book", async () => {
  type Entry = { target: Element; isIntersecting: boolean; intersectionRatio: number };
  let fire: ((entries: Entry[]) => void) | null = null;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: (entries: Entry[]) => void) {
        fire = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const model = {
    ...MODEL,
    chapters: [
      {
        ...MODEL.chapters[0],
        scenes: [
          { id: "c1s1", title: "S1", paragraphs: [{ id: "p1", n: 1, text: "One." }] },
          { id: "c1s2", title: "S2", paragraphs: [{ id: "p2", n: 2, text: "Two." }] },
        ],
      },
    ],
  } as unknown as ReaderModel;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = mountRoot(host);
  await act(async () => {
    root.render(
      <NarrationProvider entries={[]} scenes={SCENES}>
        <BookView model={model} initialSceneId="c1s1" panelsByChapter={[]} />
      </NarrationProvider>,
    );
  });
  const section = host.querySelector('[data-scene-id="c1s2"]');
  expect(section).not.toBeNull();
  await act(async () => {
    fire!([{ target: section!, isIntersecting: true, intersectionRatio: 1 }]);
  });
  expect(window.location.pathname).toBe("/read/oz/c1s2");
});

test("chapter text shows at once and the pane opens the panels on demand", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = mountRoot(host);
  const panels = [{ ch: 1, panels: [{ key: "c1s1", caption: "The cyclone" }] }];
  await act(async () => {
    root.render(
      <NarrationProvider entries={[]} scenes={SCENES}>
        <BookView model={MODEL} initialSceneId="c1s1" panelsByChapter={panels} />
      </NarrationProvider>,
    );
  });
  const text = host.textContent ?? "";
  expect(host.querySelector("#p1")).not.toBeNull();
  expect(host.querySelector(".panels-offer")).toBeNull();
  expect(text).not.toContain("Start reading");
  expect(document.querySelector(".panels-modal")).toBeNull();

  await act(async () => counts.pictureChapter!(null));
  expect(document.querySelector(".panels-modal")?.textContent).toContain("The cyclone");

  await act(async () => (document.querySelector(".panels-x") as HTMLButtonElement).click());
  expect(document.querySelector(".panels-modal")).toBeNull();
});
