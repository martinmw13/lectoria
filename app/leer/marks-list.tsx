"use client";

import { useState } from "react";
import type { Mark } from "./marks";

export const LIST_COPY = {
  launch: (n: number) => `Notes and highlights · ${n}`,
  title: "Your notes and highlights",
  go: "Go to passage",
  remove: "Remove",
  close: "Close",
} as const;

// A quiet launcher, shown once the book has a mark; the panel lists them
// in reading order with a jump and a remove for each.
export function MarksList({
  marks,
  onGo,
  onRemove,
}: {
  marks: Mark[];
  onGo: (mark: Mark) => void;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (marks.length === 0) return null;
  return (
    <div className="marks-list">
      {open ? (
        <section id="marks-panel" className="marks-panel" aria-label={LIST_COPY.title}>
          <h2>{LIST_COPY.title}</h2>
          <ul>
            {marks.map((m) => (
              <li key={m.id} className={m.note ? "has-note" : undefined}>
                <button type="button" className="marks-quote" onClick={() => onGo(m)} aria-label={`${LIST_COPY.go}: ${m.quote}`}>
                  “{m.quote}”
                </button>
                {m.note ? <p className="marks-note">{m.note}</p> : null}
                <button type="button" className="sel-btn marks-remove" onClick={() => onRemove(m.id)}>
                  {LIST_COPY.remove}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <button
        type="button"
        className="marks-launch"
        aria-expanded={open}
        aria-controls="marks-panel"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? LIST_COPY.close : LIST_COPY.launch(marks.length)}
      </button>
    </div>
  );
}
