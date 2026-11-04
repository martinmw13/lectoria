// The home turns like a paper page, peeling from the bottom-right corner to
import type React from "react";
// reveal the reader, which is already rendered underneath. Ported from the
// approved prototype (variant D): the lifted corner P travels from the corner
// C to the left edge, the fold is the perpendicular bisector of C-P, and the
// flap is cut from the page and drawn reflected across the fold as its back.

export type Point = [number, number];
export const TURN_MS = 900;
const FADE_MS = 220;
const READY_TIMEOUT_MS = 8000;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// Sutherland-Hodgman: keep the part of the polygon where f(p) <= 0.
function cut(pts: Point[], f: (p: Point) => number): Point[] {
  const out: Point[] = [];
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length] ?? a;
    const fa = f(a);
    const fb = f(b);
    if (fa <= 0) out.push(a);
    if (fa <= 0 !== fb <= 0) {
      const k = fa / (fa - fb);
      out.push([a[0] + k * (b[0] - a[0]), a[1] + k * (b[1] - a[1])]);
    }
  });
  return out;
}

export type TurnFrame = { keep: Point[]; flap: Point[]; back: Point[]; fold: Point; toCorner: number; e: number };

export function turnFrame(t: number, W: number, H: number): TurnFrame {
  const e = Math.max(0.001, ease(Math.min(1, Math.max(0, t))));
  const P: Point = [W - e * 2 * W, H - Math.sin(Math.PI * e) * H * 0.32];
  const len = Math.hypot(W - P[0], H - P[1]);
  const d: Point = [(W - P[0]) / len, (H - P[1]) / len];
  const M: Point = [(W + P[0]) / 2, (H + P[1]) / 2];
  const f = (p: Point) => (p[0] - M[0]) * d[0] + (p[1] - M[1]) * d[1];
  const rect: Point[] = [[0, 0], [W, 0], [W, H], [0, H]];
  const flap = cut(rect, (p) => -f(p));
  const back = flap.map((p): Point => [p[0] - 2 * f(p) * d[0], p[1] - 2 * f(p) * d[1]]);
  return { keep: cut(rect, f), flap, back, fold: M, toCorner: Math.atan2(d[1], d[0]), e };
}

const poly = (pts: Point[]) =>
  pts.length ? `polygon(${pts.map((p) => `${p[0].toFixed(1)}px ${p[1].toFixed(1)}px`).join(",")})` : "polygon(0 0,0 0,0 0)";

function layer(cls: string, parent: HTMLElement): HTMLDivElement {
  const el = document.createElement("div");
  el.className = cls;
  parent.append(el);
  return el;
}

// A wide band anchored on the fold line, rotated to face `angle`.
function band(g: HTMLElement, M: Point, angle: number, W: number, H: number, flip = false) {
  const L = Math.hypot(W, H) * 2.2;
  Object.assign(g.style, {
    left: `${M[0]}px`,
    top: `${M[1] - L / 2}px`,
    width: `${L}px`,
    height: `${L}px`,
    transform: `rotate(${angle}rad)${flip ? " translateX(-100%)" : ""}`,
  });
}

const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));

async function readerReady(path: string) {
  const start = performance.now();
  while (performance.now() - start < READY_TIMEOUT_MS) {
    if (location.pathname === path && document.querySelector(".folio")) break;
    await nextFrame();
  }
  // Two frames so the reader has painted under the still page.
  await nextFrame();
  await nextFrame();
}

// Freezes the home as an overlay, navigates under it, then turns the overlay
// away once the reader has rendered. Returns false when it cannot run.
export function turnPageTo(href: string, navigate: (href: string) => void): boolean {
  const home = document.querySelector<HTMLElement>("main.ob-desk");
  if (!home) return false;
  const W = innerWidth;
  const H = innerHeight;
  const root = layer("pt-root", document.body);
  root.setAttribute("aria-hidden", "true");
  const page = layer("pt-page", root);
  const copy = home.cloneNode(true) as HTMLElement;
  copy.removeAttribute("id");
  copy.style.marginTop = `${-scrollY}px`;
  page.append(copy);
  const path = new URL(href, location.href).pathname;
  navigate(href);

  void readerReady(path).then(async () => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      await page.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, fill: "forwards" }).finished;
      root.remove();
      return;
    }
    const cast = layer("pt-cast", root);
    const castG = layer("pt-g", cast);
    const frontG = layer("pt-g", layer("pt-front", page));
    const back = layer("pt-back", layer("pt-backwrap", root));
    const backG = layer("pt-g", back);
    const t0 = performance.now();
    for (;;) {
      const t = Math.min(1, (performance.now() - t0) / TURN_MS);
      const fr = turnFrame(t, W, H);
      const toFold = fr.toCorner + Math.PI;
      page.style.clipPath = poly(fr.keep);
      back.style.clipPath = poly(fr.back);
      cast.style.clipPath = poly(fr.flap);
      cast.style.opacity = String(Math.min(1, (1 - fr.e) * 3));
      band(backG, fr.fold, toFold, W, H);
      band(frontG, fr.fold, toFold, W, H, true);
      band(castG, fr.fold, fr.toCorner, W, H);
      if (t >= 1) break;
      await nextFrame();
    }
    root.remove();
  });
  return true;
}

// Click handler for links into the reader. Modified clicks (new tab or
// window) keep the browser's behaviour.
export function pageTurnClick(navigate: (href: string) => void) {
  return (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const href = e.currentTarget.getAttribute("href");
    if (href && turnPageTo(href, navigate)) e.preventDefault();
  };
}
