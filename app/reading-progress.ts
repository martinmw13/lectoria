// Last scene per book, so reopening a book picks up where the reader
// left off. Ids only: no book text, never a key.
export const PROGRESS_KEY = "lectoria.progress.v1";
export const PROGRESS_MAX = 50;

export interface BookProgress {
  sceneId: string;
  index: number; // scene position in the book, 0 = first
  total: number;
  at: number;
}

const ID = /^[A-Za-z0-9_-]{1,80}$/;

function isProgress(value: unknown): value is BookProgress {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.sceneId === "string" &&
    ID.test(p.sceneId) &&
    typeof p.index === "number" &&
    Number.isInteger(p.index) &&
    p.index >= 0 &&
    typeof p.total === "number" &&
    typeof p.at === "number" &&
    Number.isFinite(p.at)
  );
}

export function loadAllProgress(): Record<string, BookProgress> {
  const out: Record<string, BookProgress> = {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(PROGRESS_KEY) ?? "null");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return out;
    for (const [bookId, p] of Object.entries(parsed)) if (ID.test(bookId) && isProgress(p)) out[bookId] = p;
  } catch {
    // Bad JSON or blocked storage: no saved places.
  }
  return out;
}

export function saveProgress(bookId: string, progress: BookProgress): void {
  if (!ID.test(bookId) || !isProgress(progress)) return;
  const kept = Object.entries({ ...loadAllProgress(), [bookId]: progress })
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, PROGRESS_MAX);
  try {
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Private mode: the place is kept for this visit only.
  }
}

// Where "Continue reading" goes; null until the reader moved past the
// first scene.
export function continueHref(bookId: string, all: Record<string, BookProgress> = loadAllProgress()): string | null {
  const p = all[bookId];
  return p && p.index > 0 ? `/read/${bookId}/${p.sceneId}` : null;
}
