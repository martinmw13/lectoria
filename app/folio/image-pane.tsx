// Left image pane: placeholder, drawing while loading, revealed image
// with hover expand, error with retry. Click opens the lightbox.
"use client";

import { PictureByok } from "./picture-byok";
import { useRef, useState } from "react";
import { PANELS_LABEL } from "./panels";
import { PICTURE_COPY } from "./picture-copy";
import { PictureButton } from "./picture-button";
import { usePictureSkin } from "./picture-skin";
import { PictureWait } from "./picture-draw";
import { PictureSlot } from "./picture-slot";
import { TurnstileWidget } from "../turnstile";
import type { SceneCard } from "./use-pictures";

export function ImagePane({
  card,
  needHuman,
  onHumanPass,
  onPicture,
  onRetry,
  onClear,
  onOpen,
  bare,
  onPictureChapter,
}: {
  card: SceneCard;
  // When the API asks for a human proof, the pane shows the check once.
  needHuman: boolean;
  onHumanPass: (token: string) => void;
  onPicture: () => void;
  onRetry: () => void;
  onClear: () => void;
  onOpen: (src: string, caption: string, opener: HTMLElement | null) => void;
  // The cover shows the placeholder with no pill: nothing to picture yet.
  bare?: boolean;
  // On text pages the pill pairs the scene action with the chapter one.
  onPictureChapter?: ((opener: HTMLElement | null) => void) | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const timer = useRef<number | null>(null);
  const skin = usePictureSkin();

  function armExpand() {
    if (timer.current !== null) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setExpanded(true);
    }, 250);
  }

  function cancelExpand() {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    setExpanded(false);
  }

  return (
    <section className="img-pane" aria-label="Illustration">
      <div className="frame">
        {card.phase === "idle" ? (
          <>
            <div className="paper-grain" aria-hidden="true">
              <span className="blob b1" />
              <span className="blob b2" />
              <span className="blob b3" />
              <span className="grain" />
            </div>
            {bare ? null : onPictureChapter ? (
              <span className="pic-pair" role="group" aria-label="Picture choices">
                <PictureButton skin={skin} label="Picture this scene" onClick={onPicture} />
                <PictureButton
                  skin={skin}
                  label={PANELS_LABEL}
                  onClick={(e) => onPictureChapter(e.currentTarget)}
                />
              </span>
            ) : (
              <PictureButton skin={skin} label="Picture this scene" onClick={onPicture} />
            )}
            {card.hint ? (
              <p className="pic-hint" role="status">
                {card.hint}
              </p>
            ) : null}
          </>
        ) : card.phase === "loading" || card.phase === "ready" ? (
          <>
            <PictureSlot
              phase={card.phase}
              url={card.phase === "ready" ? card.url : ""}
              alt={card.phase === "ready" ? card.caption : ""}
              className="pane-slot"
              imgProps={
                card.phase === "ready"
                  ? {
                      className: "pane-img",
                      tabIndex: 0,
                      onMouseEnter: armExpand,
                      onMouseLeave: cancelExpand,
                      onFocus: cancelExpand,
                      onClick: (e) => {
                        cancelExpand();
                        onOpen(card.url, card.caption, e.currentTarget);
                      },
                      onKeyDown: (e) => {
                        if (e.key === "Enter") onOpen(card.url, card.caption, e.currentTarget);
                      },
                    }
                  : undefined
              }
            />
            {expanded && card.phase === "ready" ? (
              <>
                <div className="expand-dim" aria-hidden="true" />
                <img
                  className="expand-img"
                  src={card.url}
                  alt=""
                  onMouseLeave={cancelExpand}
                  onClick={() => {
                    cancelExpand();
                    onOpen(card.url, card.caption, null);
                  }}
                />
              </>
            ) : null}
          </>
        ) : (
          <div className="pane-error" role="alert">
            {needHuman ? (
              <>
                <p>{PICTURE_COPY.human}</p>
                <TurnstileWidget onToken={onHumanPass} />
              </>
            ) : (
              <>
                <p>{card.message}</p>
                {card.quota ? (
                  <PictureByok onKey={onRetry} />
                ) : (
                  <button type="button" className="retry-text" onClick={onRetry}>
                    {PICTURE_COPY.retry}
                  </button>
                )}
              </>
            )}
          </div>
        )}
        {needHuman && card.phase !== "error" ? (
          <div className="pane-error" role="alert">
            <p>{PICTURE_COPY.human}</p>
            <TurnstileWidget onToken={onHumanPass} />
          </div>
        ) : null}
      </div>
      {card.phase === "loading" ? <PictureWait skin={skin} /> : null}
      {card.phase === "ready" ? (
        <div className="pane-cap">
          <span className="pane-cap-text">{card.caption}</span>
          <button
            type="button"
            className="pane-x"
            onClick={onClear}
            aria-label={PICTURE_COPY.remove}
            title={PICTURE_COPY.remove}
          >
            ×
          </button>
        </div>
      ) : null}
      {card.phase === "ready" && onPictureChapter ? (
        <button type="button" className="pane-chapter" onClick={(e) => onPictureChapter(e.currentTarget)}>
          {PANELS_LABEL}
        </button>
      ) : null}
    </section>
  );
}
