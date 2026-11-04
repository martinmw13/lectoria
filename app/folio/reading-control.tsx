"use client";

import { useEffect, useRef, useState } from "react";
import { useSkin } from "../use-skin";
import {
  applyReading,
  DEFAULT_READING,
  loadReading,
  saveReading,
  SIZE_STEPS,
  SPACING_STEPS,
  type ReadingPrefs,
} from "../reading-prefs";

const SIZE_LABELS = ["Small", "Medium", "Large", "Extra large"];
const SPACING_LABELS = ["Snug", "Easy", "Airy"];

// Engraving sets its text justified; the others start ragged-right.
const JUSTIFIED_SKINS = new Set(["engraving"]);

// Keep the line the reader is on in place while the text reflows: find
// the first paragraph crossing the column top, then restore its offset.
export function keepPlace(col: HTMLElement | null, change: () => void): void {
  if (!col) return change();
  const top = col.getBoundingClientRect().top;
  const anchor = [...col.querySelectorAll<HTMLElement>("p[data-n]")].find(
    (p) => p.getBoundingClientRect().bottom > top,
  );
  const before = anchor?.getBoundingClientRect();
  change();
  if (!anchor || !before || before.height === 0) return;
  const after = anchor.getBoundingClientRect();
  const want = top + ((before.top - top) / before.height) * after.height;
  col.scrollTop += after.top - want;
}

export function ReadingControl() {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<ReadingPrefs>(DEFAULT_READING);
  const skin = useSkin();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-only reading prefs restore from localStorage after hydration
    setPrefs(loadReading());
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function change(patch: Partial<ReadingPrefs>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveReading(next);
    keepPlace(document.querySelector<HTMLElement>(".read-col"), () => applyReading(next));
    // Popovers placed against the old layout re-measure or hide.
    window.dispatchEvent(new Event("resize"));
  }

  const justified = prefs.justify ?? JUSTIFIED_SKINS.has(skin);

  return (
    <div ref={wrapRef} className="reading-ctl">
      <button
        ref={buttonRef}
        type="button"
        className="theme-btn reading-btn"
        aria-expanded={open}
        aria-label="Text settings"
        title="Text settings"
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">
          A<small>a</small>
        </span>
      </button>
      {open && (
        <div className="reading-pop" role="group" aria-label="Text settings">
          <p className="reading-label" id="reading-size">
            Text size
          </p>
          <div className="reading-seg" role="radiogroup" aria-labelledby="reading-size">
            {SIZE_STEPS.map((scale, i) => (
              <button
                key={scale}
                type="button"
                role="radio"
                aria-checked={prefs.size === i}
                aria-label={SIZE_LABELS[i]}
                title={SIZE_LABELS[i]}
                style={{ fontSize: `${13 * scale}px` }}
                onClick={() => change({ size: i })}
              >
                A
              </button>
            ))}
          </div>
          <p className="reading-label" id="reading-spacing">
            Line spacing
          </p>
          <div className="reading-seg" role="radiogroup" aria-labelledby="reading-spacing">
            {SPACING_STEPS.map((lead, i) => (
              <button
                key={lead}
                type="button"
                role="radio"
                aria-checked={prefs.spacing === i}
                onClick={() => change({ spacing: i })}
              >
                {SPACING_LABELS[i]}
              </button>
            ))}
          </div>
          <label className="reading-toggle">
            <input type="checkbox" checked={justified} onChange={(e) => change({ justify: e.target.checked })} />
            Justify text
          </label>
        </div>
      )}
    </div>
  );
}
