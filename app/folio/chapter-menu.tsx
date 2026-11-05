// Chapter selector in the top line, on the shared ListboxSelect
// (select-only combobox, WAI-ARIA APG pattern).
"use client";

import { ListboxSelect, type ListboxOption } from "./listbox-select";

export interface ChapterOption {
  ch: number;
  title: string;
}

// Type-ahead: digits match the chapter number, anything else the start of
// the title (case-insensitive). Searches from just after `from`, wrapping.
export function typeAheadMatch(chapters: ChapterOption[], query: string, from: number): number {
  const q = query.trim().toLowerCase();
  if (!q) return -1;
  if (/^\d+$/.test(q)) return chapters.findIndex((c) => String(c.ch) === q);
  const n = chapters.length;
  for (let step = 1; step <= n; step++) {
    const i = (from + step) % n;
    if (chapters[i]?.title.toLowerCase().startsWith(q)) return i;
  }
  return -1;
}

export function ChapterMenu({
  ch,
  chaptersTotal,
  chapters,
  onJumpChapter,
}: {
  ch: number;
  chaptersTotal: number;
  chapters: ChapterOption[];
  onJumpChapter: (ch: number) => void;
}) {
  const options: ListboxOption[] = chapters.map((c) => ({ value: String(c.ch), label: c.title, lead: c.ch }));
  const current = chapters.find((c) => c.ch === ch);
  return (
    <ListboxSelect
      options={options}
      value={String(ch)}
      onSelect={(v) => onJumpChapter(Number(v))}
      className="chapter-jump"
      buttonClassName="chapter-jump-btn"
      listLabel="Chapters"
      ariaLabel={`Chapter ${ch} of ${chaptersTotal}${current ? `: ${current.title}` : ""}`}
      title="Go to chapter"
      typeAhead={(_, q, from) => typeAheadMatch(chapters, q, from)}
    >
      <span className="chapter-jump-text">
        Chapter {ch} of {chaptersTotal}
      </span>
    </ListboxSelect>
  );
}
