"use client";

import { useEffect, useRef, useState } from "react";
import type { CastEntry } from "@/core/cast";
import { portraitFor } from "@/core/portraits";
import { Icon } from "../icons";

export const CAST_COPY = {
  title: "Cast so far",
  closed: "Who you have met, without spoilers",
  summary: (n: number) => `${n} ${n === 1 ? "character" : "characters"} met`,
  loading: "Gathering the cast…",
  failed: "The cast is unavailable right now",
  first: (ch: number, title: string) => `First met · Chapter ${ch}, ${title}`,
  known: "Known so far",
  expand: "Open the cast in a larger window",
  closeWindow: "Close cast window",
  scope: "Only the characters you have met so far.",
} as const;

type State = { sceneId: string; cast: CastEntry[] } | { sceneId: string; failed: true } | null;

// Fetches the cast up to this scene only while active; nothing loads,
// and no name reaches the page, until the reader opens the row or window.
function useCast(bookId: string, sceneId: string, active: boolean) {
  const [state, setState] = useState<State>(null);
  useEffect(() => {
    if (!active) return;
    const ctrl = new AbortController();
    fetch(`/api/cast?bookId=${encodeURIComponent(bookId)}&sceneId=${encodeURIComponent(sceneId)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ cast: CastEntry[] }>) : Promise.reject(new Error(String(r.status)))))
      .then((j) => setState({ sceneId, cast: j.cast }))
      .catch(() => {
        if (!ctrl.signal.aborted) setState({ sceneId, failed: true });
      });
    return () => ctrl.abort();
  }, [active, bookId, sceneId]);
  const current = active && state && state.sceneId === sceneId ? state : null;
  return { cast: current && "cast" in current ? current.cast : null, failed: Boolean(current && "failed" in current) };
}

function CastCard({ c, roomy, portrait }: { c: CastEntry; roomy?: boolean; portrait?: string | null }) {
  const name = <span className="marks-quote cast-name">{c.name}</span>;
  return (
    <li className={`marks-card has-note cast-card${roomy ? " cast-card-roomy" : ""}`}>
      {portrait ? (
        <span className="cast-name-row">
          {/* eslint-disable-next-line @next/next/no-img-element -- a 256px static teaser, no optimizer needed */}
          <img className="cast-portrait" src={portrait} alt={c.name} width={256} height={256} loading="lazy" decoding="async" />
          {name}
        </span>
      ) : (
        name
      )}
      <p className="marks-note cast-who">{c.description}</p>
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
      <p className="marks-note cast-first">{CAST_COPY.first(c.firstSeen.ch, c.firstSeen.title)}</p>
    </li>
  );
}

// The larger window reuses the Ask the book panel shell (.reader-chat
// position and fonts, .chat-panel frame, .chat-head, .chat-x), so it
// follows each skin the same way.
function CastWindow({
  bookId,
  sceneId,
  chapter,
  onClose,
}: {
  bookId: string;
  sceneId: string;
  chapter?: number;
  onClose: () => void;
}) {
  const { cast, failed } = useCast(bookId, sceneId, true);
  const xRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => xRef.current?.focus(), []);
  return (
    <div className="reader-chat cast-host">
      <section
        className="chat-panel cast-window"
        id="cast-window"
        role="dialog"
        aria-labelledby="cast-window-title"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="chat-head">
          <div className="chat-head-row">
            <h3 id="cast-window-title">{CAST_COPY.title}</h3>
            <button ref={xRef} type="button" className="chat-x" onClick={onClose} aria-label={CAST_COPY.closeWindow}>
              ×
            </button>
          </div>
          <p className="chat-scope">{cast ? `${CAST_COPY.summary(cast.length)}. ${CAST_COPY.scope}` : CAST_COPY.scope}</p>
        </div>
        <div className="chat-log cast-log">
          {cast ? (
            <ul className="cast-grid">
              {cast.map((c) => (
                <CastCard key={c.id} c={c} roomy portrait={portraitFor(bookId, c.id, chapter)} />
              ))}
            </ul>
          ) : (
            <p className="chat-welcome">{failed ? CAST_COPY.failed : CAST_COPY.loading}</p>
          )}
        </div>
      </section>
    </div>
  );
}

// A margin row like Notes & highlights. Closed, it fetches and shows
// nothing; open, it asks the server for the cast up to this scene only.
// The expand control opens the same cast in a larger window.
// chapter is the reader's current chapter; the protagonist portrait
// teaser shows only in chapter 1.
export function CastList({ bookId, sceneId, chapter }: { bookId: string; sceneId: string; chapter?: number }) {
  const [open, setOpen] = useState(false);
  const [big, setBig] = useState(false);
  const expandRef = useRef<HTMLButtonElement | null>(null);
  const { cast, failed } = useCast(bookId, sceneId, open);
  const sub = !open ? CAST_COPY.closed : cast ? CAST_COPY.summary(cast.length) : failed ? CAST_COPY.failed : CAST_COPY.loading;
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
      <button
        ref={expandRef}
        type="button"
        className="vault-x cast-expand"
        aria-label={CAST_COPY.expand}
        title={CAST_COPY.expand}
        aria-expanded={big}
        aria-controls="cast-window"
        onClick={() => setBig((v) => !v)}
      >
        <Icon name="expand" />
      </button>
      {open && cast ? (
        <ul id="cast-panel" className="marks-cards">
          {cast.map((c) => (
            <CastCard key={c.id} c={c} portrait={portraitFor(bookId, c.id, chapter)} />
          ))}
        </ul>
      ) : null}
      {big ? (
        <CastWindow
          bookId={bookId}
          sceneId={sceneId}
          chapter={chapter}
          onClose={() => {
            setBig(false);
            expandRef.current?.focus();
          }}
        />
      ) : null}
    </section>
  );
}
