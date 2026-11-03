"use client";

import type { SkinId } from "../skin";
import { useSkin } from "../use-skin";
import { AskLantern, AskComic, AskPencil } from "./ask-art-hand";
import { AskEngraving, AskInk, AskWatercolor } from "./ask-art-print";

const ART: Record<SkinId, () => React.JSX.Element> = {
  engraving: AskEngraving,
  watercolor: AskWatercolor,
  ink: AskInk,
  pencil: AskPencil,
  comic: AskComic,
  chihiro: AskLantern,
};

// The closed launcher drawn in the live skin's own medium.
export function AskArt() {
  const Art = ART[useSkin()];
  return (
    <span className="ask-art">
      <Art />
    </span>
  );
}
