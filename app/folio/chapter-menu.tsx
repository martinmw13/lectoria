// Chapter selector in the top line: a select-only combobox (WAI-ARIA APG
// pattern). Focus stays on the button; the open listbox tracks the active
// option through aria-activedescendant. The list is portaled to <body> with
// fixed positioning because the top line clips overflow.
"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../icons";

export interface ChapterOption {
  ch: number;
  title: string;
}

// Type-ahead: digits match the chapter number, anything else the start of
// the title (case-insensitive). Searches from just after `from`, wrapping.
export function typeAheadMatch(chapters: ChapterOption[], query: string, from: number): number {
  const q = query.trim().toLowerCase();
  if (!q) return -1;
  if (/^\d+$/.test(q)) return chapters.findIndex((c) => String(c.ch) === q);
  const n = chapters.length;
  for (let step = 1; step <= n; step++) {
    const i = (from + step) % n;
    if (chapters[i]?.title.toLowerCase().startsWith(q)) return i;
  }
  return -1;
}

export function ChapterMenu({
  ch,
  chaptersTotal,
  chapters,
  onJumpChapter,
}: {
  ch: number;
  chaptersTotal: number;
  chapters: ChapterOption[];
  onJumpChapter: (ch: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const currentIndex = Math.max(0, chapters.findIndex((c) => c.ch === ch));
  const [active, setActive] = useState(currentIndex);
  const [pos, setPos] = useState<{ top: number; left: number; width?: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const base = `chapter-menu-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const optionId = (i: number) => `${base}-opt-${i}`;

  function place() {
    const r = buttonRef.current?.getBoundingClientRect();
    if (!r) return;
    const vw = window.innerWidth;
    // Narrow screens get a near full-width sheet under the top line.
    if (vw < 560) setPos({ top: r.bottom + 6, left: 8, width: vw - 16 });
    else setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left + r.width / 2 - 170, vw - 348)) });
  }

  function show(at: number) {
    setActive(at);
    place();
    setOpen(true);
  }

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  function choose(i: number) {
    const c = chapters[i];
    close(true);
    if (c) onJumpChapter(c.ch);
  }

  // Keep the active (on open: current) chapter in view inside the list.
  useLayoutEffect(() => {
    if (!open) return;
    const el = document.getElementById(optionId(active));
    el?.scrollIntoView?.({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- optionId is derived from a stable id
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onResize() {
      setOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  function onKey(e: KeyboardEvent<HTMLButtonElement>) {
    const last = chapters.length - 1;
    const clamp = (i: number) => Math.max(0, Math.min(last, i));
    const moves: Record<string, number> = {
      ArrowDown: active + 1,
      ArrowUp: active - 1,
      Home: 0,
      End: last,
      PageDown: active + 8,
      PageUp: active - 8,
    };
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " ", "Home", "End"].includes(e.key)) {
        e.preventDefault();
        show(e.key === "Home" ? 0 : e.key === "End" ? last : currentIndex);
      }
      return;
    }
    if (e.key in moves) {
      e.preventDefault();
      setActive(clamp(moves[e.key] ?? active));
    } else if (e.key === "Enter" || (e.key === " " && !typed.current.text)) {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") {
      setOpen(false);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const now = Date.now();
      const text = (now - typed.current.at > 700 ? "" : typed.current.text) + e.key;
      typed.current = { text, at: now };
      const hit = typeAheadMatch(chapters, text, text.length > 1 ? active - 1 : active);
      if (hit >= 0) setActive(hit);
    }
  }

  const current = chapters[currentIndex];

  return (
    <span className="chapter-jump">
      <button
        ref={buttonRef}
        type="button"
        className="chapter-jump-btn"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${base}-list` : undefined}
        aria-activedescendant={open ? optionId(active) : undefined}
        aria-label={`Chapter ${ch} of ${chaptersTotal}${current ? `: ${current.title}` : ""}`}
        title="Go to chapter"
        onClick={() => (open ? close(false) : show(currentIndex))}
        onKeyDown={onKey}
      >
        <span className="chapter-jump-text">
          Chapter {ch} of {chaptersTotal}
        </span>
        <Icon name="chevron-down" className="chapter-jump-chev" focusable="false" />
      </button>
      {open &&
        pos &&
        createPortal(
          <ul
            ref={listRef}
            id={`${base}-list`}
            className="chapter-menu-list"
            role="listbox"
            aria-label="Chapters"
            tabIndex={-1}
            style={{ top: pos.top, left: pos.left, width: pos.width }}
          >
            {chapters.map((c, i) => (
              <li
                key={c.ch}
                id={optionId(i)}
                role="option"
                data-ch={c.ch}
                aria-selected={i === currentIndex}
                data-active={i === active || undefined}
                className="chapter-menu-item"
                onPointerMove={() => setActive(i)}
                // Keep focus on the combobox button.
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
              >
                <span className="chapter-menu-num">{c.ch}</span>
                <span className="chapter-menu-title">{c.title}</span>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </span>
  );
}
