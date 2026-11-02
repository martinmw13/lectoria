"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { setSkin, SKINS, type SkinId } from "./skin";
import { useSkin } from "./use-skin";
import { Icon } from "./icons";
import "./style-menu.css";

export const SKIN_NAMES: Record<SkinId, string> = {
  engraving: "Engraving",
  watercolor: "Watercolor",
  ink: "Ink doodle",
  pencil: "Pencil",
  comic: "Comic book",
  chihiro: "Lantern dusk",
};

// Text dropdown "Style: <Name> ▾" (option D). The name is set in the live
// skin's own lettering; the menu lists every style in its own lettering,
// with the live one checked. setSkin stays the only writer of data-skin.
export function StyleMenu({ placement = "reader" }: { placement?: "reader" | "home" }) {
  const skin = useSkin();
  const name = SKIN_NAMES[skin];
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = `style-menu-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  function focusItem(i: number) {
    const n = SKINS.length;
    itemRefs.current[((i % n) + n) % n]?.focus();
  }

  function openAt(i: number) {
    setOpen(true);
    // The menu mounts on this render; focus once it exists.
    requestAnimationFrame(() => focusItem(i));
  }

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  function choose(s: SkinId) {
    setSkin(s);
    close(true);
  }

  function onButtonKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openAt(e.key === "ArrowDown" ? SKINS.indexOf(skin) : SKINS.length - 1);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      close(true);
    }
  }

  function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    const at = itemRefs.current.indexOf(document.activeElement as HTMLButtonElement);
    const moves: Record<string, number> = {
      ArrowDown: at + 1,
      ArrowUp: at - 1,
      Home: 0,
      End: SKINS.length - 1,
    };
    const to = moves[e.key];
    if (to !== undefined) {
      e.preventDefault();
      focusItem(to);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className={`style-menu style-menu-${placement}`}>
      <button
        ref={buttonRef}
        type="button"
        className="style-menu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Change style, now ${name}`}
        title={`Change style, now ${name}`}
        onClick={() => (open ? close(false) : openAt(SKINS.indexOf(skin)))}
        onKeyDown={onButtonKey}
      >
        <span className="style-menu-key" data-face={skin}>
          Style:
        </span>
        <span className="style-name" data-face={skin}>
          {name}
        </span>
        <Icon name="chevron-down" className="style-menu-chev" focusable="false" />
      </button>
      {open && (
        <div id={menuId} className="style-menu-list" role="menu" aria-label="Styles" onKeyDown={onMenuKey}>
          {SKINS.map((s, i) => (
            <button
              key={s}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={s === skin}
              tabIndex={-1}
              className="style-menu-item"
              onClick={() => choose(s)}
            >
              <span className="style-name" data-face={s}>
                {SKIN_NAMES[s]}
              </span>
              <Icon name="check" className="style-menu-check" focusable="false" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
