import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getNCM, getChapters } from '../api/client';
import type { NCM, ChaptersData } from '../api/types';
import { useReaderCursor } from '../hooks/useReaderCursor';
import PageView from '../components/PageView';
import ChapterNav from '../components/ChapterNav';
import DevPanel from '../components/DevPanel';
import MusicPlayer from '../components/MusicPlayer';

export default function ReaderPage() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();

  const [ncm, setNcm] = useState<NCM | null>(null);
  const [chaptersData, setChaptersData] = useState<ChaptersData | null>(null);
  const [showNav, setShowNav] = useState(false);
  const [devMode, setDevMode] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [error, setError] = useState('');
  const [slideDir, setSlideDir] = useState<'none' | 'left' | 'right'>('none');
  const slideTimeout = useRef<number | null>(null);

  // Where am I / what page renders / which scene drives music / how do I move — all delegated
  // to the pure ReaderCursor; ReaderPage keeps only the slide animation + wiring (see ADR-0002).
  const { cursor, commit } = useReaderCursor(ncm, chaptersData);

  // Latest-ref pattern: keydown listener is registered once but always calls the freshest goNext/goPrev.
  const goNextRef = useRef<() => void>(() => {});
  const goPrevRef = useRef<() => void>(() => {});

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
      if (e.key === 'ArrowRight') { e.preventDefault(); goNextRef.current(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrevRef.current(); }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const animateSlide = useCallback((dir: 'left' | 'right', then: () => void) => {
    if (slideTimeout.current) clearTimeout(slideTimeout.current);
    setSlideDir(dir);
    slideTimeout.current = window.setTimeout(() => {
      then();
      setSlideDir('none');
      slideTimeout.current = null;
    }, 280);
  }, []);

  // Animate iff the transition is a real move; a null result is a no-op boundary (book end /
  // book start / empty chapter) and must not trigger the slide.
  const goNext = () => {
    const n = cursor?.next();
    if (n) animateSlide('left', () => commit(n));
  };
  const goPrev = () => {
    const n = cursor?.prev();
    if (n) animateSlide('right', () => commit(n));
  };
  const goToChapter = (idx: number) => {
    const n = cursor?.goToChapter(idx);
    if (n) commit(n); // no animation (matches original)
    setShowNav(false);
  };

  useEffect(() => {
    goNextRef.current = goNext;
    goPrevRef.current = goPrev;
  });

  if (error) {
    return (
      <div className="page">
        <div className="error-msg">{error}</div>
        <button onClick={() => navigate('/')}>Back</button>
      </div>
    );
  }

  const chapter = cursor?.chapter;
  if (!ncm || !chaptersData || !cursor || !chapter) {
    return <div className="page loading">Loading book data...</div>;
  }

  const currentPage = cursor.currentPage;
  const currentScene = cursor.currentScene;
  const music = cursor.musicScene;
  const prevMusic = cursor.prevMusicScene;
  const chapterSummary = ncm.book_map.chapters?.find(
    (c) => c.chapter_index === chapter.chapter_index,
  );

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
          chapters={ncm.chapters ?? []}
          bookMapChapters={ncm.book_map.chapters ?? []}
          currentChapterIdx={cursor.chapterIdx}
          onSelect={goToChapter}
          onClose={() => setShowNav(false)}
        />
      )}

      <main className="reader-content">
        {currentPage && (
          <div className={`page-slide ${slideClass}`} key={`${cursor.chapterIdx}-${cursor.pageIdx}`}>
            <PageView
              page={currentPage}
              bookId={bookId!}
              chapterIndex={chapter.chapter_index}
              characters={ncm.book_map.characters ?? []}
              devMode={devMode}
              chapterAnalysis={chapter}
            />
          </div>
        )}
      </main>

      <MusicPlayer
        bookId={bookId!}
        chapterIndex={music.chapterIndex}
        sceneIndex={music.sceneIndex}
        prevChapterIndex={prevMusic?.chapterIndex}
        prevSceneIndex={prevMusic?.sceneIndex}
      />

      <footer className="reader-footer">
        <button onClick={goPrev} disabled={cursor.isFirst}>
          &larr; Prev
        </button>
        <span className="scene-indicator">
          {currentPage && (
            <>
              {currentPage.scene.title}
              {currentPage.totalPagesInScene > 1 && (
                <> ({currentPage.pageInScene + 1}/{currentPage.totalPagesInScene})</>
              )}
              {' '}&middot; Ch {cursor.chapterIdx + 1}/{ncm.chapters?.length ?? 0}
            </>
          )}
        </span>
        <button onClick={goNext} disabled={cursor.isLast}>
          Next &rarr;
        </button>
      </footer>

      {devMode && currentScene && (
        <DevPanel
          scene={currentScene}
          chapter={chapter}
          bookId={bookId!}
          onClose={() => setDevMode(false)}
        />
      )}
    </div>
  );
}
