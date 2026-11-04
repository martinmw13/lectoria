// Protagonist portraits: a teaser for future character art. Each shelf
// book has one face-only portrait of its protagonist, shown in the cast
// only while the reader is in chapter 1. No other character gets one.
export interface Portrait {
  /** Bookmap character id the portrait belongs to. */
  characterId: string;
  characterName: string;
  src: string;
}

export const PORTRAITS: Readonly<Record<string, Portrait>> = {
  alice: { characterId: "alice", characterName: "Alice", src: "/portraits/alice.webp" },
  carol: { characterId: "ebenezer-scrooge", characterName: "Ebenezer Scrooge", src: "/portraits/carol.webp" },
  dracula: { characterId: "jonathan-harker", characterName: "Jonathan Harker", src: "/portraits/dracula.webp" },
  frankenstein: { characterId: "victor-frankenstein", characterName: "Victor Frankenstein", src: "/portraits/frankenstein.webp" },
  jungle: { characterId: "mowgli", characterName: "Mowgli", src: "/portraits/jungle.webp" },
  oz: { characterId: "dorothy", characterName: "Dorothy", src: "/portraits/oz.webp" },
  peterpan: { characterId: "peter-pan", characterName: "Peter Pan", src: "/portraits/peterpan.webp" },
  pride: { characterId: "elizabeth-bennet", characterName: "Elizabeth Bennet", src: "/portraits/pride.webp" },
  sherlock: { characterId: "sherlock-holmes", characterName: "Sherlock Holmes", src: "/portraits/sherlock.webp" },
  treasure: { characterId: "jim-hawkins", characterName: "Jim Hawkins", src: "/portraits/treasure.webp" },
};

export const PORTRAIT_CHAPTER = 1;

/** The portrait src for this cast entry, or null unless it is the book's protagonist and the reader is in chapter 1. */
export function portraitFor(bookId: string, characterId: string, chapter: number | undefined): string | null {
  if (chapter !== PORTRAIT_CHAPTER) return null;
  const p = PORTRAITS[bookId];
  return p && p.characterId === characterId ? p.src : null;
}
