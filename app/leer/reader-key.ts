// The reader's own Meta key per uploaded book, kept in module memory
// only: a reload loses it and pictures fall back to our key and quota.
const keys = new Map<string, string>();

export function setReaderKey(bookId: string, key: string): void {
  keys.set(bookId, key);
}

export function getReaderKey(bookId: string): string | null {
  return keys.get(bookId) ?? null;
}
