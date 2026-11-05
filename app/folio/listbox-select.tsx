// App-owned select: a select-only combobox (WAI-ARIA APG pattern) shared by
// the chapter selector and the picture-style picker. Focus stays on the
// button; the open listbox tracks the active option through
// aria-activedescendant. The list is portaled to <body> with fixed
// positioning because its hosts (top line, margin) clip overflow.
"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../icons";

export interface ListboxOption {
  value: string;
  label: string;
  /** Optional leading cell (e.g. the chapter number). */
  lead?: ReactNode;
}

// Type-ahead on the start of the label (case-insensitive), searching from
// just after `from` and wrapping.
export function labelTypeAhead(options: ListboxOption[], query: string, from: number): number {
  const q = query.trim().toLowerCase();
  if (!q) return -1;
  const n = options.length;
  for (let step = 1; step <= n; step++) {
    const i = (((from + step) % n) + n) % n;
    if (options[i]?.label.toLowerCase().startsWith(q)) return i;
  }
  return -1;
}

export function ListboxSelect({
  id,
  options,
  value,
  onSelect,
  children,
  className,
  buttonClassName,
  listClassName,
  listLabel,
  ariaLabel,
  ariaLabelledBy,
  title,
  align = "center",
  typeAhead = labelTypeAhead,
  onClosedKeyDown,
}: {
  id?: string;
  options: ListboxOption[];
  value: string;
  onSelect: (value: string) => void;
  /** Button content (text + the chevron is added). */
  children: ReactNode;
  className: string;
  buttonClassName: string;
  listClassName?: string;
  listLabel: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  title?: string;
  align?: "center" | "start";
  typeAhead?: (options: ListboxOption[], query: string, from: number) => number;
  /** Keys pressed while the list is closed that it does not handle. */
  onClosedKeyDown?: (e: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const [open, setOpen] = useState(false);
  const currentIndex = Math.max(0, options.findIndex((o) => o.value === value));
  const [active, setActive] = useState(currentIndex);
  const [pos, setPos] = useState<{ top: number; left: number; width?: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const base = `listbox-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const optionId = (i: number) => `${base}-opt-${i}`;

  function place() {
    const r = buttonRef.current?.getBoundingClientRect();
    if (!r) return;
    const vw = window.innerWidth;
    // Narrow screens get a near full-width sheet under the button.
    if (vw < 560) setPos({ top: r.bottom + 6, left: 8, width: vw - 16 });
    else {
      const want = align === "start" ? r.left - 10 : r.left + r.width / 2 - 170;
      setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(want, vw - 348)) });
    }
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
    const o = options[i];
    close(true);
    if (o) onSelect(o.value);
  }

  // Keep the active (on open: current) option in view inside the list.
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
    const last = options.length - 1;
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
      } else onClosedKeyDown?.(e);
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
      const hit = typeAhead(options, text, text.length > 1 ? active - 1 : active);
      if (hit >= 0) setActive(hit);
    }
  }

  return (
    <span className={className}>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        className={buttonClassName}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${base}-list` : undefined}
        aria-activedescendant={open ? optionId(active) : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        title={title}
        onClick={() => (open ? close(false) : show(currentIndex))}
        onKeyDown={onKey}
      >
        {children}
        <Icon name="chevron-down" className="chapter-jump-chev" focusable="false" />
      </button>
      {open &&
        pos &&
        createPortal(
          <ul
            ref={listRef}
            id={`${base}-list`}
            className={`chapter-menu-list${listClassName ? ` ${listClassName}` : ""}`}
            role="listbox"
            aria-label={listLabel}
            tabIndex={-1}
            style={{ top: pos.top, left: pos.left, width: pos.width }}
          >
            {options.map((o, i) => (
              <li
                key={o.value}
                id={optionId(i)}
                role="option"
                data-value={o.value}
                aria-selected={i === currentIndex}
                data-active={i === active || undefined}
                className="chapter-menu-item"
                onPointerMove={() => setActive(i)}
                // Keep focus on the combobox button.
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
              >
                {o.lead !== undefined ? <span className="chapter-menu-num">{o.lead}</span> : null}
                <span className="chapter-menu-title">{o.label}</span>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </span>
  );
}
