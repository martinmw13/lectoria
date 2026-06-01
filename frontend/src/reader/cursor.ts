import type { ChapterAnalysis, ChaptersData, NCM, Scene } from '../api/types';
import { paginateChapter, type Page } from '../utils/paginate';

export interface Position {
  chapterIdx: number;
  pageIdx: number;
}

/** Domain indices (chapter_index / scene_index), NOT array positions — what MusicPlayer wants. */
export interface MusicScene {
  chapterIndex: number;
  sceneIndex: number;
}

/**
 * Pure, React-free traversal over the NCM + source paragraphs. Immutable: next()/prev()/
 * goToChapter() return a new cursor (or null at a no-move boundary). Owns pagination (via
 * paginate.ts), the current/previous music-scene derivation, and all nav guards — so the
 * boundary off-by-ones live in one unit-tested place. Held by the thin useReaderCursor hook;
 * the ~280 ms slide animation stays in ReaderPage (see ADR-0002 for the core+hook split).
 */
export class ReaderCursor {
  readonly chapterIdx: number;
  readonly pageIdx: number;
  private readonly ncm: NCM;
  private readonly chaptersData: ChaptersData;
  private readonly _pages: Page[]; // current chapter, paginated once per instance

  constructor(
    ncm: NCM,
    chaptersData: ChaptersData,
    position: Position = { chapterIdx: 0, pageIdx: 0 },
  ) {
    this.ncm = ncm;
    this.chaptersData = chaptersData;
    this.chapterIdx = position.chapterIdx;
    this.pageIdx = position.pageIdx;
    this._pages = this.pagesAt(this.chapterIdx);
  }

  get position(): Position {
    return { chapterIdx: this.chapterIdx, pageIdx: this.pageIdx };
  }

  // Pair the NCM chapter with its ChaptersData source by chapter_index (NOT array position) —
  // mirrors the original find() at ReaderPage:52-54 and :110-112.
  private pagesAt(chapterIdx: number): Page[] {
    const chapter = this.ncm.chapters?.[chapterIdx];
    if (!chapter) return [];
    const source = this.chaptersData.chapters?.find(
      (c) => c.chapter_index === chapter.chapter_index,
    );
    return paginateChapter(chapter.scenes ?? [], source?.paragraphs ?? []);
  }

  private get chapterCount(): number {
    return this.ncm.chapters?.length ?? 0;
  }

  get chapter(): ChapterAnalysis | undefined {
    return this.ncm.chapters?.[this.chapterIdx];
  }

  get pages(): Page[] {
    return this._pages;
  }

  get currentPage(): Page | undefined {
    return this._pages[this.pageIdx];
  }

  get currentScene(): Scene | undefined {
    return this.currentPage?.scene;
  }

  get isFirst(): boolean {
    return this.chapterIdx === 0 && this.pageIdx === 0;
  }

  get isLast(): boolean {
    return (
      this.chapterIdx === this.chapterCount - 1 &&
      this.pageIdx >= this._pages.length - 1
    );
  }

  // The scene the music reacts to now (ReaderPage:137, 232-233).
  get musicScene(): MusicScene {
    return {
      chapterIndex: this.chapter?.chapter_index ?? 0,
      sceneIndex: this.currentScene?.scene_index ?? 0,
    };
  }

  // The previous scene music should consider, or undefined. Ports the nested ternaries at
  // ReaderPage:138-149 as three explicit branches (D7 scene presentation, D12 hysteresis).
  // Returns both indices together or neither — matching MusicPlayer's
  // `prevChapterIndex !== undefined && prevSceneIndex !== undefined` guard.
  get prevMusicScene(): MusicScene | undefined {
    const curSceneIdx = this.currentScene?.scene_index ?? 0;

    // (1) same-chapter: previous page belongs to a *different* scene in this chapter.
    if (this.pageIdx > 0) {
      const prevScene = this._pages[this.pageIdx - 1]?.scene;
      if (prevScene && prevScene.scene_index !== curSceneIdx) {
        return {
          chapterIndex: this.chapter?.chapter_index ?? 0,
          sceneIndex: prevScene.scene_index,
        };
      }
      return undefined; // same-scene continuation -> no music change
    }

    // (2) chapter-start: first page of a non-first chapter -> prior chapter's last scene.
    if (this.chapterIdx > 0) {
      const prevChapter = this.ncm.chapters?.[this.chapterIdx - 1];
      const lastScene = prevChapter?.scenes?.at(-1);
      if (prevChapter && lastScene) {
        return { chapterIndex: prevChapter.chapter_index, sceneIndex: lastScene.scene_index };
      }
      return undefined;
    }

    // (3) book-start: first page of the first chapter -> nothing.
    return undefined;
  }

  private withPosition(position: Position): ReaderCursor {
    return new ReaderCursor(this.ncm, this.chaptersData, position);
  }

  // Ports goNext (ReaderPage:79-98): empty-page guard, page-step, chapter-step, end no-op.
  next(): ReaderCursor | null {
    if (!this._pages.length) return null; // <- the guard isLast does NOT capture
    if (this.pageIdx < this._pages.length - 1) {
      return this.withPosition({ chapterIdx: this.chapterIdx, pageIdx: this.pageIdx + 1 });
    }
    if (this.chapterIdx < this.chapterCount - 1) {
      return this.withPosition({ chapterIdx: this.chapterIdx + 1, pageIdx: 0 });
    }
    return null;
  }

  // Ports goPrev (ReaderPage:100-122): page-step back, else prior chapter's last page
  // (re-paginate + clamp), start no-op. Note the asymmetry with next(): no !pages.length guard.
  prev(): ReaderCursor | null {
    if (this.pageIdx > 0) {
      return this.withPosition({ chapterIdx: this.chapterIdx, pageIdx: this.pageIdx - 1 });
    }
    if (this.chapterIdx > 0) {
      const prevChapter = this.ncm.chapters?.[this.chapterIdx - 1];
      if (!prevChapter) return null; // mirrors the `if (!prevChapter) return` at :107
      const prevPages = this.pagesAt(this.chapterIdx - 1);
      const lastIdx = Math.max(0, prevPages.length - 1);
      return this.withPosition({ chapterIdx: this.chapterIdx - 1, pageIdx: lastIdx });
    }
    return null;
  }

  // Ports goToChapter (ReaderPage:124-129) minus setShowNav (presentation -> ReaderPage).
  goToChapter(chapterIdx: number): ReaderCursor {
    return this.withPosition({ chapterIdx, pageIdx: 0 });
  }
}
