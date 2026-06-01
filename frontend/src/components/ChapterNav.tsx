import type { ChapterAnalysis, ChapterSummary } from '../api/types';

interface Props {
  chapters: ChapterAnalysis[];
  bookMapChapters: ChapterSummary[];
  currentChapterIdx: number;
  onSelect: (idx: number) => void;
  onClose: () => void;
}

export default function ChapterNav({
  chapters,
  bookMapChapters,
  currentChapterIdx,
  onSelect,
  onClose,
}: Props) {
  return (
    <div className="chapter-nav-overlay" onClick={onClose}>
      <nav className="chapter-nav" onClick={(e) => e.stopPropagation()}>
        <h3>Chapters</h3>
        <ul>
          {chapters.map((ch, idx) => {
            const summary = bookMapChapters.find(
              (c) => c.chapter_index === ch.chapter_index,
            );
            const sceneCount = ch.scenes?.length ?? 0;
            return (
              <li
                key={ch.chapter_index}
                className={idx === currentChapterIdx ? 'active' : ''}
                onClick={() => onSelect(idx)}
              >
                <span className="ch-title">
                  {summary?.title || `Chapter ${ch.chapter_index}`}
                </span>
                <span className="ch-scenes">
                  {sceneCount} scene{sceneCount !== 1 ? 's' : ''}
                </span>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
