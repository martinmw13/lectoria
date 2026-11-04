// Character portraits: a teaser for future character art. Each shelf
// book has a face-only portrait of its protagonist; Oz, the demo book,
// also has one for every character met in chapter 1. They show in the
// cast only while the reader is in chapter 1. No one else gets one.
export interface Portrait {
  /** Bookmap character id the portrait belongs to. */
  characterId: string;
  characterName: string;
  src: string;
  /** ~512px version, loaded only when the reader opens the zoom. */
  large: string;
  /** Skins with a restyled copy under /portraits/skins/<skin>/; others use src/large. */
  skins?: readonly string[];
}

/** The reader skins (app/skin.ts SKINS; a test keeps them in step). */
export const PORTRAIT_SKINS = ["engraving", "watercolor", "ink", "pencil", "comic", "chihiro"] as const;

export const PORTRAITS: Readonly<Record<string, readonly Portrait[]>> = {
  alice: [
    {
      characterId: "alice",
      characterName: "Alice",
      src: "/portraits/alice.webp",
      large: "/portraits/alice@2x.webp",
    },
  ],
  carol: [
    {
      characterId: "ebenezer-scrooge",
      characterName: "Ebenezer Scrooge",
      src: "/portraits/carol.webp",
      large: "/portraits/carol@2x.webp",
    },
  ],
  dracula: [
    {
      characterId: "jonathan-harker",
      characterName: "Jonathan Harker",
      src: "/portraits/dracula.webp",
      large: "/portraits/dracula@2x.webp",
    },
  ],
  frankenstein: [
    {
      characterId: "victor-frankenstein",
      characterName: "Victor Frankenstein",
      src: "/portraits/frankenstein.webp",
      large: "/portraits/frankenstein@2x.webp",
    },
  ],
  jungle: [
    {
      characterId: "mowgli",
      characterName: "Mowgli",
      src: "/portraits/jungle.webp",
      large: "/portraits/jungle@2x.webp",
    },
  ],
  oz: [
    {
      characterId: "dorothy",
      characterName: "Dorothy",
      src: "/portraits/oz.webp",
      large: "/portraits/oz@2x.webp",
      skins: PORTRAIT_SKINS,
    },
    {
      characterId: "uncle-henry",
      characterName: "Uncle Henry",
      src: "/portraits/oz-uncle-henry.webp",
      large: "/portraits/oz-uncle-henry@2x.webp",
      skins: PORTRAIT_SKINS,
    },
    {
      characterId: "aunt-em",
      characterName: "Aunt Em",
      src: "/portraits/oz-aunt-em.webp",
      large: "/portraits/oz-aunt-em@2x.webp",
      skins: PORTRAIT_SKINS,
    },
    {
      characterId: "toto",
      characterName: "Toto",
      src: "/portraits/oz-toto.webp",
      large: "/portraits/oz-toto@2x.webp",
      skins: PORTRAIT_SKINS,
    },
  ],
  peterpan: [
    {
      characterId: "peter-pan",
      characterName: "Peter Pan",
      src: "/portraits/peterpan.webp",
      large: "/portraits/peterpan@2x.webp",
    },
  ],
  pride: [
    {
      characterId: "elizabeth-bennet",
      characterName: "Elizabeth Bennet",
      src: "/portraits/pride.webp",
      large: "/portraits/pride@2x.webp",
    },
  ],
  sherlock: [
    {
      characterId: "sherlock-holmes",
      characterName: "Sherlock Holmes",
      src: "/portraits/sherlock.webp",
      large: "/portraits/sherlock@2x.webp",
    },
  ],
  treasure: [
    {
      characterId: "jim-hawkins",
      characterName: "Jim Hawkins",
      src: "/portraits/treasure.webp",
      large: "/portraits/treasure@2x.webp",
    },
  ],
};

export const PORTRAIT_CHAPTER = 1;

export type PortraitSrc = Pick<Portrait, "src" | "large">;

const skinned = (path: string, skin: string) => path.replace("/portraits/", `/portraits/skins/${skin}/`);

/**
 * The portrait for this cast entry, or null unless the book maps one for it
 * and the reader is in chapter 1. With a skin that has a restyled copy, the
 * copy is used; otherwise the default (realistic) portrait.
 */
export function portraitFor(bookId: string, characterId: string, chapter: number | undefined, skin?: string): PortraitSrc | null {
  if (chapter !== PORTRAIT_CHAPTER) return null;
  const p = PORTRAITS[bookId]?.find((x) => x.characterId === characterId);
  if (!p) return null;
  if (skin && p.skins?.includes(skin)) return { src: skinned(p.src, skin), large: skinned(p.large, skin) };
  return { src: p.src, large: p.large };
}
