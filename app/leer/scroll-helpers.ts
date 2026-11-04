// Continuous-scroll helpers: pure scene picking, section jumps, and the
// narration auto-follow pause. No React, no listeners on scroll (the
// observer in book-view.tsx owns scroll position without layout reads).
export interface SceneVisibility {
  id: string;
  ratio: number;
}

// Current scene = the visible section with the largest intersection ratio.
// Ties keep document order, so the upper section wins at exact 50/50 and
// the id only changes once the lower one dominates. Null when nothing is
// visible; the caller keeps the previous id.
export function pickCurrentScene(order: string[], visible: Map<string, SceneVisibility>): string | null {
  let best: string | null = null;
  let bestRatio = 0;
  for (const id of order) {
    const entry = visible.get(id);
    const ratio = entry && entry.id === id ? entry.ratio : 0;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = id;
    }
  }
  return best;
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// Scroll the scroller so the scene section sits at its top; a chapter's
// first scene lands on the chapter heading instead. False when the
// section is missing. A jump pauses narration follow so the glide never
// fights it.
//
// Sections use content-visibility: auto with a 1200px placeholder
// height, so any offset computed before the sections on the way render
// is a guess. A smooth scroll fixes its destination up front and then
// lands wherever that guess points once real heights replace the
// placeholders (often several scenes off). So the jump is instant and
// then re-aligns the target on later frames until its top stops moving.
// `smooth` only applies when the target is already within a screen of
// the viewport, where no unrendered sections sit in between.
const settling = new WeakMap<object, number>();
let settleSeq = 0;

export function scrollToSceneId(scroller: HTMLElement, sceneId: string, smooth = true): boolean {
  const el = scroller.querySelector(`[data-scene-id="${sceneId}"]`);
  if (!el || typeof el.scrollIntoView !== "function") return false;
  noteUserScroll(scroller);
  const block = el.closest?.(".chapter-block");
  const target = block && block.querySelector("[data-scene-id]") === el ? block : el;
  const offset = () => target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  const near = Math.abs(offset()) < scroller.clientHeight;
  const glide = smooth && near && !prefersReducedMotion();
  target.scrollIntoView({ block: "start", behavior: glide ? "smooth" : "auto" });
  if (glide || typeof requestAnimationFrame !== "function") return true;
  const token = ++settleSeq;
  settling.set(scroller, token);
  let frames = 0;
  let still = 0;
  const settle = () => {
    // A newer jump or a user scroll (noteUserScroll clears the token) ends this one.
    if (settling.get(scroller) !== token) return;
    const off = offset();
    if (Math.abs(off) > 1) {
      target.scrollIntoView({ block: "start", behavior: "auto" });
      still = 0;
    } else still += 1;
    frames += 1;
    if (still < 3 && frames < 60) requestAnimationFrame(settle);
    else settling.delete(scroller);
  };
  requestAnimationFrame(settle);
  return true;
}

// Narration auto-follow pause: the last user-driven scroll moment per
// scroller. Listeners attach once per scroller and stay passive.
const lastUserScroll = new WeakMap<object, number>();

export function noteUserScroll(scroller: object, now: number = Date.now()): void {
  lastUserScroll.set(scroller, now);
  settling.delete(scroller);
  pendingTarget.delete(scroller);
  stopGlide(scroller);
}

export function attachFollowPause(scroller: HTMLElement): () => void {
  const mark = () => noteUserScroll(scroller);
  const onPointerDown = (event: Event) => {
    if (event.target === scroller) noteUserScroll(scroller);
  };
  scroller.addEventListener("wheel", mark, { passive: true });
  scroller.addEventListener("touchstart", mark, { passive: true });
  scroller.addEventListener("pointerdown", onPointerDown, { passive: true });
  window.addEventListener("keydown", mark);
  return () => {
    scroller.removeEventListener("wheel", mark);
    scroller.removeEventListener("touchstart", mark);
    scroller.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("keydown", mark);
  };
}

// Keep the spoken word in a comfortable band (20% to 60% of the scroller
// viewport). Inside it nothing moves. Once the word's line passes 60%,
// one slow eased glide brings it back to 38%, a few lines at a time, so
// the page drifts steadily instead of leaping (instant with reduced
// motion). The band is judged against the glide's target while it is in
// flight, so frames never stack scrolls. A box taller than the band
// follows its top only. Never within pauseMs of a user scroll, and a
// user scroll stops a glide mid-way. Returns true when it scrolled or a
// scroll is on its way.
const pendingTarget = new WeakMap<object, number>();
const glides = new WeakMap<object, () => void>();

const BAND_TOP = 0.2;
const BAND_BOTTOM = 0.6;
const ANCHOR = 0.38;

function stopGlide(scroller: object): void {
  glides.get(scroller)?.();
  glides.delete(scroller);
}

// Ease-in-out over 500 to 900 ms depending on distance. Without a real
// window (tests, SSR) the scroll lands at once.
function glideTo(scroller: HTMLElement, target: number): void {
  stopGlide(scroller);
  const win = scroller.ownerDocument?.defaultView;
  if (prefersReducedMotion() || !win || typeof win.requestAnimationFrame !== "function") {
    scroller.scrollTop = target;
    return;
  }
  const from = scroller.scrollTop;
  const distance = target - from;
  const duration = Math.min(900, Math.max(500, Math.abs(distance) * 3));
  const t0 = win.performance.now();
  let raf = 0;
  const step = (now: number) => {
    const p = Math.min(1, (now - t0) / duration);
    const eased = 0.5 - Math.cos(Math.PI * p) / 2;
    scroller.scrollTop = from + distance * eased;
    if (p < 1) raf = win.requestAnimationFrame(step);
    else glides.delete(scroller);
  };
  raf = win.requestAnimationFrame(step);
  glides.set(scroller, () => win.cancelAnimationFrame(raf));
}

export function followIntoView(
  el: { getBoundingClientRect(): DOMRect },
  scroller: HTMLElement,
  now: number = Date.now(),
  pauseMs = 4000,
): boolean {
  const last = lastUserScroll.get(scroller) ?? Number.NEGATIVE_INFINITY;
  if (now - last < pauseMs) return false;
  const frame = scroller.getBoundingClientRect();
  const box = el.getBoundingClientRect();
  let pending = pendingTarget.get(scroller);
  if (pending !== undefined && Math.abs(scroller.scrollTop - pending) < 2) {
    pendingTarget.delete(scroller);
    pending = undefined;
  }
  const contentTop = box.top - frame.top + scroller.scrollTop;
  const rel = contentTop - (pending ?? scroller.scrollTop);
  const tall = box.height >= frame.height * (BAND_BOTTOM - BAND_TOP);
  if (rel >= frame.height * BAND_TOP && (tall || rel + box.height <= frame.height * BAND_BOTTOM)) {
    return pending !== undefined;
  }
  let target = Math.max(0, contentTop - frame.height * ANCHOR);
  const max = scroller.scrollHeight - scroller.clientHeight;
  if (Number.isFinite(max)) target = Math.min(target, max);
  if (Math.abs(target - scroller.scrollTop) < 2) return false;
  pendingTarget.set(scroller, target);
  glideTo(scroller, target);
  return true;
}
