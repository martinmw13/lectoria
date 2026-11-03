// Highlights and notes: client only, one localStorage entry per book.
// A mark anchors on global paragraph ordinals plus character offsets in
// each paragraph's text, so it survives re-renders and re-opens.

export interface Mark {
  id: string;
  startN: number;
  startOff: number;
  endN: number;
  endOff: number;
  quote: string;
  note?: string;
}

const MAX_MARKS = 500;
const QUOTE_CHARS = 280;
const NOTE_CHARS = 1000;

export function marksKey(bookId: string): string {
  return `lectoria:marks:${bookId}`;
}

function isMark(m: unknown): m is Mark {
  if (!m || typeof m !== "object") return false;
  const v = m as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.quote === "string" &&
    [v.startN, v.startOff, v.endN, v.endOff].every((x) => Number.isInteger(x) && (x as number) >= 0) &&
    (v.note === undefined || typeof v.note === "string")
  );
}

export function loadMarks(bookId: string): Mark[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(marksKey(bookId)) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter(isMark).slice(0, MAX_MARKS) : [];
  } catch {
    return []; // Corrupt or blocked storage: start empty, never throw.
  }
}

export function saveMarks(bookId: string, marks: Mark[]) {
  try {
    window.localStorage.setItem(marksKey(bookId), JSON.stringify(marks.slice(0, MAX_MARKS)));
  } catch {
    // Full or blocked storage: marks stay for this visit only.
  }
}

export function clampNote(note: string): string {
  return note.trim().slice(0, NOTE_CHARS);
}

function paraOf(node: Node | null): HTMLElement | null {
  const el = node instanceof Element ? node : node?.parentElement ?? null;
  const p = el?.closest("p[data-n]");
  return p instanceof HTMLElement ? p : null;
}

// Character offset of a DOM point inside its paragraph's text.
function offsetIn(p: HTMLElement, node: Node, offset: number): number {
  const r = document.createRange();
  r.setStart(p, 0);
  r.setEnd(node, offset);
  return r.toString().length;
}

export function markFromRange(range: Range): Omit<Mark, "id"> | null {
  const sp = paraOf(range.startContainer);
  const ep = paraOf(range.endContainer);
  if (!sp || !ep) return null;
  const startN = Number(sp.dataset.n);
  const endN = Number(ep.dataset.n);
  const startOff = offsetIn(sp, range.startContainer, range.startOffset);
  const endOff = offsetIn(ep, range.endContainer, range.endOffset);
  if (startN > endN || (startN === endN && endOff <= startOff)) return null;
  // Paragraph text only: captions of figures between paragraphs stay out.
  const draft = { startN, startOff, endN, endOff, quote: "" };
  const quote = rangesFor({ ...draft, id: "" }, sp.ownerDocument)
    .map((r) => r.toString())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, QUOTE_CHARS);
  return quote ? { ...draft, quote } : null;
}

// DOM point for a character offset inside a paragraph's text nodes.
function pointAt(p: HTMLElement, off: number): [Node, number] {
  const walk = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  let left = off;
  let last: Node = p;
  for (let t = walk.nextNode(); t; t = walk.nextNode()) {
    const len = t.textContent?.length ?? 0;
    if (left <= len) return [t, left];
    left -= len;
    last = t;
  }
  return [last, last === p ? 0 : last.textContent?.length ?? 0];
}

// One range per paragraph, so figures between paragraphs stay unpainted.
export function rangesFor(mark: Mark, root: ParentNode): Range[] {
  const out: Range[] = [];
  for (let n = mark.startN; n <= mark.endN; n++) {
    const p = root.querySelector<HTMLElement>(`p[data-n="${n}"]`);
    if (!p) continue;
    const r = document.createRange();
    const from = n === mark.startN ? pointAt(p, mark.startOff) : pointAt(p, 0);
    const to = n === mark.endN ? pointAt(p, mark.endOff) : pointAt(p, p.textContent?.length ?? 0);
    r.setStart(from[0], from[1]);
    r.setEnd(to[0], to[1]);
    out.push(r);
  }
  return out;
}

function before(n1: number, o1: number, n2: number, o2: number): boolean {
  return n1 < n2 || (n1 === n2 && o1 < o2);
}

export function overlapping(marks: Mark[], m: Omit<Mark, "id">): Mark | undefined {
  return marks.find((x) => before(x.startN, x.startOff, m.endN, m.endOff) && before(m.startN, m.startOff, x.endN, x.endOff));
}
