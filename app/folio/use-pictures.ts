// Picture state for one scene: the pane card plus inline figures.
// The client sends ordinals and ids only, never text. Session caches
// survive sub-page and scene moves, so a shown picture never refetches.
//
// Ordering rules: one request at a time across scene and figure. The
// module-level `flight.current` record names what is generating, so a scene
// switch shows `loading` only for that; a second request while one is in
// flight shows a short hint where it was asked. retryFigure only works
// from the error phase; the caller must call hidePopover on pager moves. The style pref arrives as a hook argument and is read through a
// ref, so the callbacks stay stable when it changes.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { MSG_FAILED } from "@/core/images";
import { canIllustrateScene, canRetryFigure } from "./figure-placement";
import { HumanNeeded, ImageRequestError, isQuotaCode, poll } from "./image-poll";
import { PICTURE_COPY } from "./picture-copy";
import { requestStyleFields, styleCredit } from "../image-style";
import type { ImageStylePref } from "../image-style";
import { pickEndN, pickStartN } from "../picture-selection";
import { paraOf, popoverPos } from "./selection-geom";
import { figureSlot, figureCache, flight, nextFigureId, release, sceneCache, sceneCard, sceneFigures, sceneSlot, type InFlight } from "./picture-cache";
import { EMPTY_VAULT, bookVault, deleteVaultPicture, emptyVault, keepFigurePicture, keepScenePicture, subscribeVault, type VaultScene } from "./vault-store";

export { keepFigurePicture, keepScenePicture, popoverPos, type VaultScene };
export { figureSlot, sceneSlot, type InFlight };
import type { ParaEntry } from "../picture-selection";

export type SceneCard =
  | { phase: "idle"; hint?: string }
  | { phase: "loading" }
  | { phase: "ready"; url: string; caption: string }
  | { phase: "error"; message: string; quota?: boolean };

export interface InlineFigure {
  id: string;
  phase: "loading" | "ready" | "error";
  url: string | null;
  quote: string;
  startN: number;
  endN: number;
  credit: string;
  message: string | null;
  // Daily or budget limit: retry is pointless, so the view hides it.
  quota?: boolean;
}

export interface LightboxItem {
  src: string;
  caption: string;
}

const HINT_MS = 2400;

type HintAt = { where: "scene" } | { where: "popover" } | { where: "figure"; id: string } | null;


