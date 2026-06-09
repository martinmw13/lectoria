import { useCallback, useMemo, useState } from 'react';
import type { ChaptersData, NCM } from '../api/types';
import { ReaderCursor, type Position } from '../reader/cursor';

export interface UseReaderCursor {
  /** Live cursor for the current position, or null until ncm+chaptersData have loaded. */
  cursor: ReaderCursor | null;
  /** Persist a cursor produced by cursor.next()/prev()/goToChapter() as the new position. */
  commit: (next: ReaderCursor) => void;
}

/**
 * Thin React bridge to the framework-free ReaderCursor (cf. useCrossfadeAudio / ADR-0002).
 * Holds only `position`; derives the cursor from the (already-loaded) ncm + chaptersData via
 * useMemo. No effects — so it is StrictMode-trivial. The ~280 ms slide animation lives in
 * ReaderPage, which calls commit() from the animation's completion callback.
 */
export function useReaderCursor(
  ncm: NCM | null,
  chaptersData: ChaptersData | null,
): UseReaderCursor {
  const [position, setPosition] = useState<Position>({ chapterIdx: 0, pageIdx: 0 });

  const cursor = useMemo(
    () => (ncm && chaptersData ? new ReaderCursor(ncm, chaptersData, position) : null),
    [ncm, chaptersData, position],
  );

  const commit = useCallback((next: ReaderCursor) => setPosition(next.position), []);

  return { cursor, commit };
}
