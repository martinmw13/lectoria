// Chapter cover heading. Many books title their chapters with their own
// number only ("I", "XII", "Chapter 1"); showing the app's arabic number
// above it doubled the number down the cover (Chapter / 1 / I). Such a
// title becomes the one heading, "Chapter I", with no separate number.

const NUMERAL_ONLY = /^(?:chapter\s+)?([ivxlcdm]+|\d+)\.?$/i;

export interface ChapterHeading {
  /** The kicker and big arabic number above the title; false for numeral-only titles. */
  showNumber: boolean;
  title: string;
}

export function chapterHeading(title: string): ChapterHeading {
  const match = NUMERAL_ONLY.exec(title.trim());
  if (!match) return { showNumber: true, title };
  const numeral = match[1]!;
  return { showNumber: false, title: `Chapter ${/^\d+$/.test(numeral) ? numeral : numeral.toUpperCase()}` };
}
