"use client";

import { useLayoutEffect } from "react";


// Opening from the shelf: the (already loaded) cover grows from its place
// and fades while the reader fades in under it. Once per click; reduced
// motion skips it and goes straight to the reader.
export const OPENING_KEY = "lectoria.opening";
const FRESH_MS = 5000;
const TOTAL_MS = 1000;
const BACKDROP_IN_MS = 300;
const MIN_FADE_MS = 350;
// The home's layer lives outside React so it survives the route change.
export const SHELF_LAYER_ID = "book-opening-shelf";

export interface Opening {
  bookId: string;
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
  at: number;
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}

export function markOpening(bookId: string, img: HTMLImageElement | null): void {
  if (!img || !img.complete || img.naturalWidth === 0 || reducedMotion()) return;
  const r = img.getBoundingClientRect();
  const opening: Opening = {
    bookId,
    src: img.currentSrc || img.src,
    x: r.left,
    y: r.top,
    w: r.width,
    h: r.height,
    at: Date.now(),
  };
  try {
    window.sessionStorage.setItem(OPENING_KEY, JSON.stringify(opening));
  } catch {
    // No storage: the book opens without the flourish.
  }
}

// Reads and clears the mark, so a reload or a later visit never replays it.
export function takeOpening(bookId: string, now = Date.now()): Opening | null {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(OPENING_KEY);
    window.sessionStorage.removeItem(OPENING_KEY);
  } catch {
    return null;
  }
  try {
    const o = JSON.parse(raw ?? "null") as Partial<Opening> | null;
    if (!o || o.bookId !== bookId || typeof o.at !== "number" || now - o.at > FRESH_MS || now < o.at) return null;
    const nums = [o.x, o.y, o.w, o.h];
    if (!nums.every((n) => typeof n === "number" && Number.isFinite(n)) || !(o.w! > 0 && o.h! > 0)) return null;
    let src: URL;
    try {
      src = new URL(String(o.src), window.location.origin);
    } catch {
      return null;
    }
    // Same-origin covers only: the stored value is never trusted as a URL.
    if (src.origin !== window.location.origin) return null;
    return {
      bookId,
      src: src.pathname + src.search,
      x: o.x!,
      y: o.y!,
      w: o.w!,
      h: o.h!,
      at: o.at,
    };
  } catch {
    return null;
  }
}

function layer(src: string, id?: string): HTMLDivElement {
  const div = document.createElement("div");
  div.className = "book-opening";
  div.setAttribute("aria-hidden", "true");
  if (id) div.id = id;
  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  img.decoding = "sync";
  div.append(img);
  return div;
}

// The backdrop wears the page's own paper and skin painting (the home's
// fixed .ob-desk::before), so the shelf dissolves into the backdrop the
// reader shares instead of into a flat colour.
function paintLike(el: HTMLElement): void {
  const body = getComputedStyle(document.body);
  el.style.backgroundColor = body.backgroundColor;
  el.style.backgroundImage = body.backgroundImage;
  const desk = document.querySelector(".ob-desk");
  if (!desk) return;
  const art = getComputedStyle(desk, "::before");
  if (!art.backgroundImage || art.backgroundImage === "none") return;
  el.style.backgroundImage = `${art.backgroundImage}, ${body.backgroundImage}`.replace(/, none$/, "");
  el.style.backgroundSize = art.backgroundSize;
  el.style.backgroundPosition = art.backgroundPosition;
  el.style.backgroundRepeat = art.backgroundRepeat;
  if (art.backgroundColor !== "rgba(0, 0, 0, 0)") el.style.backgroundColor = art.backgroundColor;
}

// Home half: navigates at once and, over the shelf, grows the cover to
// fill the screen while it fades out. An opaque backdrop in the page paint
// fades in under it so the shelf leaves; the reader, rendered underneath,
// fades in over that backdrop, so the end is one cross fade. Returns false (and
// does nothing) when there is no flourish, so the caller navigates as usual.
export function playOpening(bookId: string, img: HTMLImageElement | null, go: () => void): boolean {
  markOpening(bookId, img);
  const o = takeOpening(bookId);
  if (!o) return false;
  try {
    window.sessionStorage.setItem(OPENING_KEY, JSON.stringify(o));
  } catch {
    return false;
  }
  document.getElementById(SHELF_LAYER_ID)?.remove();
  const div = layer(o.src, SHELF_LAYER_ID);
  const cover = div.firstElementChild as HTMLImageElement;
  const backdrop = document.createElement("div");
  backdrop.className = "book-opening-backdrop";
  paintLike(backdrop);
  div.prepend(backdrop);
  Object.assign(cover.style, { left: `${o.x}px`, top: `${o.y}px`, width: `${o.w}px`, height: `${o.h}px` });
  document.body.append(div);
  // Guard: never leave the layer up if the reader does not take over.
  window.setTimeout(() => div.remove(), TOTAL_MS + 4000);
  if (typeof cover.animate === "function") {
    const from = { left: `${o.x}px`, top: `${o.y}px`, width: `${o.w}px`, height: `${o.h}px` };
    const full = { left: "0px", top: "0px", width: "100vw", height: "100dvh" };
    cover.animate(
      [
        { ...from, opacity: 1, borderRadius: "6px", offset: 0 },
        { opacity: 1, offset: 0.3 },
        { ...full, opacity: 0, borderRadius: "0px", offset: 1 },
      ],
      { duration: TOTAL_MS, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" },
    );
    backdrop.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: BACKDROP_IN_MS,
      easing: "ease-out",
      fill: "forwards",
    });
  } else {
    backdrop.style.opacity = "1";
    cover.style.opacity = "0";
  }
  // The reader loads during the grow, so it is ready for the cross fade.
  go();
  return true;
}

// Reader half: before its first paint, fade the whole reader in (the
// .folio root, which carries the skin painting in its fixed ::before) over
// the backdrop, now moved under the page, in step with the cover's fade.
export function BookOpening({ bookId }: { bookId: string }) {
  useLayoutEffect(() => {
    const o = takeOpening(bookId);
    const div = document.getElementById(SHELF_LAYER_ID);
    if (!div) return;
    const backdrop = div.querySelector<HTMLElement>(".book-opening-backdrop");
    if (!o || reducedMotion() || !backdrop || typeof backdrop.animate !== "function") {
      div.remove();
      return;
    }
    // Finish together with the cover, but never faster than a soft fade.
    const left = Math.max(MIN_FADE_MS, o.at + TOTAL_MS - Date.now());
    const timing = { duration: left, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" } as const;
    // Below the reader, so the reader and its painting fade in over it.
    backdrop.classList.add("book-opening-under");
    backdrop.style.opacity = "1";
    document.body.prepend(backdrop);
    const folio = document.querySelector<HTMLElement>(".folio");
    const reveal = folio?.animate([{ opacity: 0 }, { opacity: 1 }], timing);
    const anim = backdrop.animate([{ opacity: 1 }, { opacity: 0 }], timing);
    const done = () => {
      // Drop the held frame so the reader keeps no stacking context.
      reveal?.cancel?.();
      backdrop.remove();
      div.remove();
    };
    anim.onfinish = done;
    anim.oncancel = done;
    const guard = window.setTimeout(done, left + 300);
    return () => {
      window.clearTimeout(guard);
      done();
    };
  }, [bookId]);
  return null;
}
