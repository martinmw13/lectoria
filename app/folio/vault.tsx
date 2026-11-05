// The margin, laid out like the skin prototypes: "In the margin" over two
// tool rows (Picture style, Picture Vault), then every picture drawn in
// this book, whatever chapter or scene is in view: scene pictures first,
// then inline figures in text order. Two or more fold into a fanned stack
// that opens the vault window: every picture in a grid, one pick shows it
// large. Deleting happens only in here, never from the reader's X.
"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { STYLE_OTHER_VALUE, STYLE_PRESETS, resolveStyleSelect } from "../image-style";
import type { ImageStylePref } from "../image-style";
import { truncateCaption } from "./helpers";
import { ListboxSelect, type ListboxOption } from "./listbox-select";
import type { VaultFigure, VaultScene } from "./vault-store";

const STYLE_OPTIONS: ListboxOption[] = [
  ...STYLE_PRESETS.map((p) => ({ value: p.id, label: p.label })),
  { value: STYLE_OTHER_VALUE, label: "Other…" },
];

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
        <span className="mtool-title" id="style-select-label">
          Picture style
        </span>
        <ListboxSelect
          id="style-select"
          options={STYLE_OPTIONS}
          value={selected}
          onSelect={(next) => {
            if (next === STYLE_OTHER_VALUE) {
              setCustom(pref.kind === "custom" ? pref.text : "");
              setOtherOpen(true);
              return;
            }
            setOtherOpen(false);
            onChange({ kind: "preset", id: next });
          }}
          onClosedKeyDown={(e) => {
            if (e.key === "Escape") setOtherOpen(false);
          }}
          className="style-select"
          buttonClassName="style-select-btn mtool-sub"
          listClassName="style-select-list"
          listLabel="Picture styles"
          ariaLabelledBy="style-select-label style-select"
          align="start"
        >
          <span className="style-select-text">{STYLE_OPTIONS.find((o) => o.value === selected)?.label}</span>
        </ListboxSelect>
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

/** Cards shown in the folded fan; the rest ride on a +N badge. */
export const FAN_MAX = 5;

// The newest pictures on top, fanned like held cards around the middle one.
export function VaultFan({ urls, onOpen }: { urls: string[]; onOpen: () => void }) {
  const shown = urls.slice(-FAN_MAX);
  const extra = urls.length - shown.length;
  const mid = (shown.length - 1) / 2;
  return (
    <button
      type="button"
      className="vault-fan"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={`Open the Picture Vault: ${urls.length} pictures`}
    >
      <span className="vault-fan-deck" aria-hidden="true">
        {shown.map((url, i) => (
          <span key={url} className="vault-fan-card" style={{ "--fan-i": i - mid } as React.CSSProperties}>
            {/* eslint-disable-next-line @next/next/no-img-element -- generated blob urls, like the vault cards */}
            <img src={url} alt="" loading="lazy" decoding="async" />
          </span>
        ))}
        {extra > 0 ? <span className="vault-fan-more">+{extra}</span> : null}
      </span>
    </button>
  );
}

// One kept picture as the window shows it.
interface VaultPick {
  key: string;
  url: string;
  caption: string;
  go: () => void;
}

