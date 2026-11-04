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
    vi.fn(async () => ({ ok: true, json: async () => ({ cast: [entry("dorothy", "Dorothy"), entry("toto", "Toto")] }) })),
  );
  const el = document.createElement("div");
  const root = createRoot(el);
  await act(async () => root.render(<CastList bookId="oz" sceneId="c1s1" chapter={chapter} />));
  await act(async () => el.querySelector<HTMLButtonElement>(".marks-row")!.click());
  return { el, root };
}

it("shows only the protagonist's portrait in chapter 1, in the list and the window", async () => {
  const { el, root } = await openCast(1);
  const imgs = el.querySelectorAll<HTMLImageElement>("#cast-panel img.cast-portrait");
  expect(imgs).toHaveLength(1);
  expect(imgs[0]!.alt).toBe("Dorothy");
  expect(imgs[0]!.getAttribute("src")).toBe("/portraits/oz.webp");
  await act(async () => el.querySelector<HTMLButtonElement>(".cast-expand")!.click());
  const big = el.querySelectorAll<HTMLImageElement>("#cast-window img.cast-portrait");
  expect(big).toHaveLength(1);
  expect(big[0]!.alt).toBe("Dorothy");
  act(() => root.unmount());
});

it("shows no portrait after chapter 1", async () => {
  const { el, root } = await openCast(2);
  expect(el.querySelectorAll(".cast-card")).toHaveLength(2);
  expect(el.querySelector("img.cast-portrait")).toBeNull();
  act(() => root.unmount());
});
