// UI hint only; the server enforces the real 1/day quota. Counts how
// many free books started today (UTC), so the route matches the server.
const KEY = "lectoria.freeBooks.v2";

export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function getFreeBooksToday(now: Date = new Date()): number {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { day?: unknown; count?: unknown };
    if (parsed.day !== utcDay(now)) return 0;
    if (typeof parsed.count !== "number" || !Number.isInteger(parsed.count) || parsed.count < 0) {
      return 0;
    }
    return parsed.count;
  } catch {
    return 0; // Bad JSON or blocked storage: route as if none used.
  }
}

export function countFreeBookToday(now: Date = new Date()): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ day: utcDay(now), count: getFreeBooksToday(now) + 1 }));
  } catch {
    // Private mode or blocked storage: the hint just does not stick.
  }
}
