"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { normalizeWord } from "@/core/dictionary";
import { sendQuoteToChat } from "../chat/chat-bridge";
import { PictureIcon } from "../folio/picture-copy";
import { DefineCard } from "./define-card";
import { markFromRange, overlapping, type Mark } from "./marks";
import type { MarksApi } from "./use-marks";

type Draft = Omit<Mark, "id">;
type Pos = { top: number; left: number; hint?: string };
export type NoteTarget = { pos: Pos; draft: Draft; mark?: Mark };

export const MENU_COPY = {
  label: "Selection actions",
  highlight: "Highlight",
  unhighlight: "Remove highlight",
  addNote: "Add note",
  editNote: "Edit note",
  explain: "Explain",
  ask: "Ask",
  picture: "Picture this",
  noteLabel: "Your note",
  notePlaceholder: "What does this passage bring to mind?",
  save: "Save",
  cancel: "Cancel",
  deleteNote: "Delete",
} as const;

interface Snap {
  text: string;
  draft: Draft | null;
  word: string | null;
}

function snapshot(): Snap | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const text = sel.toString().replace(/\s+/g, " ").trim();
  return { text, draft: markFromRange(sel.getRangeAt(0)), word: text.includes(" ") ? null : normalizeWord(text) };
}

// Keep a menu up to 440px wide on screen near either edge.
function edgeSafe(left: number): string {
  return `clamp(min(47vw, 220px), ${left}px, calc(100vw - min(47vw, 220px)))`;
}

function done(onClose: () => void) {
  window.getSelection()?.removeAllRanges();
  onClose();
}

// Kindle-style menu over a selection: highlight, note, explain, ask, and
// Picture this. A single English word also gets its definition on top.
export function SelectionMenu({
  pos,
  popRef,
  marks,
  showPicture,
  onPicture,
  onNote,
  onClose,
}: {
  pos: Pos;
  popRef: React.Ref<HTMLElement>;
  marks: MarksApi;
  showPicture: boolean;
  onPicture: () => void;
  onNote: (target: NoteTarget) => void;
  onClose: () => void;
}) {
  const [snap, setSnap] = useState<Snap | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const next = snapshot();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the live selection lives outside React
    setSnap((prev) => (prev && next && prev.text === next.text ? prev : next));
  }, [pos.top, pos.left]);

  // Keyboard: the first Tab after a selection steps into the menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const bar = barRef.current;
      if (e.key !== "Tab" || e.shiftKey || !bar || bar.contains(document.activeElement)) return;
      e.preventDefault();
      bar.querySelector<HTMLButtonElement>("button")?.focus();
    };
    document.addEventListener("keydown", onKey);
    const bar = barRef.current;
    return () => {
      document.removeEventListener("keydown", onKey);
      if (bar?.contains(document.activeElement)) document.getElementById("story")?.focus({ preventScroll: true });
    };
  }, []);

  function onBarKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const items = [...(barRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    e.preventDefault();
    items[(at + (e.key === "ArrowRight" ? 1 : items.length - 1)) % items.length]?.focus();
  }

  if (typeof document === "undefined") return null;
  const draft = snap?.draft ?? null;
  const existing = draft ? overlapping(marks.marks, draft) : undefined;
  const quote = (intent: "explain" | "ask") => {
    if (snap?.text) sendQuoteToChat(intent, snap.text);
    done(onClose);
  };

  return createPortal(
    <div ref={popRef as React.Ref<HTMLDivElement>} className="sel-menu" style={{ top: pos.top, left: edgeSafe(pos.left) }}>
      {snap?.word ? <DefineCard key={snap.word} word={snap.word} /> : null}
      <div ref={barRef} className="sel-bar" role="toolbar" aria-label={MENU_COPY.label} onKeyDown={onBarKey}>
        {draft ? (
          <button
            type="button"
            className="sel-btn"
            onClick={() => {
              if (existing) marks.remove(existing.id);
              else marks.add(draft);
              done(onClose);
            }}
          >
            {existing ? MENU_COPY.unhighlight : MENU_COPY.highlight}
          </button>
        ) : null}
        {draft ? (
          <button
            type="button"
            className="sel-btn"
            onClick={() => {
              onNote({ pos, draft: existing ?? draft, mark: existing });
              done(onClose);
            }}
          >
            {existing?.note ? MENU_COPY.editNote : MENU_COPY.addNote}
          </button>
        ) : null}
        {snap?.text ? (
          <>
            <button type="button" className="sel-btn" onClick={() => quote("explain")}>
              {MENU_COPY.explain}
            </button>
            <button type="button" className="sel-btn" onClick={() => quote("ask")}>
              {MENU_COPY.ask}
            </button>
          </>
        ) : null}
        {showPicture ? (
          <button type="button" className="sel-btn sel-picture" onClick={onPicture} aria-live="polite">
            <PictureIcon size={12} />
            <span>{pos.hint ?? MENU_COPY.picture}</span>
          </button>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export function NoteEditor({
  target,
  marks,
  onClose,
}: {
  target: NoteTarget;
  marks: MarksApi;
  onClose: () => void;
}) {
  const [text, setText] = useState(target.mark?.note ?? "");
  const save = () => {
    if (target.mark) marks.setNote(target.mark.id, text);
    else marks.add(target.draft, text);
    onClose();
  };
  return createPortal(
    <div
      className="note-editor"
      role="dialog"
      aria-label={MENU_COPY.noteLabel}
      style={{ top: target.pos.top, left: edgeSafe(target.pos.left) }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
      }}
    >
      <blockquote className="note-quote">{target.draft.quote}</blockquote>
      <textarea
        autoFocus
        aria-label={MENU_COPY.noteLabel}
        placeholder={MENU_COPY.notePlaceholder}
        maxLength={1000}
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="note-actions">
        {target.mark?.note ? (
          <button type="button" className="sel-btn" onClick={() => {
              if (target.mark) marks.setNote(target.mark.id, "");
              onClose();
            }}>
            {MENU_COPY.deleteNote}
          </button>
        ) : null}
        <button type="button" className="sel-btn" onClick={onClose}>
          {MENU_COPY.cancel}
        </button>
        <button type="button" className="sel-btn sel-primary" onClick={save}>
          {MENU_COPY.save}
        </button>
      </div>
    </div>,
    document.body,
  );
}
