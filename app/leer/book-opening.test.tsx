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

  it("shows the cover layer, then removes it when animation is unavailable", async () => {
    motion(false);
    markOpening("oz", loadedCover());
    const host = document.createElement("div");
    document.body.append(host);
    await act(async () => createRoot(host).render(<BookOpening bookId="oz" />));
    // jsdom has no Element.animate, so the layer clears itself at once.
    expect(host.querySelector(".book-opening")).toBeNull();
    expect(sessionStorage.getItem(OPENING_KEY)).toBeNull();
  });

  it("grows the cover over the shelf before navigating", () => {
    motion(false);
    const anim: { onfinish: (() => void) | null; oncancel: (() => void) | null } = { onfinish: null, oncancel: null };
    const animate = vi.fn(() => anim);
    Object.defineProperty(HTMLElement.prototype, "animate", { value: animate, configurable: true });
    const go = vi.fn();
    expect(playOpening("oz", loadedCover(), go)).toBe(true);
    // The reader is not opened while the cover is still growing.
    expect(document.getElementById(SHELF_LAYER_ID)).not.toBeNull();
    expect(go).not.toHaveBeenCalled();
    anim.onfinish?.();
    expect(go).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem(OPENING_KEY)).not.toBeNull();
    delete (HTMLElement.prototype as { animate?: unknown }).animate;
  });

  it("goes straight to the reader under reduced motion", () => {
    motion(true);
    const go = vi.fn();
    expect(playOpening("oz", loadedCover(), go)).toBe(false);
    expect(go).not.toHaveBeenCalled();
    expect(document.getElementById(SHELF_LAYER_ID)).toBeNull();
  });

  it("takes over the shelf's full-screen cover and fades it out", async () => {
    motion(false);
    const anim: {
      onfinish: (() => void) | null;
      oncancel: (() => void) | null;
    } = { onfinish: null, oncancel: null };
    const animate = vi.fn(() => anim);
    Object.defineProperty(HTMLElement.prototype, "animate", {
      value: animate,
      configurable: true,
    });
    playOpening("oz", loadedCover(), () => {});
    anim.onfinish?.();
    const host = document.createElement("div");
    document.body.append(host);
    await act(async () => createRoot(host).render(<BookOpening bookId="oz" />));
    expect(document.getElementById(SHELF_LAYER_ID)).toBeNull();
    expect(host.querySelector(".book-opening img")?.getAttribute("src")).toBe("/covers/oz.webp");
    expect(animate).toHaveBeenLastCalledWith([{ opacity: 1 }, { opacity: 0 }], expect.anything());
    await act(async () => anim.onfinish?.());
    expect(host.querySelector(".book-opening")).toBeNull();
    delete (HTMLElement.prototype as { animate?: unknown }).animate;
  });
});
