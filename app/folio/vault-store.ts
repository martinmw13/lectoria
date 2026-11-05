// Picture Vault: every picture drawn in a book, kept per book for the
// whole book, never per chapter or scene, and saved to localStorage so a
// reload keeps it. Dismissing a picture in the reader (the pane X, a
// figure's X) never removes an entry here; only the vault's own delete
// does. Only urls and captions are stored, never image data.
import type { InlineFigure } from "./use-pictures";

// A scene picture kept in the Picture Vault, with the scene it shows.
export interface VaultScene {
  id: string;
  sceneId: string;
  url: string;
  caption: string;
}

// An inline figure kept in the vault, with the scene it was drawn in.
export type VaultFigure = InlineFigure & { sceneId: string };

export interface BookVault {
  scenes: VaultScene[];
  figures: VaultFigure[];
}

export const EMPTY_VAULT: BookVault = { scenes: [], figures: [] };

export function vaultKey(bookId: string): string {
  return `lectoria:vault:${bookId}`;
}

const books = new Map<string, BookVault>();
const listeners = new Set<() => void>();

// localStorage is untrusted: keep only well-formed entries with a
// reloadable url (blob: and data: urls die with the page or are blobs).
const keepable = (url: unknown): url is string => typeof url === "string" && url !== "" && !/^(blob|data):/.test(url);
const isStr = (v: unknown): v is string => typeof v === "string";

function load(bookId: string): BookVault {
  try {
    const raw = JSON.parse(window.localStorage.getItem(vaultKey(bookId)) ?? "null") as Partial<BookVault> | null;
    const scenes = (Array.isArray(raw?.scenes) ? raw.scenes : []).filter(
      (s): s is VaultScene => keepable(s?.url) && isStr(s.id) && isStr(s.sceneId) && isStr(s.caption),
    );
    const figures = (Array.isArray(raw?.figures) ? raw.figures : [])
      .filter(
        (f): f is VaultFigure =>
          keepable(f?.url) &&
          isStr(f.id) &&
          isStr(f.sceneId) &&
          isStr(f.quote) &&
          Number.isFinite(f.startN) &&
          Number.isFinite(f.endN),
      )
      .map((f) => ({ ...f, phase: "ready" as const, message: null, credit: isStr(f.credit) ? f.credit : "" }));
    return { scenes, figures };
  } catch {
    return EMPTY_VAULT;
  }
}

/** The book's vault; the same object until it changes (useSyncExternalStore snapshot). */
export function bookVault(bookId: string): BookVault {
  let hit = books.get(bookId);
  if (!hit) {
    hit = typeof window === "undefined" ? EMPTY_VAULT : load(bookId);
    books.set(bookId, hit);
  }
  return hit;
}

function save(bookId: string, next: BookVault): BookVault {
  books.set(bookId, next);
  try {
    window.localStorage.setItem(
      vaultKey(bookId),
      JSON.stringify({ scenes: next.scenes.filter((s) => keepable(s.url)), figures: next.figures.filter((f) => keepable(f.url)) }),
    );
  } catch {
    // Storage full or blocked: the vault still holds for this page.
  }
  for (const fn of listeners) fn();
  return next;
}

export function subscribeVault(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Adds a finished scene picture. The same url twice (a repeat answer) is
// kept once; earlier entries are untouched.
export function keepScenePicture(bookId: string, sceneId: string, url: string, caption: string): BookVault {
  const prev = bookVault(bookId);
  if (prev.scenes.some((v) => v.url === url)) return prev;
  return save(bookId, { ...prev, scenes: [...prev.scenes, { id: `s:${url}`, sceneId, url, caption }] });
}

// Adds a finished inline figure. Removing the figure from the text (its
// X) never touches the vault.
export function keepFigurePicture(bookId: string, sceneId: string, fig: InlineFigure): BookVault {
  const prev = bookVault(bookId);
  if (fig.phase !== "ready" || fig.url === null || prev.figures.some((v) => v.id === fig.id || v.url === fig.url)) return prev;
  return save(bookId, { ...prev, figures: [...prev.figures, { ...fig, sceneId }] });
}

/** The vault's own delete: the only way a picture leaves the vault. */
export function deleteVaultPicture(bookId: string, url: string): BookVault {
  const prev = bookVault(bookId);
  return save(bookId, {
    scenes: prev.scenes.filter((s) => s.url !== url),
    figures: prev.figures.filter((f) => f.url !== url),
  });
}
