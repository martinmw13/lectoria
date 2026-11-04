/**
 * @vitest-environment jsdom
 */
import { afterEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { CastList } from "./cast-list";

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const entry = (id: string, name: string) => ({
  id,
  name,
  firstSeen: { sceneId: "c1s1", ch: 1, title: "T" },
  description: "d",
  known: [],
  scenes: 1,
});

afterEach(() => vi.unstubAllGlobals());

async function openCast(chapter: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        cast: [entry("dorothy", "Dorothy"), entry("toto", "Toto"), entry("scarecrow", "Scarecrow")],
      }),
    })),
  );
  const el = document.createElement("div");
  const root = createRoot(el);
  await act(async () => root.render(<CastList bookId="oz" sceneId="c1s1" chapter={chapter} />));
  await act(async () => el.querySelector<HTMLButtonElement>(".marks-row")!.click());
  return { el, root };
}

it("shows portraits only for mapped Oz characters in chapter 1, in the list and the window", async () => {
  const { el, root } = await openCast(1);
  const imgs = el.querySelectorAll<HTMLImageElement>("#cast-panel img.cast-portrait");
  expect([...imgs].map((i) => i.alt)).toEqual(["Dorothy", "Toto"]);
  expect(imgs[0]!.alt).toBe("Dorothy");
  expect(imgs[0]!.getAttribute("src")).toBe("/portraits/oz.webp");
  await act(async () => el.querySelector<HTMLButtonElement>(".cast-seeall")!.click());
  const big = el.querySelectorAll<HTMLImageElement>("#cast-window img.cast-portrait");
  expect(big).toHaveLength(2);
  expect(big[0]!.alt).toBe("Dorothy");
  act(() => root.unmount());
});

it("shows no portrait after chapter 1", async () => {
  const { el, root } = await openCast(2);
  expect(el.querySelectorAll(".cast-card")).toHaveLength(3);
  expect(el.querySelector("img.cast-portrait")).toBeNull();
  act(() => root.unmount());
});

it("opens the protagonist portrait large on click and closes on Esc, ×, and outside click", async () => {
  const { el, root } = await openCast(1);
  const btn = el.querySelector<HTMLButtonElement>("#cast-panel .cast-portrait-btn")!;
  expect(btn.getAttribute("aria-label")).toBe("Enlarge portrait of Dorothy");
  expect(document.querySelector(".portrait-zoom-img")).toBeNull();
  await act(async () => btn.click());
  const big = document.querySelector<HTMLImageElement>(".portrait-zoom-img")!;
  expect(big.getAttribute("src")).toBe("/portraits/oz@2x.webp");
  expect(big.alt).toBe("Dorothy");
  expect(btn.getAttribute("aria-expanded")).toBe("true");
  await act(async () =>
    document.querySelector(".portrait-zoom")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(document.querySelector(".portrait-zoom")).toBeNull();
  await act(async () => btn.click());
  await act(async () => document.querySelector<HTMLButtonElement>(".portrait-zoom-x")!.click());
  expect(document.querySelector(".portrait-zoom")).toBeNull();
  await act(async () => btn.click());
  await act(async () => document.querySelector<HTMLDivElement>(".portrait-zoom-backdrop")!.click());
  expect(document.querySelector(".portrait-zoom")).toBeNull();
  act(() => root.unmount());
});

it("Esc in the zoom closes only the portrait, not the cast window", async () => {
  const { el, root } = await openCast(1);
  document.body.appendChild(el);
  await act(async () => el.querySelector<HTMLButtonElement>(".cast-seeall")!.click());
  await act(async () => el.querySelector<HTMLButtonElement>("#cast-window .cast-portrait-btn")!.click());
  await act(async () =>
    document.querySelector(".portrait-zoom")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(document.querySelector(".portrait-zoom")).toBeNull();
  expect(el.querySelector("#cast-window")).not.toBeNull();
  act(() => root.unmount());
  el.remove();
});

it("has no separate expand control; See all appears only in the open list and opens the window", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ cast: [entry("dorothy", "Dorothy")] }) })));
  const el = document.createElement("div");
  const root = createRoot(el);
  await act(async () => root.render(<CastList bookId="oz" sceneId="c1s1" chapter={1} />));
  expect(el.querySelector(".cast-expand")).toBeNull();
  expect(el.querySelector(".cast-seeall")).toBeNull();
  await act(async () => el.querySelector<HTMLButtonElement>(".marks-row")!.click());
  const seeAll = el.querySelector<HTMLButtonElement>("#cast-panel .cast-seeall")!;
  expect(seeAll.textContent).toBe("See all");
  expect(el.querySelector("#cast-window")).toBeNull();
  await act(async () => seeAll.click());
  expect(el.querySelector("#cast-window")).not.toBeNull();
  await act(async () => el.querySelector<HTMLButtonElement>("#cast-window .chat-x")!.click());
  expect(el.querySelector("#cast-window")).toBeNull();
  act(() => root.unmount());
});
