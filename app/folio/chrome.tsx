// Folio chrome: top line, resizable divider, bottom pager with ticks.
"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { pressButton } from "../button-fx";
import { Icon } from "../icons";
import { StyleMenu } from "../style-menu";
import { StylePicker } from "../home/style-picker";
import { clampSplitWidth, SPLIT_MIN_PX } from "./helpers";
import { WarmthControl } from "./warmth-control";
import { ReadingControl } from "./reading-control";

export { THEME_KEY } from "../theme";
export const SPLIT_KEY = "lectoria.split";

export function TopLine({
  bookTitle,
  author,
  ch,
  chaptersTotal,
  chapters,
  onJumpChapter,
  theme,
  onToggleTheme,
}: {
  bookTitle: string;
  author: string;
  ch: number;
  chaptersTotal: number;
  chapters: { ch: number; title: string }[];
  onJumpChapter: (ch: number) => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
}) {
  return (
    <header className="top-line">
      <Link href="/" className="wordmark wordmark-home" aria-label="Back to the shelf">
        {/* Both faces share one grid cell, so the link keeps the wider
            width and the header never shifts when they swap. */}
        <span className="wm-swap">
          <span className="wm-brand">
            Lector<em>IA</em>
          </span>
          <span className="wm-back" aria-hidden="true">
            Back to shelf
          </span>
        </span>
      </Link>
      <div className="top-center">
        {bookTitle} · {author} ·{" "}
        <span className="chapter-jump">
          <span aria-hidden="true" className="chapter-jump-text">
            Chapter {ch} of {chaptersTotal}
          </span>
          <select value={ch} onChange={(e) => onJumpChapter(Number(e.target.value))} aria-label="Chapter">
            {chapters.map((c) => (
              <option key={c.ch} value={c.ch}>
                {c.ch}. {c.title}
              </option>
            ))}
          </select>
        </span>
      </div>
      <ReadingControl />
      <WarmthControl />
      <button
        type="button"
        className="theme-btn"
        onClick={onToggleTheme}
        aria-label={theme === "dark" ? "Light mode" : "Dark mode"}
        aria-pressed={theme === "dark"}
        title={theme === "dark" ? "Light mode" : "Dark mode"}
      >
        {theme === "dark" ? <Icon name="sun" /> : <Icon name="moon" />}
      </button>
      <StyleMenu />
      <StylePicker />
    </header>
  );
}

function defaultSplit(): number {
  if (typeof window === "undefined") return 320;
  return clampSplitWidth(Math.round(Math.min(1640, window.innerWidth - 80) * 0.27), window.innerWidth);
}

export function Divider() {
  const [width, setWidth] = useState(defaultSplit);
  const [viewport, setViewport] = useState(1280);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const measure = () => setViewport(window.innerWidth);
    measure();
    window.addEventListener("resize", measure);
    try {
      const saved = Number(window.localStorage.getItem(SPLIT_KEY));
      if (Number.isFinite(saved) && saved > 0) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-only split restore from localStorage after hydration
        setWidth(clampSplitWidth(saved, window.innerWidth));
        return () => window.removeEventListener("resize", measure);
      }
    } catch {
      // Fresh default below.
    }
    setWidth(defaultSplit());
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--pane-w", `${width}px`);
  }, [width]);

  function commit(next: number) {
    const clamped = clampSplitWidth(next, window.innerWidth);
    setWidth(clamped);
    try {
      window.localStorage.setItem(SPLIT_KEY, String(clamped));
    } catch {
      // Dragging still works for the session.
    }
  }

  return (
    <div
      ref={ref}
      className="pane-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize image pane"
      aria-valuemin={SPLIT_MIN_PX}
      aria-valuemax={clampSplitWidth(Number.MAX_SAFE_INTEGER, viewport)}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize, double-click to reset"
      onDoubleClick={() => commit(defaultSplit())}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          commit(width - 16);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          commit(width + 16);
        }
      }}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        const move = (ev: PointerEvent) => {
          const grid = ref.current?.parentElement?.getBoundingClientRect();
          if (grid) commit(ev.clientX - grid.left);
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
    >
      <span className="grip" aria-hidden="true">
        |
      </span>
    </div>
  );
}

export function BandPager({
  k,
  n,
  bookIndex,
  bookTotal,
  onPrev,
  onNext,
  atStart,
  atBookEnd,
  chapterStarts = [],
}: {
  k: number;
  n: number;
  bookIndex: number;
  bookTotal: number;
  onPrev: () => void;
  onNext: () => void;
  atStart: boolean;
  atBookEnd: boolean;
  /** Book index of each chapter's first scene; drawn as marks on the bar. */
  chapterStarts?: number[];
}) {
  const pct = (i: number) => `${(i / Math.max(1, bookTotal)) * 100}%`;
  return (
    <div className="band-pager">
      <div className="pager-row">
        <button type="button" className="pager-btn" onClick={(e) => { pressButton(e); onPrev(); }} disabled={atStart} aria-label="Previous page">
          ‹
        </button>
        <span className="pager-label">
          Scene {k} of {n}
        </span>
        <button type="button" className="pager-btn" onClick={(e) => { pressButton(e); onNext(); }} disabled={atBookEnd} aria-label="Next page">
          ›
        </button>
      </div>
      <div className="ticks" aria-hidden="true">
        {/* One track and one fill, not one tick per scene: a 1000-scene
            book would otherwise overflow the bar. */}
        <i className="tk-track" />
        <i className="on tk-fill" style={{ width: pct(bookIndex + 1) }} />
        {chapterStarts
          .filter((i) => i > 0)
          .map((i) => (
            <b key={i} className="tk-ch" style={{ left: pct(i) }} />
          ))}
      </div>
      <span className="tick-label">
        Scene {bookIndex + 1} of {bookTotal}
      </span>
    </div>
  );
}