export function usePictures({
  bookId,
  textVersion,
  sceneId,
  pref,
}: {
  bookId: string;
  textVersion: string;
  sceneId: string;
  pref: ImageStylePref;
}) {
  const slot = sceneSlot(bookId, sceneId, pref);
  const figSlot = figureSlot(bookId, sceneId);
  const [card, setCard] = useState<SceneCard>(() => sceneCard(slot));
  const [figures, setFigures] = useState<InlineFigure[]>(() => sceneFigures(figSlot));
  // The vault is the whole book's, whatever scene is in view.
  const vault = useSyncExternalStore(
    subscribeVault,
    () => bookVault(bookId),
    () => EMPTY_VAULT,
  );
  const [hintAt, setHintAt] = useState<HintAt>(null);
  const hintTimer = useRef<number | null>(null);
  const [popover, setPopover] = useState<{ top: number; left: number } | null>(null);
  const [lightbox, setLightbox] = useState<LightboxItem | null>(null);
  const [needHuman, setNeedHuman] = useState(false);
  const humanRetry = useRef<((token: string) => void) | null>(null);

  // The widget token retries the failed request once, with the token on
  // the first post only; later polls reuse the issued cookie.
  const submitHumanToken = useCallback((token: string) => {
    const retry = humanRetry.current;
    humanRetry.current = null;
    setNeedHuman(false);
    retry?.(token);
  }, []);
  // The text view mounts late on a chapter's first scene (cover first),
  // so the node is tracked in state and the listener follows it.
  const viewNodeRef = useRef<HTMLDivElement | null>(null);
  const [viewEl, setViewEl] = useState<HTMLDivElement | null>(null);
  const viewRef = useCallback((node: HTMLDivElement | null) => {
    viewNodeRef.current = node;
    setViewEl(node);
  }, []);
  const popRef = useRef<HTMLElement | null>(null);
  // The selected range, kept so the portalled popover can follow it when
  // any scroll container (window or the reading column) moves the text.
  const rangeRef = useRef<Range | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const prefRef = useRef(pref);
  // eslint-disable-next-line react-hooks/refs -- latest-pref mirror for async poll callbacks
  prefRef.current = pref;
  // The continuous reader reuses one hook call while the scene in view
  // changes: track it so late poll results cannot paint another scene.
  const sceneRef = useRef(sceneId);
  // eslint-disable-next-line react-hooks/refs -- latest-scene mirror so late polls cannot paint another scene
  sceneRef.current = sceneId;
  const figSlotRef = useRef(figSlot);
  // eslint-disable-next-line react-hooks/refs -- latest book+scene mirror so late polls cannot paint another book
  figSlotRef.current = figSlot;
  const slotRef = useRef(slot);
  // eslint-disable-next-line react-hooks/refs -- latest scene+style mirror so late polls cannot paint another style
  slotRef.current = slot;

  // The last selection rescan painted, so repeat events for an unchanged
  // selection (pointerup plus mouseup, selectionchange bursts) paint once.
  const lastSelRef = useRef<{
    text: string;
    anchor: Node | null;
    anchorOffset: number;
    focus: Node | null;
    focusOffset: number;
  } | null>(null);

  const hidePopover = useCallback(() => {
    lastSelRef.current = null;
    setPopover(null);
  }, []);

  // The card and figures follow the scene in view through the session
  // caches; in-flight requests keep filling the cache they started.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- book or scene change resets figures and popover
    setFigures(sceneFigures(figSlot));
    setPopover(null);
    setHintAt(null);
  }, [figSlot]);

  // The pane card follows the scene and the style: a style change shows
  // that style's picture, or idle so it can be drawn.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- scene or style change resets the card
    setCard(sceneCard(slot));
  }, [slot]);

  useEffect(
    () => () => {
      if (hintTimer.current !== null) window.clearTimeout(hintTimer.current);
    },
    [],
  );

  // Another picture is generating: say so where the reader asked.
  const showHint = useCallback((at: NonNullable<HintAt>) => {
    setHintAt(at);
    if (hintTimer.current !== null) window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => {
      hintTimer.current = null;
      setHintAt(null);
    }, HINT_MS);
  }, []);

  // Writes the scene's own cache entry (keyed by figureSlot); paints only
  // if that book's scene is still current.
  const storeFigures = useCallback((fslot: string, update: (prev: InlineFigure[]) => InlineFigure[]) => {
    const value = update(figureCache.get(fslot) ?? []);
    figureCache.set(fslot, value);
    if (figSlotRef.current === fslot) setFigures(value);
  }, []);

  const openLightbox = useCallback((src: string, caption: string, opener: HTMLElement | null) => {
    openerRef.current = opener;
    setLightbox({ src, caption });
  }, []);

  const closeLightbox = useCallback(() => {
    setLightbox(null);
    openerRef.current?.focus?.();
    openerRef.current = null;
  }, []);

  const illustrateScene = useCallback((token?: string) => {
    if (flight.current !== null && sceneId !== "" && !sceneCache.has(slot)) {
      showHint({ where: "scene" });
      return;
    }
    if (!canIllustrateScene({ sceneId, busy: flight.current !== null, cached: sceneCache.has(slot) })) return;
    const mine: InFlight = { kind: "scene", sceneId: slot };
    flight.current = mine;
    setPopover(null);
    setHintAt(null);
    setCard({ phase: "loading" });
    void poll({ kind: "scene", bookId, textVersion, sceneId, ...requestStyleFields(prefRef.current) }, token)
      .then(({ url, caption }) => {
        sceneCache.set(slot, { url, caption });
        keepScenePicture(bookId, sceneId, url, caption);
        if (slotRef.current === slot) setCard({ phase: "ready", url, caption });
      })
      .catch((err: unknown) => {
        if (slotRef.current === slot) {
          if (err instanceof HumanNeeded) {
            // eslint-disable-next-line react-hooks/immutability -- deferred human-retry callback, runs after render
            humanRetry.current = (t) => illustrateScene(t);
            setNeedHuman(true);
          }
          setCard({
            phase: "error",
            message: err instanceof Error ? err.message : MSG_FAILED,
            quota: err instanceof ImageRequestError && isQuotaCode(err.code),
          });
        }
      })
      .finally(() => {
        release(mine);
      });
  }, [bookId, textVersion, sceneId, slot, showHint]);

  // Dismisses the pane picture so it can be drawn again. The vault keeps
  // it: only the pane cache is cleared, never the vault store.
  const clearScene = useCallback(() => {
    sceneCache.delete(slot);
    setCard({ phase: "idle" });
  }, [slot]);

  const requestFigure = useCallback(
    (scene: string, id: string, startN: number, endN: number, token?: string) => {
      // Callers claim flight.current; this starts the request and releases it.
      const mine = flight.current;
      const fslot = figureSlot(bookId, scene);
      void poll(
        {
          kind: "passage",
          bookId,
          textVersion,
          n: startN,
          ...(endN > startN ? { endN } : {}),
          ...requestStyleFields(prefRef.current),
        },
        token,
      )
        .then(({ url }) => {
          storeFigures(fslot, (prev) =>
            prev.map((f) => (f.id === id ? { ...f, phase: "ready", url, message: null } : f)),
          );
          const done = figureCache.get(fslot)?.find((f) => f.id === id);
          if (done) keepFigurePicture(bookId, scene, done);
        })
        .catch((err: unknown) => {
          storeFigures(fslot, (prev) =>
            prev.map((f) =>
              f.id === id
                ? {
                    ...f,
                    phase: "error",
                    message: err instanceof Error ? err.message : MSG_FAILED,
                    quota: err instanceof ImageRequestError && isQuotaCode(err.code),
                  }
                : f,
            ),
          );
          if (err instanceof HumanNeeded) {
            const retryWithToken = (t: string) => {
              if (flight.current !== null) {
                showHint({ where: "figure", id });
                humanRetry.current = retryWithToken;
                setNeedHuman(true);
                return;
              }
              flight.current = { kind: "figure", sceneId: fslot, id };
              setHintAt(null);
              storeFigures(fslot, (prev) =>
                prev.map((f) => (f.id === id ? { ...f, phase: "loading", message: null } : f)),
              );
              // eslint-disable-next-line react-hooks/immutability -- deferred figure retry recursion, runs after render
              requestFigure(scene, id, startN, endN, t);
            };
            humanRetry.current = retryWithToken;
            setNeedHuman(true);
          }
        })
        .finally(() => {
          release(mine);
        });
    },
    [bookId, textVersion, storeFigures, showHint],
  );

  const illustratePassage = useCallback(() => {
    const view = viewNodeRef.current;
    const sel = window.getSelection();
    if (!view || !sel || !sel.rangeCount) return;
    if (flight.current !== null) {
      showHint({ where: "popover" });
      return;
    }
    const quote = sel.toString().trim();
    if (quote.length < 3) return;
    const entries: ParaEntry[] = [...view.querySelectorAll("p[id][data-n]")].map((el) => ({
      id: el.id,
      n: Number(el.getAttribute("data-n")),
    }));
    const startN = pickStartN(entries, paraOf(sel.anchorNode)?.id ?? null, paraOf(sel.focusNode)?.id ?? null);
    const endN = pickEndN(entries, paraOf(sel.anchorNode)?.id ?? null, paraOf(sel.focusNode)?.id ?? null);
    if (startN === null || endN === null) return;
    setPopover(null);
    sel.removeAllRanges();
    const id = nextFigureId();
    const scene = sceneRef.current;
    const fslot = figSlotRef.current;
    flight.current = { kind: "figure", sceneId: fslot, id };
    const credit = styleCredit(requestStyleFields(prefRef.current));
    storeFigures(fslot, (prev) => [
      ...prev,
      { id, phase: "loading", url: null, quote, startN, endN, credit, message: null },
    ]);
    requestFigure(scene, id, startN, endN);
  }, [requestFigure, storeFigures, showHint]);

  const retryFigure = useCallback(
    (id: string) => {
      const found = figureCache.get(figSlot)?.find((f) => f.id === id);
      if (found?.phase === "error" && flight.current !== null) {
        showHint({ where: "figure", id });
        return;
      }
      if (!canRetryFigure(found, flight.current !== null)) return;
      flight.current = { kind: "figure", sceneId: figSlot, id };
      setHintAt(null);
      storeFigures(figSlot, (prev) => prev.map((f) => (f.id === id ? { ...f, phase: "loading", message: null } : f)));
      requestFigure(sceneId, id, found.startN, found.endN);
    },
    [requestFigure, storeFigures, sceneId, figSlot, showHint],
  );

  // Takes the figure out of the text only; its vault entry stays.
  const removeFigure = useCallback(
    (id: string) => {
      storeFigures(figSlot, (prev) => prev.filter((f) => f.id !== id));
    },
    [storeFigures, figSlot],
  );

  // Re-read the live selection against the current text view. The
  // continuous reader calls it after switching scenes under a selection
  // that started elsewhere, so the popover follows without a second tap.
  const rescan = useCallback(() => {
    const view = viewNodeRef.current;
    if (!view) return;
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (
      !sel ||
      sel.isCollapsed ||
      text.length < 3 ||
      !sel.rangeCount ||
      !view.contains(sel.anchorNode) ||
      !view.contains(sel.focusNode)
    ) {
      lastSelRef.current = null;
      setPopover(null);
      return;
    }
    const prev = lastSelRef.current;
    if (
      prev !== null &&
      prev.text === text &&
      prev.anchor === sel.anchorNode &&
      prev.anchorOffset === sel.anchorOffset &&
      prev.focus === sel.focusNode &&
      prev.focusOffset === sel.focusOffset
    )
      return;
    lastSelRef.current = {
      text,
      anchor: sel.anchorNode,
      anchorOffset: sel.anchorOffset,
      focus: sel.focusNode,
      focusOffset: sel.focusOffset,
    };
    const range = sel.getRangeAt(0);
    rangeRef.current = range.cloneRange();
    setPopover(popoverPos(range.getBoundingClientRect(), { x: window.scrollX, y: window.scrollY }));
  }, []);

  useEffect(() => {
    const view = viewEl;
    if (!view) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(rescan);
    };
    // pointerup covers touch and pen; mouseup stays for older mice. Both
    // share one frame, so a click rescans once.
    view.addEventListener("mouseup", schedule);
    view.addEventListener("pointerup", schedule);
    // Keyboard selections (shift+arrows) fire no pointer event, only a
    // document-level selectionchange. Debounced; rescan dedupes repeats.
    let timer = 0;
    const onSelectionChange = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(rescan, 250);
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      view.removeEventListener("mouseup", schedule);
      view.removeEventListener("pointerup", schedule);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [viewEl, rescan]);

  useEffect(() => {
    if (!popover) return;
    const hide = () => {
      lastSelRef.current = null;
      setPopover(null);
    };
    let frame = 0;
    // Capture phase sees scrolls from inner containers too (they do not
    // bubble), so the pill tracks the text in any reader layout.
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = rangeRef.current?.getBoundingClientRect();
        if (!box || (box.width === 0 && box.height === 0)) {
          hide();
          return;
        }
        const next = popoverPos(box, { x: window.scrollX, y: window.scrollY });
        setPopover((prev) => (prev && prev.top === next.top && prev.left === next.left ? prev : next));
      });
    };
    const onDown = (event: MouseEvent) => {
      if (!popRef.current?.contains(event.target as Node | null)) hide();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", hide);
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("scroll", onScroll, { capture: true });
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", hide);
    };
  }, [popover]);

  // The hint rides on what the caller already renders, so callers need
  // no extra slot: the idle or error card, the popover, the failed figure.
  const hint = PICTURE_COPY.oneAtATime;
  const shownCard = useMemo<SceneCard>(() => {
    if (hintAt?.where !== "scene") return card;
    if (card.phase === "idle") return { phase: "idle", hint };
    return card.phase === "error" ? { phase: "error", message: hint } : card;
  }, [card, hintAt, hint]);
  const shownPopover = useMemo(
    () => (popover && hintAt?.where === "popover" ? { ...popover, hint } : popover),
    [popover, hintAt, hint],
  );
  const shownFigures = useMemo(() => {
    if (hintAt?.where !== "figure") return figures;
    const id = hintAt.id;
    return figures.map((f) => (f.id === id && f.phase === "error" ? { ...f, message: hint } : f));
  }, [figures, hintAt, hint]);

  return {
    card: shownCard,
    needHuman,
    submitHumanToken,
    figures: shownFigures,
    vaultScenes: vault.scenes,
    vaultFigures: vault.figures,
    deleteFromVault: (url: string) => deleteVaultPicture(bookId, url),
    emptyVault: () => emptyVault(bookId),
    popover: shownPopover,
    viewRef,
    popRef,
    illustrateScene,
    illustratePassage,
    hidePopover,
    rescan,
    clearScene,
    removeFigure,
    retryFigure,
    lightbox: { item: lightbox, open: openLightbox, close: closeLightbox },
  };
}
