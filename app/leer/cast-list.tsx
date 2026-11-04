"use client";

import { useEffect, useState } from "react";
import type { CastEntry } from "@/core/cast";
import { Icon } from "../icons";

export const CAST_COPY = {
  title: "Cast so far",
  closed: "Who you have met, without spoilers",
  summary: (n: number) => `${n} ${n === 1 ? "character" : "characters"} met`,
  loading: "Gathering the cast…",
  failed: "The cast is unavailable right now",
  first: (ch: number, title: string) => `First met · Chapter ${ch}, ${title}`,
  known: "Known so far",
} as const;

type State = { sceneId: string; cast: CastEntry[] } | { sceneId: string; failed: true } | null;

// A margin row like Notes & highlights. Closed, it fetches and shows
// nothing; open, it asks the server for the cast up to this scene only.
export function CastList({ bookId, sceneId }: { bookId: string; sceneId: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>(null);
  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    fetch(`/api/cast?bookId=${encodeURIComponent(bookId)}&sceneId=${encodeURIComponent(sceneId)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ cast: CastEntry[] }>) : Promise.reject(new Error(String(r.status)))))
      .then((j) => setState({ sceneId, cast: j.cast }))
      .catch(() => {
        if (!ctrl.signal.aborted) setState({ sceneId, failed: true });
      });
    return () => ctrl.abort();
  }, [open, bookId, sceneId]);
  const current = open && state && state.sceneId === sceneId ? state : null;
  const cast = current && "cast" in current ? current.cast : null;
  const sub = !open ? CAST_COPY.closed : cast ? CAST_COPY.summary(cast.length) : current ? CAST_COPY.failed : CAST_COPY.loading;
  return (
    <section className="marks cast" aria-label={CAST_COPY.title}>
      <button
        type="button"
        className="mtool marks-row"
        aria-expanded={open}
        aria-controls="cast-panel"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="mtool-icon">
          <Icon name="heart" width={18} height={18} />
        </span>
        <span className="mtool-text">
          <span className="mtool-title">{CAST_COPY.title}</span>
          <span className="mtool-sub">{sub}</span>
        </span>
        {cast ? <span className="marks-count">{cast.length}</span> : null}
        <Icon name="chevron-down" className="marks-chev" />
      </button>
      {open && cast ? (
        <ul id="cast-panel" className="marks-cards">
          {cast.map((c) => (
            <li key={c.id} className="marks-card has-note cast-card">
              <span className="marks-quote cast-name">{c.name}</span>
              <p className="marks-note cast-first">{CAST_COPY.first(c.firstSeen.ch, c.firstSeen.title)}</p>
              <p className="marks-note">{c.description}</p>
              {c.known.length > 0 ? (
                <>
                  <p className="marks-note cast-known-label">{CAST_COPY.known}</p>
                  <ul className="cast-known">
                    {c.known.map((k, i) => (
                      <li key={i} className="marks-note">
                        {k}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
