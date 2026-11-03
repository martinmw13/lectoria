// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookOpening, markOpening, OPENING_KEY, playOpening, SHELF_LAYER_ID, takeOpening } from "./book-opening";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function motion(reduce: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: reduce,
  }) as unknown as typeof window.matchMedia;
}

function loadedCover(src = "/covers/oz.webp"): HTMLImageElement {
  const img = document.createElement("img");
  img.src = src;
  Object.defineProperty(img, "complete", { value: true });
  Object.defineProperty(img, "naturalWidth", { value: 600 });
  img.getBoundingClientRect = () => ({ left: 10, top: 20, width: 300, height: 400 }) as DOMRect;
  return img;
}

afterEach(() => {
  sessionStorage.clear();
  document.body.innerHTML = "";
});

describe("book opening", () => {
  it("marks a click and hands it to the reader once", () => {
    motion(false);
    markOpening("oz", loadedCover());
    const o = takeOpening("oz");
    expect(o).toMatchObject({
      bookId: "oz",
      src: "/covers/oz.webp",
      x: 10,
      y: 20,
      w: 300,
      h: 400,
    });
    expect(takeOpening("oz")).toBeNull();
  });

  it("skips reduced motion, unloaded covers, other books and stale marks", () => {
    motion(true);
    markOpening("oz", loadedCover());
    expect(sessionStorage.getItem(OPENING_KEY)).toBeNull();
    motion(false);
    const pending = document.createElement("img");
    markOpening("oz", pending);
    expect(sessionStorage.getItem(OPENING_KEY)).toBeNull();
    markOpening("oz", loadedCover());
    expect(takeOpening("alice")).toBeNull();
    markOpening("oz", loadedCover());
    expect(takeOpening("oz", Date.now() + 60_000)).toBeNull();
  });

  it("never trusts an off-site image from storage", () => {
    sessionStorage.setItem(
      OPENING_KEY,
      JSON.stringify({
        bookId: "oz",
        src: "https://evil.example/x.png",
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        at: Date.now(),
      }),
    );
    expect(takeOpening("oz")).toBeNull();
  });

  it("drops the shelf layer when animation is unavailable", async () => {
    motion(false);
    playOpening("oz", loadedCover(), () => {});
    const host = document.createElement("div");
    document.body.append(host);
    await act(async () => createRoot(host).render(<BookOpening bookId="oz" />));
    // jsdom has no Element.animate, so the layer clears itself at once.
    expect(document.getElementById(SHELF_LAYER_ID)).toBeNull();
    expect(sessionStorage.getItem(OPENING_KEY)).toBeNull();
  });

  function fakeAnimate() {
    const anims: { onfinish: (() => void) | null; oncancel: (() => void) | null }[] = [];
    const animate = vi.fn(() => {
      const a = { onfinish: null, oncancel: null };
      anims.push(a);
      return a;
    });
    Object.defineProperty(HTMLElement.prototype, "animate", { value: animate, configurable: true });
    return { animate, anims };
  }

  it("navigates at once while the cover grows and fades over the shelf", () => {
    motion(false);
    const { animate } = fakeAnimate();
    const go = vi.fn();
    expect(playOpening("oz", loadedCover(), go)).toBe(true);
    expect(go).toHaveBeenCalledOnce();
    const layerEl = document.getElementById(SHELF_LAYER_ID);
    expect(layerEl?.querySelector(".book-opening-backdrop")).not.toBeNull();
    const frames = (animate.mock.calls[0] as unknown as [Keyframe[]])[0];
    expect(frames[0]).toMatchObject({ left: "10px", top: "20px", opacity: 1 });
    expect(frames.at(-1)).toMatchObject({ width: "100vw", opacity: 0 });
    delete (HTMLElement.prototype as { animate?: unknown }).animate;
  });

  it("goes straight to the reader under reduced motion", () => {
    motion(true);
    const go = vi.fn();
    expect(playOpening("oz", loadedCover(), go)).toBe(false);
    expect(go).not.toHaveBeenCalled();
    expect(document.getElementById(SHELF_LAYER_ID)).toBeNull();
  });

  it("the reader fades the backdrop out to cross fade, then clears the layer", async () => {
    motion(false);
    const { animate, anims } = fakeAnimate();
    playOpening("oz", loadedCover(), () => {});
    const host = document.createElement("div");
    document.body.append(host);
    await act(async () => createRoot(host).render(<BookOpening bookId="oz" />));
    // Still up during the cross fade, so the reader never flashes in.
    expect(document.getElementById(SHELF_LAYER_ID)).not.toBeNull();
    expect(animate).toHaveBeenLastCalledWith([expect.anything(), { opacity: 0 }], expect.anything());
    await act(async () => anims.at(-1)?.onfinish?.());
    expect(document.getElementById(SHELF_LAYER_ID)).toBeNull();
    delete (HTMLElement.prototype as { animate?: unknown }).animate;
  });
});
