// Chapter panels: one comic page per chapter, captions below it in
// reading order. The page generates on demand in the reader's style;
// chapters past the reader's reach stay gated.
"use client";

import { PictureByok } from "./picture-byok";
import { useEffect, useRef } from "react";
import { TurnstileWidget } from "../turnstile";
import type { ImageStylePref } from "../image-style";
import type { ChapterPanel } from "./panels";
import { PICTURE_COPY } from "./picture-copy";
import { PictureDraw, PictureWait } from "./picture-draw";
import { PANELS_NOTE } from "./picture-draw-paths";
import { usePictureSkin } from "./picture-skin";
import { useChapterPage } from "./use-chapter-page";

export function PanelsModal({
  ch,
  chapterTitle,
  panels,
  bookId,
  textVersion,
  pref,
  reachedCh,
  onClose,
  onOpenArt,
}: {
  ch: number;
  chapterTitle: string;
  panels: ChapterPanel[];
  bookId: string;
  textVersion: string;
  pref: ImageStylePref;
  reachedCh: number;
  onClose: () => void;
  onOpenArt: (src: string, caption: string, opener: HTMLElement | null) => void;
}) {
  const chapterLabel = `Chapter ${ch}, ${chapterTitle}`;
  const reached = ch <= reachedCh;
  const skin = usePictureSkin();
  const { page, retry, needHuman, submitHumanPass } = useChapterPage({ bookId, textVersion, ch, pref, reachedCh });
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // The shared lightbox sits above the modal and closes itself.
        if (document.querySelector(".lightbox")) return;
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !boxRef.current) return;
      const items = [...boxRef.current.querySelectorAll<HTMLElement>("button, [href], [tabindex]:not([tabindex='-1'])")].filter(
        (el) => !el.hasAttribute("disabled"),
      );
      if (items.length === 0) return;
      const first = items[0] as HTMLElement;
      const last = items[items.length - 1] as HTMLElement;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      opener?.focus?.({ preventScroll: true });
    };
  }, [onClose]);

  return (
    <div className="panels-modal" role="dialog" aria-modal="true" aria-label={chapterLabel}>
      <div ref={boxRef} className="panels-box">
        <button ref={closeRef} type="button" className="panels-x" onClick={onClose} aria-label="Close">
          ×
        </button>
        <p className="panels-head">
          Chapter {ch} · {chapterTitle}
        </p>
        {reached ? (
          <>
            {page.phase === "ready" ? (
              <button
                type="button"
                className="panels-frame"
                onClick={(e) => onOpenArt(page.url, chapterLabel, e.currentTarget)}
                aria-label={`Open art: ${chapterLabel}`}
              >
                <img src={page.url} alt="" />
              </button>
            ) : page.phase === "loading" ? (
              <div className="panels-frame">
                <PictureDraw skin={skin} />
              </div>
            ) : (
              <div className="panels-frame panels-miss" role="alert">
                <p>{page.message}</p>
                {needHuman ? (
                  <TurnstileWidget onToken={submitHumanPass} />
                ) : page.quota ? (
                  <PictureByok onKey={retry} />
                ) : (
                  <button type="button" className="retry-text" onClick={retry}>
                    {PICTURE_COPY.retry}
                  </button>
                )}
              </div>
            )}
            {page.phase === "loading" ? <PictureWait skin={skin} note={PANELS_NOTE} /> : null}
            <ol className="panels-caps">
              {panels.map((p) => (
                <li key={p.key}>{p.caption}</li>
              ))}
            </ol>
          </>
        ) : (
          <p className="panels-gate">Read up to this chapter first.</p>
        )}
      </div>
    </div>
  );
}
