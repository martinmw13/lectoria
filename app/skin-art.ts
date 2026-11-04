// Hero art for the player buttons, per skin: the illustrated Orchestra,
// Piano, Just Chopin! and Read aloud buttons from the approved skin
// prototypes (public/art/skins/<skin>/).
import type { SkinId } from "./skin";

export type HeroArt = { orchestra: string; piano: string; chopin: string; narrate: string };

const HERO: Record<SkinId, HeroArt> = {
  engraving: {
    orchestra: "/art/skins/engraving/orchestra.svg",
    piano: "/art/skins/engraving/piano.svg",
    chopin: "/art/skins/engraving/chopin.svg",
    narrate: "/art/skins/engraving/narrate.svg",
  },
  watercolor: {
    orchestra: "/art/skins/watercolor/orchestra.svg",
    piano: "/art/skins/watercolor/piano.svg",
    chopin: "/art/skins/watercolor/chopin.png",
    narrate: "/art/skins/watercolor/narrate.svg",
  },
  ink: {
    orchestra: "/art/skins/ink/orchestra.svg",
    piano: "/art/skins/ink/piano.svg",
    chopin: "/art/skins/ink/chopin.svg",
    narrate: "/art/skins/ink/narrate.svg",
  },
  pencil: {
    orchestra: "/art/skins/pencil/orchestra.png",
    piano: "/art/skins/pencil/piano.png",
    chopin: "/art/skins/pencil/chopin.png",
    narrate: "/art/skins/pencil/narrate.png",
  },
  comic: {
    orchestra: "/art/skins/comic/orchestra.svg",
    piano: "/art/skins/comic/piano.svg",
    chopin: "/art/skins/comic/chopin.svg",
    narrate: "/art/skins/comic/narrate.svg",
  },
  chihiro: {
    orchestra: "/art/skins/chihiro/orchestra.png",
    piano: "/art/skins/chihiro/piano.png",
    chopin: "/art/skins/chihiro/chopin.png",
    narrate: "/art/skins/chihiro/narrate.png",
  },
};

export function heroArt(skin: SkinId): HeroArt {
  return HERO[skin];
}
