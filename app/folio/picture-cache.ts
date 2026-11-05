// Session picture caches for the reader, shared across scene moves and
// remounts: the pane picture per book+scene+style, inline figures per
// book+scene, and the one request in flight. Module level on purpose, so
// every key must carry the book: scene ids repeat across books.
import { requestStyleFields } from "../image-style";
import type { ImageStylePref } from "../image-style";
import type { InlineFigure, SceneCard } from "./use-pictures";

export const sceneCache = new Map<string, { url: string; caption: string }>();
export const figureCache = new Map<string, InlineFigure[]>();
// Seeded by time so new ids never match vault entries saved by an earlier page load.
let figureSeq = Date.now();

export function nextFigureId(): string {
  return `f${figureSeq++}`;
}

// What is generating right now, across scene and book moves. One at a
// time. sceneId holds the book-keyed slot (sceneSlot or figureSlot).
export type InFlight = { kind: "scene"; sceneId: string } | { kind: "figure"; sceneId: string; id: string } | null;
export const flight: { current: InFlight } = { current: null };

export function release(mine: InFlight): void {
  if (flight.current === mine) flight.current = null;
}

// The pane picture depends on the book, the scene and the style sent, so
// its cache and in-flight slot are keyed by all three: scene ids repeat
// across books (every book has a c1s1), and a picture drawn in one book or
// style must never show for another.
export function sceneSlot(bookId: string, sceneId: string, pref: ImageStylePref): string {
  return `${bookId}\u0000${sceneId}\u0000${JSON.stringify(requestStyleFields(pref).style ?? null)}`;
}

// Inline figures belong to one book's scene; same reason as sceneSlot.
export function figureSlot(bookId: string, sceneId: string): string {
  return `${bookId}\u0000${sceneId}`;
}

export function sceneCard(slot: string): SceneCard {
  const hit = sceneCache.get(slot);
  if (hit) return { phase: "ready", url: hit.url, caption: hit.caption };
  return flight.current?.kind === "scene" && flight.current.sceneId === slot ? { phase: "loading" } : { phase: "idle" };
}

// Cached figures for a scene; a loading one shows only while it really is
// the request in flight.
export function sceneFigures(figSlot: string): InlineFigure[] {
  return (figureCache.get(figSlot) ?? []).filter(
    (f) => f.phase !== "loading" || (flight.current?.kind === "figure" && flight.current.sceneId === figSlot && flight.current.id === f.id),
  );
}
