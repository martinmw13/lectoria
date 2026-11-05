// Inline figures: the selection popover plus the figures rendered
// after their end paragraph. Click opens the lightbox.
"use client";

import { PictureByok } from "./picture-byok";
import { createPortal } from "react-dom";
import { truncateCaption } from "./helpers";
import { PICTURE_COPY, PictureIcon } from "./picture-copy";
import { PictureSlot } from "./picture-slot";
import { PictureWait } from "./picture-draw";
import { usePictureSkin } from "./picture-skin";
import type { InlineFigure } from "./use-pictures";

export function SelectionPopover({
  pos,
  popRef,
  onPick,
}: {
  pos: { top: number; left: number; hint?: string };
  popRef: React.Ref<HTMLElement>;
  onPick: () => void;
}) {
  // Portalled to the body at document coordinates, so the pill stays on
  // the selection however the reader lays scenes out.
  if (typeof document === "undefined") return null;
  return createPortal(
    <button
      type="button"
      ref={popRef as React.Ref<HTMLButtonElement>}
      className="picture-float"
      style={{ top: pos.top, left: pos.left }}
      onClick={onPick}
      aria-label={pos.hint ?? "Picture this"}
      aria-live="polite"
    >
      <PictureIcon size={12} />
      <span className="picture-float-lbl">{pos.hint ?? "Picture this"}</span>
    </button>,
    document.body,
  );
}

export function InlineFigureView({
  figure,
  onRemove,
  onRetry,
  onOpen,
  refCb,
}: {
  figure: InlineFigure;
  onRemove: () => void;
  onRetry: () => void;
  onOpen: (src: string, caption: string, opener: HTMLElement | null) => void;
  refCb: (el: HTMLElement | null) => void;
}) {
  const skin = usePictureSkin();
  if (figure.phase === "loading") {
    return (
      <figure className="genfig" data-fig={figure.id} ref={refCb as React.Ref<HTMLElement>}>
        <PictureSlot phase="loading" url="" alt="" className="genload" />
        <PictureWait skin={skin} as="figcaption" />
      </figure>
    );
  }
  if (figure.phase === "error") {
    return (
      <figure className="genfig" data-fig={figure.id} ref={refCb as React.Ref<HTMLElement>}>
        <p className="gen-error" role="alert">
          {figure.message}{" "}
          {figure.quota ? null : (
            <button type="button" className="retry-text" onClick={onRetry}>
              {PICTURE_COPY.retry}
            </button>
          )}
        </p>
        {figure.quota ? <PictureByok onKey={onRetry} /> : null}
      </figure>
    );
  }
  if (!figure.url) return null;
  const url = figure.url;
  const captioned = `\u201C${truncateCaption(figure.quote)}\u201D`;
  return (
    <figure className="genfig" data-fig={figure.id} ref={refCb as React.Ref<HTMLElement>}>
      <PictureSlot
        phase="ready"
        url={url}
        alt={captioned}
        className="genload"
        imgProps={{
          className: "gen-ready",
          loading: "lazy",
          decoding: "async",
          tabIndex: 0,
          onClick: (e) => onOpen(url, captioned, e.currentTarget),
          onKeyDown: (e) => {
            if (e.key === "Enter") onOpen(url, captioned, e.currentTarget);
          },
        }}
      />
      <figcaption>
        <span className="grow">{captioned}</span>
        <span className="gcredit">{figure.credit}</span>
        <button
          type="button"
          className="grm"
          onClick={onRemove}
          aria-label={PICTURE_COPY.remove}
          title={PICTURE_COPY.remove}
        >
          ×
        </button>
      </figcaption>
    </figure>
  );
}
