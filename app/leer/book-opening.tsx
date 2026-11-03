"use client";

import { useLayoutEffect, useRef, useState } from "react";

// Opening from the shelf: the shelf stores where its cover sits, and the
// reader grows that same (already loaded) image to fill the screen, then
// fades it into the text. Once per click; reduced motion skips it.
export const OPENING_KEY = "lectoria.opening";
const FRESH_MS = 5000;
const DURATION_MS = 1100;

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

export function BookOpening({ bookId }: { bookId: string }) {
  const [opening, setOpening] = useState<Opening | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Layout effects run before the reader's first paint, so the cover is
  // already on screen when the text appears under it.
  useLayoutEffect(() => {
    const o = takeOpening(bookId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot read of the shelf's mark before first paint
    if (o && !reducedMotion()) setOpening(o);
  }, [bookId]);

  useLayoutEffect(() => {
    const img = imgRef.current;
    if (!opening || !img) return;
    const done = () => setOpening(null);
    if (typeof img.animate !== "function") return done();
    const from = {
      left: `${opening.x}px`,
      top: `${opening.y}px`,
      width: `${opening.w}px`,
      height: `${opening.h}px`,
    };
    const full = { left: "0px", top: "0px", width: "100vw", height: "100dvh" };
    const anim = img.animate(
      [
        { ...from, opacity: 1, borderRadius: "6px", offset: 0 },
        { ...full, opacity: 1, borderRadius: "0px", offset: 0.5 },
        { ...full, opacity: 0, borderRadius: "0px", offset: 1 },
      ],
      {
        duration: DURATION_MS,
        easing: "cubic-bezier(.5,0,.2,1)",
        fill: "forwards",
      },
    );
    anim.onfinish = done;
    anim.oncancel = done;
    const guard = window.setTimeout(done, DURATION_MS + 400);
    return () => window.clearTimeout(guard);
  }, [opening]);

  if (!opening) return null;
  return (
    <div className="book-opening" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- the shelf's cached cover, reused as is */}
      <img
        ref={imgRef}
        src={opening.src}
        alt=""
        decoding="sync"
        style={{
          left: opening.x,
          top: opening.y,
          width: opening.w,
          height: opening.h,
        }}
      />
    </div>
  );
}
