// The margin, laid out like the skin prototypes: "In the margin" over two
// tool rows (Picture style, Picture Vault), then this scene's pictures:
// the scene picture first, then inline figures in text order.
"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { STYLE_OTHER_VALUE, STYLE_PRESETS, resolveStyleSelect } from "../image-style";
import type { ImageStylePref } from "../image-style";
import { truncateCaption } from "./helpers";
import type { InlineFigure } from "./use-pictures";

export function StylePicker({ pref, onChange }: { pref: ImageStylePref; onChange: (pref: ImageStylePref) => void }) {
  const [custom, setCustom] = useState(pref.kind === "custom" ? pref.text : "");
  const [otherOpen, setOtherOpen] = useState(false);
  const customRef = useRef<HTMLInputElement | null>(null);
  const selected = resolveStyleSelect(pref, otherOpen);
  useEffect(() => {
    if (otherOpen) customRef.current?.focus();
  }, [otherOpen]);
  return (
    <div className="style-picker mtool">
      <span className="mtool-icon">
        <Icon name="brush" width={18} height={18} />
      </span>
      <div className="mtool-text">
        <label className="mtool-title" htmlFor="style-select">
          Picture style
        </label>
        <select
          id="style-select"
          className="mtool-sub"
          value={selected}
          onChange={(e) => {
            const next = e.target.value;
            if (next === STYLE_OTHER_VALUE) {
              setCustom(pref.kind === "custom" ? pref.text : "");
              setOtherOpen(true);
              return;
            }
            setOtherOpen(false);
            onChange({ kind: "preset", id: next });
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOtherOpen(false);
          }}
        >
          {STYLE_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          <option value={STYLE_OTHER_VALUE}>Other…</option>
        </select>
        {selected === STYLE_OTHER_VALUE ? (
          <div className="style-custom">
            <input
              ref={customRef}
              type="text"
              value={custom}
              maxLength={60}
              placeholder="e.g. Japanese woodblock"
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOtherOpen(false);
              }}
              aria-label="Custom drawing style"
            />
            <button
              type="button"
              disabled={custom.trim().length === 0}
              onClick={() => {
                const text = custom.trim();
                if (text.length > 0) onChange({ kind: "custom", text });
              }}
            >
              Use this style
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function keptLine(count: number): string {
  if (count === 0) return "Nothing kept yet";
  return count === 1 ? "1 picture kept" : `${count} pictures kept`;
}

export function PictureVault({
  scenes,
  figures,
  onGotoScene,
  onGotoFigure,
  onOpen,
  pref,
  onPrefChange,
  children,
}: {
  /** Scene pictures kept this session, including dismissed ones. */
  scenes: { id: string; url: string; caption: string }[];
  figures: InlineFigure[];
  onGotoScene: () => void;
  onGotoFigure: (fig: InlineFigure) => void;
  onOpen: (src: string, caption: string, opener: HTMLElement | null) => void;
  pref: ImageStylePref;
  onPrefChange: (pref: ImageStylePref) => void;
  /** Extra margin rows under the vault, such as notes and highlights. */
  children?: React.ReactNode;
}) {
  const ready = figures.filter((f) => f.phase === "ready" && f.url !== null);
  const ordered = [...ready].sort((a, b) => a.endN - b.endN);
  return (
    <aside className="vault" aria-label="Picture Vault">
      <div className="mlabel">In the margin</div>
      <StylePicker pref={pref} onChange={onPrefChange} />
      <div className="mtool">
        <span className="mtool-icon">
          <Icon name="vault" />
        </span>
        <div className="mtool-text">
          <span className="mtool-title">Picture Vault</span>
          <span className="mtool-sub">{keptLine(ordered.length + scenes.length)}</span>
        </div>
      </div>
      {scenes.length === 0 && ordered.length === 0 ? (
        <p className="vault-empty">Select a line you love, then choose Picture this. Your pictures will gather here.</p>
      ) : (
        <>
          <div className="mlabel">This scene so far</div>
          <div className="vault-list">
            {scenes.map((scene) => (
              <div key={scene.id} className="vault-item">
                <button
                  type="button"
                  className="vault-goto"
                  onClick={onGotoScene}
                  aria-label={`Go to ${scene.caption}`}
                >
                  <span className="vault-thumb">
                    <img src={scene.url} alt="" loading="lazy" decoding="async" />
                  </span>
                  <span className="vault-cap">{scene.caption}</span>
                </button>
                <div className="vault-meta">
                  <button
                    type="button"
                    className="vault-x"
                    aria-label="View larger"
                    onClick={() => onOpen(scene.url, scene.caption, null)}
                  >
                    <Icon name="expand" />
                  </button>
                </div>
              </div>
            ))}
            {ordered.map((f) => (
              <div key={f.id} className="vault-item">
                <button
                  type="button"
                  className="vault-goto"
                  onClick={() => onGotoFigure(f)}
                  aria-label={`Go to picture: ${truncateCaption(f.quote)}`}
                >
                  <span className="vault-thumb">
                    <img src={f.url ?? ""} alt="" loading="lazy" decoding="async" />
                  </span>
                  <span className="vault-cap">{`\u201C${truncateCaption(f.quote)}\u201D`}</span>
                </button>
                <div className="vault-meta">
                  <button
                    type="button"
                    className="vault-x"
                    aria-label="View larger"
                    onClick={() => {
                      if (f.url) onOpen(f.url, f.quote, null);
                    }}
                  >
                    <Icon name="expand" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {children}
    </aside>
  );
}
