"use client";

import { useState } from "react";
import { Icon } from "../icons";
import type { Mark } from "./marks";

export const LIST_COPY = {
  title: "Notes & highlights",
  summary: (marks: Mark[]) => {
    const notes = marks.filter((m) => m.note).length;
    const lights = marks.length - notes;
    return `${lights} ${lights === 1 ? "highlight" : "highlights"} · ${notes} ${notes === 1 ? "note" : "notes"}`;
  },
  empty: "Select a line to keep it here",
  go: "Go to passage",
  remove: "Remove",
} as const;

// A margin row under the Picture Vault. It opens into one card per mark,
// in reading order, each with a jump and a remove.
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
  const any = marks.length > 0;
  return (
    <section className="marks" aria-label={LIST_COPY.title}>
      <button
        type="button"
        className="mtool marks-row"
        aria-expanded={any && open}
        aria-controls="marks-panel"
        disabled={!any}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="mtool-icon">
          <Icon name="book" width={18} height={18} />
        </span>
        <span className="mtool-text">
          <span className="mtool-title">{LIST_COPY.title}</span>
          <span className="mtool-sub">{any ? LIST_COPY.summary(marks) : LIST_COPY.empty}</span>
        </span>
        {any ? (
          <>
            <span className="marks-count">{marks.length}</span>
            <Icon name="chevron-down" className="marks-chev" />
          </>
        ) : null}
      </button>
      {any && open ? (
        <ul id="marks-panel" className="marks-cards">
          {marks.map((m) => (
            <li key={m.id} className={m.note ? "marks-card has-note" : "marks-card"}>
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
      ) : null}
    </section>
  );
}
