"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CastEntry } from "@/core/cast";
import { portraitFor, type PortraitSrc } from "@/core/portraits";
import { useSkin } from "../use-skin";
import { Icon } from "../icons";

export const CAST_COPY = {
  title: "Cast so far",
  closed: "Who you have met, without spoilers",
  summary: (n: number) => `${n} ${n === 1 ? "character" : "characters"} met`,
  loading: "Gathering the cast…",
  failed: "The cast is unavailable right now",
  first: (ch: number, title: string) => `First met · Chapter ${ch}, ${title}`,
  known: "Known so far",
  open: "Open cast window",
  showList: "Show the cast list",
  hideList: "Hide the cast list",
  closeWindow: "Close cast window",
  scope: "Only the characters you have met so far.",
  zoom: (name: string) => `Enlarge portrait of ${name}`,
  closeZoom: "Close portrait",
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

// The thumb is a button; opening it mounts the ~512px image, so the
// large file loads only when the reader asks for it. Portaled to body
// so the cast window's frame does not clip it; skin tokens still apply.
function PortraitZoom({ name, portrait }: { name: string; portrait: PortraitSrc }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const xRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (open) xRef.current?.focus();
  }, [open]);
  const close = () => {
    setOpen(false);
    btnRef.current?.focus();
  };
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="cast-portrait-btn"
        aria-label={CAST_COPY.zoom(name)}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a 256px static teaser, no optimizer needed */}
        <img className="cast-portrait" src={portrait.src} alt={name} width={256} height={256} loading="lazy" decoding="async" />
      </button>
      {open
        ? createPortal(
            <div
              className="portrait-zoom-backdrop"
              onClick={(e) => {
                if (e.target === e.currentTarget) close();
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  close();
                }
              }}
            >
              <figure className="portrait-zoom" role="dialog" aria-modal="true" aria-label={name}>
                <button ref={xRef} type="button" className="chat-x portrait-zoom-x" onClick={close} aria-label={CAST_COPY.closeZoom}>
                  ×
                </button>
                {/* eslint-disable-next-line @next/next/no-img-element -- static 512px asset, mounted only when opened */}
                <img className="portrait-zoom-img" src={portrait.large} alt={name} width={512} height={512} decoding="async" />
                <figcaption className="portrait-zoom-cap">{name}</figcaption>
              </figure>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function CastCard({ c, roomy, portrait }: { c: CastEntry; roomy?: boolean; portrait?: PortraitSrc | null }) {
  const name = <span className="marks-quote cast-name">{c.name}</span>;
  return (
    <li className={`marks-card has-note cast-card${roomy ? " cast-card-roomy" : ""}`}>
      {portrait ? (
        <span className="cast-name-row">
          <PortraitZoom name={c.name} portrait={portrait} />
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
function CastWindow({ bookId, sceneId, onClose }: { bookId: string; sceneId: string; onClose: () => void }) {
  const { cast, failed } = useCast(bookId, sceneId, true);
  const skin = useSkin();
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
                <CastCard key={c.id} c={c} roomy portrait={portraitFor(bookId, c.id, skin)} />
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
// The title opens the same cast in a larger window; only the chevron
// toggles the compact list.
// Portraits ride on the cast cards in every chapter (core/portraits.ts).
export function CastList({ bookId, sceneId }: { bookId: string; sceneId: string }) {
  const [open, setOpen] = useState(false);
  const [big, setBig] = useState(false);
  const titleRef = useRef<HTMLButtonElement | null>(null);
  const { cast, failed } = useCast(bookId, sceneId, open);
  const skin = useSkin();
  const sub = !open ? CAST_COPY.closed : cast ? CAST_COPY.summary(cast.length) : failed ? CAST_COPY.failed : CAST_COPY.loading;
  return (
    <section className="marks cast" aria-label={CAST_COPY.title}>
      <div className="mtool marks-row cast-row">
        <span className="mtool-icon">
          <Icon name="heart" width={18} height={18} />
        </span>
        <span className="mtool-text">
          <button
            ref={titleRef}
            type="button"
            className="mtool-title cast-open"
            title={CAST_COPY.open}
            aria-label={CAST_COPY.open}
            aria-haspopup="dialog"
            aria-expanded={big}
            aria-controls="cast-window"
            onClick={() => setBig(true)}
          >
            {CAST_COPY.title}
          </button>
          <span className="mtool-sub">{sub}</span>
        </span>
        <button
          type="button"
          className="cast-toggle"
          aria-expanded={open}
          aria-controls="cast-panel"
          aria-label={open ? CAST_COPY.hideList : CAST_COPY.showList}
          title={open ? CAST_COPY.hideList : CAST_COPY.showList}
          onClick={() => setOpen((v) => !v)}
        >
          {cast ? <span className="marks-count">{cast.length}</span> : null}
          <Icon name="chevron-down" className="marks-chev" />
        </button>
      </div>
      {open && cast ? (
        <ul id="cast-panel" className="marks-cards">
          {cast.map((c) => (
            <CastCard key={c.id} c={c} portrait={portraitFor(bookId, c.id, skin)} />
          ))}
        </ul>
      ) : null}
      {big ? (
        <CastWindow
          bookId={bookId}
          sceneId={sceneId}
          onClose={() => {
            setBig(false);
            titleRef.current?.focus();
          }}
        />
      ) : null}
    </section>
  );
}
