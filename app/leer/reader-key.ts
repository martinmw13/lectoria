// The reader's own Meta key, kept in module memory only: never in
// localStorage, cookies, URLs, or logs; a reload loses it and pictures
// and chat fall back to our key and the daily free quota. An upload
// finished with a key keeps it per book; a key typed in the reader (chat
// or a picture's quota note) serves every book for this tab.
const keys = new Map<string, string>();
let sessionKey: string | null = null;
const listeners = new Set<() => void>();

export function setReaderKey(bookId: string, key: string): void {
  keys.set(bookId, key);
}

/** Sets or clears the tab-wide key (memory only). */
export function setSessionKey(key: string | null): void {
  const next = key?.trim() || null;
  if (next === sessionKey) return;
  sessionKey = next;
  for (const notify of [...listeners]) notify();
}

export function subscribeReaderKey(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

export function getReaderKey(bookId: string): string | null {
  return keys.get(bookId) ?? sessionKey;
}