// The large window reuses the Cast so far shell (.reader-chat, .chat-panel,
// .chat-head, .chat-x), so it follows each skin the same way.
export function VaultWindow({
  items,
  onDelete,
  onClose,
}: {
  items: VaultPick[];
  onDelete: (url: string) => void;
  onClose: () => void;
}) {
  const [pick, setPick] = useState<string | null>(null);
  const xRef = useRef<HTMLButtonElement | null>(null);
  const backRef = useRef<HTMLButtonElement | null>(null);
  const big = items.find((i) => i.url === pick) ?? null;
  // Keep focus inside the window as the grid and the large view swap, so
  // Esc always reaches it.
  useEffect(() => (big ? backRef : xRef).current?.focus(), [big]);
  return (
    <div className="reader-chat cast-host vault-host">
      <section
        className="chat-panel cast-window vault-window"
        id="vault-window"
        role="dialog"
        aria-labelledby="vault-window-title"
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.stopPropagation();
          if (big) setPick(null);
          else onClose();
        }}
      >
        <div className="chat-head">
          <div className="chat-head-row">
            <h3 id="vault-window-title">Picture Vault</h3>
            <button ref={xRef} type="button" className="chat-x" onClick={onClose} aria-label="Close Picture Vault">
              ×
            </button>
          </div>
          <p className="chat-scope">{`${keptLine(items.length)}. Every picture drawn in this book.`}</p>
        </div>
        <div className="chat-log vault-log">
          {big ? (
            <figure className="vault-big">
              {/* eslint-disable-next-line @next/next/no-img-element -- generated blob url shown at full size */}
              <img className="vault-big-img" src={big.url} alt={big.caption} decoding="async" />
              <figcaption className="vault-big-cap">{big.caption}</figcaption>
              <div className="vault-big-actions">
                <button ref={backRef} type="button" className="vault-act" onClick={() => setPick(null)}>
                  All pictures
                </button>
                <button
                  type="button"
                  className="vault-act"
                  onClick={() => {
                    big.go();
                    onClose();
                  }}
                >
                  Go to it in the book
                </button>
                <button
                  type="button"
                  className="vault-act vault-act-del"
                  onClick={() => {
                    onDelete(big.url);
                    setPick(null);
                  }}
                >
                  Delete from the vault
                </button>
              </div>
            </figure>
          ) : items.length === 0 ? (
            <p className="chat-welcome">Nothing kept yet</p>
          ) : (
            <ul className="vault-grid">
              {items.map((it) => (
                <li key={it.key}>
                  <button type="button" className="vault-grid-btn" onClick={() => setPick(it.url)} aria-label={`View ${it.caption}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- generated blob urls, like the vault cards */}
                    <img src={it.url} alt="" loading="lazy" decoding="async" />
                    <span className="vault-grid-cap">{it.caption}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

export function PictureVault({
  scenes,
  figures,
  onGotoScene,
  onGotoFigure,
  onOpen,
  onDelete,
  pref,
  onPrefChange,
  children,
}: {
  /** Scene pictures kept in this book, including dismissed ones. */
  scenes: VaultScene[];
  /** Inline figures kept in this book, including ones removed from the text. */
  figures: VaultFigure[];
  onGotoScene: (scene: VaultScene) => void;
  onGotoFigure: (fig: VaultFigure) => void;
  onOpen: (src: string, caption: string, opener: HTMLElement | null) => void;
  /** The vault's own delete, the only way a picture leaves it. */
  onDelete: (url: string) => void;
  pref: ImageStylePref;
  onPrefChange: (pref: ImageStylePref) => void;
  /** Extra margin rows under the vault, such as notes and highlights. */
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const fanRef = useRef<HTMLDivElement | null>(null);
  const ready = figures.filter((f) => f.phase === "ready" && f.url !== null);
  const ordered = [...ready].sort((a, b) => a.endN - b.endN);
  const count = ordered.length + scenes.length;
  const items: VaultPick[] = [
    ...scenes.map((sc) => ({ key: sc.id, url: sc.url, caption: sc.caption, go: () => onGotoScene(sc) })),
    ...ordered.map((f) => ({
      key: f.id,
      url: f.url ?? "",
      caption: `\u201C${truncateCaption(f.quote)}\u201D`,
      go: () => onGotoFigure(f),
    })),
  ];
  const deleteBtn = (url: string, what: string) => (
    <button type="button" className="vault-x vault-del" aria-label={`Delete ${what} from the vault`} onClick={() => onDelete(url)}>
      <span aria-hidden="true">×</span>
    </button>
  );
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
          <span className="mtool-sub">{keptLine(count)}</span>
        </div>
      </div>
      {count === 0 ? (
        <p className="vault-empty">Select a line you love, then choose Picture this. Your pictures will gather here.</p>
      ) : count > 1 ? (
        <div ref={fanRef}>
          <VaultFan urls={items.map((i) => i.url)} onOpen={() => setOpen(true)} />
        </div>
      ) : (
        <>
          <div className="mlabel">This book so far</div>
          <div className="vault-list">
            {scenes.map((scene) => (
              <div key={scene.id} className="vault-item">
                <button
                  type="button"
                  className="vault-goto"
                  onClick={() => onGotoScene(scene)}
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
                  {deleteBtn(scene.url, "this picture")}
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
                  {f.url ? deleteBtn(f.url, "this picture") : null}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {open ? (
        <VaultWindow
          items={items}
          onDelete={onDelete}
          onClose={() => {
            setOpen(false);
            fanRef.current?.querySelector("button")?.focus();
          }}
        />
      ) : null}
      {children}
    </aside>
  );
}
