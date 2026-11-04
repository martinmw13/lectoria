// Read aloud for a book that has no narration: the same button, voice
// picker and narration volume in the same spots, greyed out and
// disabled, so the bottom bar keeps the layout of a narrated book. A
// small note says why on hover, focus or click. It never starts audio.
"use client";

import { useId, useState } from "react";
import { heroArt } from "../skin-art";
import { useSkin } from "../use-skin";
import { NARRATION_VOICES } from "@/core/narration";

const HINT = "Read aloud not available for this book";

export function ReadAloudSoon() {
  const art = heroArt(useSkin());
  const tipId = useId();
  const [open, setOpen] = useState(false);

  return (
    <div className="read-aloud read-aloud-soon" data-art="hero" data-open={open ? "1" : undefined}>
      <button
        type="button"
        className="read-aloud-btn"
        aria-disabled="true"
        aria-describedby={tipId}
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        <span className="read-aloud-frame">
          <img className="read-aloud-art" src={art.narrate} alt="" width={40} height={40} />
        </span>
        <span className="read-aloud-label">Read aloud</span>
      </button>
      <label className="read-aloud-voice">
        <span>Voice</span>
        <select disabled aria-label="Narration voice" aria-describedby={tipId} defaultValue={NARRATION_VOICES[0]?.id}>
          {NARRATION_VOICES.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
      <label className="read-aloud-volume">
        <span className="sr-only">Narration volume</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          defaultValue={1}
          disabled
          aria-label="Narration volume"
          aria-describedby={tipId}
        />
      </label>
      <span className="read-aloud-tip" role="tooltip" id={tipId}>
        {HINT}
      </span>
    </div>
  );
}
