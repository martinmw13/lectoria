"use client";

import { useLayoutEffect, useRef, useState } from "react";


// Opening from the shelf, in two halves. On the home, playOpening grows
// the (already loaded) cover from its place to fill the screen and only
// then lets the shelf navigate. The reader then finds that full-screen
// cover still up and fades it into the text. Once per click; reduced
// motion skips it and goes straight to the reader.
export const OPENING_KEY = "lectoria.opening";
const FRESH_MS = 5000;
const GROW_MS = 650;
const FADE_MS = 450;
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

// Home half: grows the cover over the shelf, then calls go(). Returns false
// (and does nothing) when there is no flourish, so the caller navigates as
// usual. The layer stays up until the reader takes over, or a guard clears it.
export function playOpening(bookId: string, img: HTMLImageElement | null, go: () => void): boolean {
  markOpening(bookId, img);
  const o = takeOpening(bookId);
  if (!o) return false;
  // Re-mark so the reader knows to fade the cover in.
  try {
    window.sessionStorage.setItem(OPENING_KEY, JSON.stringify(o));
  } catch {
    return false;
  }
  document.getElementById(SHELF_LAYER_ID)?.remove();
  const div = layer(o.src, SHELF_LAYER_ID);
  const cover = div.firstElementChild as HTMLImageElement;
  Object.assign(cover.style, { left: `${o.x}px`, top: `${o.y}px`, width: `${o.w}px`, height: `${o.h}px` });
  document.body.append(div);
  window.setTimeout(() => div.remove(), GROW_MS + 5000);
  let went = false;
  const done = () => {
    if (went) return;
    went = true;
    Object.assign(cover.style, { left: "0px", top: "0px", width: "100vw", height: "100dvh", borderRadius: "0px" });
    go();
  };
  if (typeof cover.animate !== "function") {
    done();
    return true;
  }
  const anim = cover.animate(
    [
      { left: `${o.x}px`, top: `${o.y}px`, width: `${o.w}px`, height: `${o.h}px`, borderRadius: "6px" },
      { left: "0px", top: "0px", width: "100vw", height: "100dvh", borderRadius: "0px" },
    ],
    { duration: GROW_MS, easing: "cubic-bezier(.5,0,.2,1)", fill: "forwards" },
  );
  anim.onfinish = done;
  anim.oncancel = done;
  window.setTimeout(done, GROW_MS + 300);
  return true;
}

// Reader half: the cover is already full screen; take over from the home's
// layer before first paint and fade it out to reveal the text.
export function BookOpening({ bookId }: { bookId: string }) {
  const [opening, setOpening] = useState<Opening | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useLayoutEffect(() => {
    const o = takeOpening(bookId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot read of the shelf's mark before first paint
    if (o && !reducedMotion()) setOpening(o);
    else document.getElementById(SHELF_LAYER_ID)?.remove();
  }, [bookId]);

  useLayoutEffect(() => {
    const img = imgRef.current;
    if (!opening || !img) return;
    document.getElementById(SHELF_LAYER_ID)?.remove();
    const done = () => setOpening(null);
    if (typeof img.animate !== "function") return done();
    const anim = img.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: FADE_MS,
      easing: "ease-out",
      fill: "forwards",
    });
    anim.onfinish = done;
    anim.oncancel = done;
    const guard = window.setTimeout(done, FADE_MS + 400);
    return () => window.clearTimeout(guard);
  }, [opening]);

  if (!opening) return null;
  return (
    <div className="book-opening" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- the shelf's cached cover, reused as is */}
      <img ref={imgRef} src={opening.src} alt="" decoding="sync" className="book-opening-full" />
    </div>
  );
}
