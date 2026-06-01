import { describe, it, expect } from 'vitest';
import { ReaderCursor, type Position } from './cursor';
import type {
  Chapter, ChapterAnalysis, ChaptersData, NCM, Paragraph, Scene,
} from '../api/types';

const scene = (scene_index: number, start: number, end: number): Scene => ({
  scene_index, start_paragraph: start, end_paragraph: end, title: `Scene ${scene_index}`,
  emotion: 'mystery', pacing: 'medium', scene_type: 'description', transition_type: 'none',
  image_prompt: '',
});

const chapterAnalysis = (chapter_index: number, scenes: Scene[]): ChapterAnalysis => ({
  chapter_index, scenes, attempt_count: 0, cover_description: '', is_fallback: false,
  llm_model: '',
});

const para = (index: number, words = 40): Paragraph => ({
  index, text: Array(words).fill('word').join(' '),
});

const sourceChapter = (chapter_index: number, paragraphs: Paragraph[]): Chapter => ({
  chapter_index, is_narrative: true, title: '', paragraphs,
});

const ncm = (chapters: ChapterAnalysis[]): NCM => ({
  book_map: { book_id: '', genre: '', title: 'Test', chapters: [] }, chapters,
});

const chaptersData = (chapters: Chapter[]): ChaptersData => ({ chapters });

// Primary fixture. chapter_index values (10, 20) deliberately differ from array indices (0, 1),
// AND the ChaptersData array is ordered opposite to the NCM ([20, 10] vs [10, 20]) so the pairing
// test catches the *natural* regression (array-index lookup), not just the obvious one.
//
// NCM: Chapter A (chapter_index 10, idx 0): s0 = paras 1-2 (1 short page);
//   s1 = paras 3-10 (8 paras x 40 words = 320 words > 250 -> 2 pages).
// Chapter B (chapter_index 20, idx 1): s0 = paras 1-3 (1 page).
// So A paginates to 3 pages [s0], [s1 p0], [s1 p1]; B to 1 page.
const NCM_FIXTURE = ncm([
  chapterAnalysis(10, [scene(0, 1, 2), scene(1, 3, 10)]),
  chapterAnalysis(20, [scene(0, 1, 3)]),
]);

// ChaptersData reversed relative to NCM: pairing must be by chapter_index, not array position.
const CHAPTERS_FIXTURE = chaptersData([
  sourceChapter(20, [para(1), para(2), para(3)]),
  sourceChapter(10, [para(1), para(2), para(3), para(4), para(5),
    para(6), para(7), para(8), para(9), para(10)]),
]);

const at = (position: Position) => new ReaderCursor(NCM_FIXTURE, CHAPTERS_FIXTURE, position);

describe('ReaderCursor — pagination & chapter↔source pairing', () => {
  it('paginates chapter A to 3 pages by pairing on chapter_index', () => {
    expect(at({ chapterIdx: 0, pageIdx: 0 }).pages).toHaveLength(3);
  });

  it('paginates chapter B to 1 page', () => {
    expect(at({ chapterIdx: 1, pageIdx: 0 }).pages).toHaveLength(1);
  });
});

describe('ReaderCursor — next()', () => {
  it('page-steps within a chapter', () => {
    expect(at({ chapterIdx: 0, pageIdx: 0 }).next()?.position).toEqual({ chapterIdx: 0, pageIdx: 1 });
  });

  it('chapter-steps to page 0 of the next chapter', () => {
    expect(at({ chapterIdx: 0, pageIdx: 2 }).next()?.position).toEqual({ chapterIdx: 1, pageIdx: 0 });
  });

  it('returns null at the book end', () => {
    expect(at({ chapterIdx: 1, pageIdx: 0 }).next()).toBeNull();
  });
});

