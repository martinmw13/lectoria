"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";
import { clampNote, loadMarks, rangesFor, saveMarks, type Mark } from "./marks";

type Draft = Omit<Mark, "id">;

// Paint with the CSS Custom Highlight API: no DOM wrapping, so React keeps
// owning the paragraphs. Browsers without it keep the marks in the list.
function paint(name: string, ranges: Range[]) {
  const registry = typeof CSS !== "undefined" ? CSS.highlights : undefined;
  if (!registry || typeof Highlight === "undefined") return;
  if (ranges.length === 0) registry.delete(name);
  else registry.set(name, new Highlight(...ranges));
}

export function useMarks(bookId: string, rootRef: RefObject<HTMLElement | null>) {
  const [marks, setMarks] = useState<Mark[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage loads after hydration
    setMarks(loadMarks(bookId));
  }, [bookId]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    paint("lectoria-mark", marks.filter((m) => !m.note).flatMap((m) => rangesFor(m, root)));
    paint("lectoria-note", marks.filter((m) => m.note).flatMap((m) => rangesFor(m, root)));
    return () => {
      paint("lectoria-mark", []);
      paint("lectoria-note", []);
    };
  }, [marks, rootRef]);

  const update = useCallback(
    (fn: (prev: Mark[]) => Mark[]) => {
      setMarks((prev) => {
        const next = fn(prev).sort((a, b) => a.startN - b.startN || a.startOff - b.startOff);
        saveMarks(bookId, next);
        return next;
      });
    },
    [bookId],
  );

  const add = useCallback(
    (draft: Draft, note?: string) => {
      const text = note === undefined ? "" : clampNote(note);
      const mark: Mark = { ...draft, id: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` };
      update((prev) => [...prev, text ? { ...mark, note: text } : mark]);
    },
    [update],
  );

  const remove = useCallback((id: string) => update((prev) => prev.filter((m) => m.id !== id)), [update]);

  // An empty note keeps the passage as a plain highlight.
  const setNote = useCallback(
    (id: string, note: string) => {
      const text = clampNote(note);
      update((prev) =>
        prev.map((m) => {
          if (m.id !== id) return m;
          const next: Mark = { ...m, note: text };
          if (!text) delete next.note;
          return next;
        }),
      );
    },
    [update],
  );

  return { marks, add, remove, setNote };
}

export type MarksApi = ReturnType<typeof useMarks>;
