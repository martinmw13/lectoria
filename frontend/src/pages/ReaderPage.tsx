import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getNCM, getChapters, type NCM, type ChaptersData } from '../api/client';
import PageView from '../components/PageView';
import ChapterNav from '../components/ChapterNav';
import DevPanel from '../components/DevPanel';
import MusicPlayer from '../components/MusicPlayer';
import { paginateChapter, type Page } from '../utils/paginate';

export default function ReaderPage() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();

  const [ncm, setNcm] = useState<NCM | null>(null);
  const [chaptersData, setChaptersData] = useState<ChaptersData | null>(null);
  const [chapterIdx, setChapterIdx] = useState(0);
  const [pageIdx, setPageIdx] = useState(0);
  const [maxRevealed, setMaxRevealed] = useState(0);
  const [showNav, setShowNav] = useState(false);
  const [devMode, setDevMode] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [error, setError] = useState('');
  const [slideDir, setSlideDir] = useState<'none' | 'left' | 'right'>('none');
  const slideTimeout = useRef<number | null>(null);

  useEffect(() => {
    if (!bookId) return;
    Promise.all([getNCM(bookId), getChapters(bookId)])
      .then(([n, c]) => { setNcm(n); setChaptersData(c); })
      .catch((e) => setError(String(e)));
  }, [bookId]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && e.key === 'd') {
        e.preventDefault();
        setDevMode((prev) => !prev);
      }
      if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const chapter = ncm?.chapters[chapterIdx];
  const sourceChapter = chaptersData?.chapters.find(
    (c) => c.chapter_index === chapter?.chapter_index,
  );
  const paragraphs = sourceChapter?.paragraphs || [];

  const pages: Page[] = useMemo(() => {
    if (!chapter) return [];
    return paginateChapter(chapter.scenes, paragraphs);
  }, [chapter, paragraphs]);

  const currentPage = pages[pageIdx];
  const currentScene = currentPage?.scene;

  const prevPageScene = pageIdx > 0 ? pages[pageIdx - 1]?.scene : undefined;

  const chapterSummary = ncm?.book_map.chapters.find(
    (c) => c.chapter_index === chapter?.chapter_index,
  );

  const animateSlide = useCallback((dir: 'left' | 'right', then: () => void) => {
    if (slideTimeout.current) clearTimeout(slideTimeout.current);
    setSlideDir(dir);
    slideTimeout.current = window.setTimeout(() => {
      then();
      setSlideDir('none');
      slideTimeout.current = null;
    }, 280);
  }, []);

  function goNext() {
    if (!pages.length) return;

    if (pageIdx < pages.length - 1) {
      const nextIdx = pageIdx + 1;
      animateSlide('left', () => {
        setPageIdx(nextIdx);
        setMaxRevealed((prev) => Math.max(prev, nextIdx));
      });
      return;
    }

    if (ncm && chapterIdx < ncm.chapters.length - 1) {
      animateSlide('left', () => {
        setChapterIdx(chapterIdx + 1);
        setPageIdx(0);
        setMaxRevealed(0);
      });
    }
  }

  function goPrev() {
    if (pageIdx > 0) {
      animateSlide('right', () => setPageIdx(pageIdx - 1));
      return;
    }
    if (ncm && chapterIdx > 0) {
      const prevChapter = ncm.chapters[chapterIdx - 1];
      animateSlide('right', () => {
        setChapterIdx(chapterIdx - 1);
        const prevSource = chaptersData?.chapters.find(
          (c) => c.chapter_index === prevChapter.chapter_index,
        );
        const prevPages = paginateChapter(
          prevChapter.scenes,
          prevSource?.paragraphs || [],
        );
        const lastIdx = prevPages.length - 1;
        setPageIdx(Math.max(0, lastIdx));
        setMaxRevealed(lastIdx);
      });
    }
  }

  function goToChapter(idx: number) {
    setChapterIdx(idx);
    setPageIdx(0);
    setMaxRevealed(0);
    setShowNav(false);
  }

  // Determine which scene the music should react to
  const musicSceneIndex = currentScene?.scene_index ?? 0;
  const prevMusicScene = prevPageScene && prevPageScene.scene_index !== musicSceneIndex
    ? prevPageScene : undefined;
  const prevMusicChapterIndex = prevMusicScene
    ? chapter?.chapter_index
    : (pageIdx === 0 && chapterIdx > 0
      ? ncm?.chapters[chapterIdx - 1]?.chapter_index
      : undefined);
  const prevMusicSceneIndex = prevMusicScene
    ? prevMusicScene.scene_index
    : (pageIdx === 0 && chapterIdx > 0
      ? ncm?.chapters[chapterIdx - 1]?.scenes.at(-1)?.scene_index
      : undefined);

  if (error) {
    return (
      <div className="page">
        <div className="error-msg">{error}</div>
        <button onClick={() => navigate('/')}>Back</button>
      </div>
    );
  }

  if (!ncm || !chaptersData || !chapter) {
    return <div className="page loading">Loading book data...</div>;
  }

  const isFirst = chapterIdx === 0 && pageIdx === 0;
  const isLast = chapterIdx === ncm.chapters.length - 1 && pageIdx >= pages.length - 1;

  const slideClass = slideDir === 'left'
    ? 'slide-out-left'
    : slideDir === 'right'
      ? 'slide-out-right'
      : 'slide-in';

  return (
    <div className={`page reader-page ${darkMode ? 'reader-dark' : 'reader-light'}`}>
      <header className="reader-header">
        <button className="icon-btn" onClick={() => navigate('/')}>
          &larr;
        </button>
        <div className="header-title" onClick={() => setShowNav(!showNav)}>
          <h2>{ncm.book_map.title}</h2>
          <span className="chapter-label">
            {chapterSummary?.title || `Chapter ${chapter.chapter_index}`}
          </span>
        </div>
        <div className="header-controls">
          <label className="theme-toggle" title="Toggle dark mode">
            <input
              type="checkbox"
              checked={darkMode}
              onChange={(e) => setDarkMode(e.target.checked)}
            />
            {darkMode ? 'Dark' : 'Light'}
          </label>
          <label className="dev-toggle" title="Toggle developer view (Ctrl+D)">
            <input
              type="checkbox"
              checked={devMode}
              onChange={(e) => setDevMode(e.target.checked)}
            />
            Dev
          </label>
        </div>
      </header>

      {showNav && (
        <ChapterNav
          chapters={ncm.chapters}
          bookMapChapters={ncm.book_map.chapters}
          currentChapterIdx={chapterIdx}
          onSelect={goToChapter}
          onClose={() => setShowNav(false)}
        />
      )}

      <main className="reader-content">
        {currentPage && (
          <div className={`page-slide ${slideClass}`} key={`${chapterIdx}-${pageIdx}`}>
            <PageView
              page={currentPage}
              bookId={bookId!}
              chapterIndex={chapter.chapter_index}
              characters={ncm.book_map.characters}
              devMode={devMode}
              chapterAnalysis={chapter}
            />
          </div>
        )}
      </main>

      <MusicPlayer
        bookId={bookId!}
        chapterIndex={chapter.chapter_index}
        sceneIndex={musicSceneIndex}
        prevChapterIndex={prevMusicChapterIndex}
        prevSceneIndex={prevMusicSceneIndex}
      />

      <footer className="reader-footer">
        <button onClick={goPrev} disabled={isFirst}>
          &larr; Prev
        </button>
        <span className="scene-indicator">
          {currentPage && (
            <>
              {currentPage.scene.title}
              {currentPage.totalPagesInScene > 1 && (
                <> ({currentPage.pageInScene + 1}/{currentPage.totalPagesInScene})</>
              )}
              {' '}&middot; Ch {chapterIdx + 1}/{ncm.chapters.length}
            </>
          )}
        </span>
        <button onClick={goNext} disabled={isLast}>
          Next &rarr;
        </button>
      </footer>

      {devMode && currentScene && (
        <DevPanel
          scene={currentScene}
          chapter={chapter}
          bookId={bookId!}
        />
      )}
    </div>
  );
}