describe('ReaderCursor — prev()', () => {
  it('page-steps back within a chapter', () => {
    expect(at({ chapterIdx: 0, pageIdx: 1 }).prev()?.position).toEqual({ chapterIdx: 0, pageIdx: 0 });
  });

  it('lands on the last page of the previous chapter (re-paginate + clamp)', () => {
    expect(at({ chapterIdx: 1, pageIdx: 0 }).prev()?.position).toEqual({ chapterIdx: 0, pageIdx: 2 });
  });

  it('returns null at the book start', () => {
    expect(at({ chapterIdx: 0, pageIdx: 0 }).prev()).toBeNull();
  });
});

describe('ReaderCursor — goToChapter()', () => {
  it('jumps to page 0 of the target chapter', () => {
    expect(at({ chapterIdx: 0, pageIdx: 2 }).goToChapter(1).position).toEqual({ chapterIdx: 1, pageIdx: 0 });
  });
});

describe('ReaderCursor — isFirst / isLast', () => {
  it('isFirst is true only at {0,0}', () => {
    expect(at({ chapterIdx: 0, pageIdx: 0 }).isFirst).toBe(true);
    expect(at({ chapterIdx: 0, pageIdx: 1 }).isFirst).toBe(false);
  });

  it('isLast is true only at the last page of the last chapter', () => {
    expect(at({ chapterIdx: 1, pageIdx: 0 }).isLast).toBe(true);
    expect(at({ chapterIdx: 0, pageIdx: 2 }).isLast).toBe(false);
  });
});

describe('ReaderCursor — musicScene', () => {
  it('reports domain chapter_index + scene_index of the current page', () => {
    expect(at({ chapterIdx: 0, pageIdx: 0 }).musicScene).toEqual({ chapterIndex: 10, sceneIndex: 0 });
  });
});

describe('ReaderCursor — prevMusicScene', () => {
  it('same-chapter: previous page belongs to a different scene', () => {
    // {0,1} is s1 p0; previous page {0,0} is s0 -> different scene.
    expect(at({ chapterIdx: 0, pageIdx: 1 }).prevMusicScene).toEqual({ chapterIndex: 10, sceneIndex: 0 });
  });

  it('same-scene continuation: previous page is the same scene -> undefined', () => {
    // {0,2} is s1 p1; previous page {0,1} is also s1 -> no music change.
    expect(at({ chapterIdx: 0, pageIdx: 2 }).prevMusicScene).toBeUndefined();
  });

  it('chapter-start: first page of a non-first chapter -> prior chapter last scene', () => {
    expect(at({ chapterIdx: 1, pageIdx: 0 }).prevMusicScene).toEqual({ chapterIndex: 10, sceneIndex: 1 });
  });

  it('book-start: first page of the first chapter -> undefined', () => {
    expect(at({ chapterIdx: 0, pageIdx: 0 }).prevMusicScene).toBeUndefined();
  });
});

describe('ReaderCursor — empty-scenes guard', () => {
  // Chapter A has no scenes (-> pages = []) followed by a non-empty chapter B. This is the case
  // isLast would NOT catch: next() must return null on the empty chapter even though it is not
  // the last chapter, so the animation never fires on a no-op.
  const EMPTY_NCM = ncm([
    chapterAnalysis(10, []),
    chapterAnalysis(20, [scene(0, 1, 3)]),
  ]);
  const EMPTY_CHAPTERS = chaptersData([
    sourceChapter(10, []),
    sourceChapter(20, [para(1), para(2), para(3)]),
  ]);
  const emptyAt = (position: Position) => new ReaderCursor(EMPTY_NCM, EMPTY_CHAPTERS, position);

  it('currentPage is undefined on the empty chapter', () => {
    expect(emptyAt({ chapterIdx: 0, pageIdx: 0 }).currentPage).toBeUndefined();
  });

  it('isLast is false (not the last chapter)', () => {
    expect(emptyAt({ chapterIdx: 0, pageIdx: 0 }).isLast).toBe(false);
  });

  it('next() returns null via the !pages.length guard', () => {
    expect(emptyAt({ chapterIdx: 0, pageIdx: 0 }).next()).toBeNull();
  });
});
