// @vitest-environment jsdom
// Selection menu: highlight and note persist per book and repaint on
// re-open, Explain hands the quote to the chat, a single word gets its
// definition from our own proxy (fetch mocked), and Picture this stays.
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CHAT_QUOTE_EVENT, type QuoteDetail } from "../chat/chat-bridge";
import { loadMarks, marksKey, markFromRange, rangesFor, saveMarks } from "./marks";
import { NoteEditor, SelectionMenu, type NoteTarget } from "./selection-menu";
import { useMarks } from "./use-marks";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement;
const picked = vi.fn();
const closed = vi.fn();

function Harness({ show }: { show: boolean }) {
  const colRef = useRef<HTMLElement | null>(null);
  const popRef = useRef<HTMLElement | null>(null);
  const marks = useMarks("oz", colRef);
  const [note, setNote] = useState<NoteTarget | null>(null);
  return (
    <main ref={colRef}>
      <p id="c1p1" data-n="1">The cyclone spun over the gray prairie.</p>
      <p id="c1p2" data-n="2">Dorothy held Toto close.</p>
      {show ? <SelectionMenu pos={{ top: 10, left: 300 }} popRef={popRef} marks={marks} showPicture onPicture={picked} onNote={setNote} onClose={closed} /> : null}
      {note ? <NoteEditor target={note} marks={marks} onClose={() => setNote(null)} /> : null}
      <output>{marks.marks.length}</output>
    </main>
  );
}

function select(p: number, from: number, to: number) {
  const node = host.querySelectorAll("p")[p]!.firstChild!;
  const range = document.createRange();
  range.setStart(node, from);
  range.setEnd(node, to);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

// The menu snapshots the live selection when it opens, as in the reader.
function mount(p: number, from: number, to: number) {
  act(() => {
    root = createRoot(host);
    root.render(<Harness show={false} />);
  });
  select(p, from, to);
  act(() => root!.render(<Harness show />));
}

function button(label: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll<HTMLButtonElement>(".sel-bar button, .note-editor button")].find(
    (b) => b.textContent === label,
  );
  if (!found) throw new Error(`no ${label}`);
  return found;
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  picked.mockReset();
  closed.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
});

test("marks anchor on paragraph ordinals and offsets and round-trip", () => {
  host.innerHTML = '<p data-n="1">The cyclone spun.</p><figure>art</figure><p data-n="2">Toto barked.</p>';
  const range = document.createRange();
  range.setStart(host.querySelectorAll("p")[0]!.firstChild!, 4);
  range.setEnd(host.querySelectorAll("p")[1]!.firstChild!, 4);
  const draft = markFromRange(range)!;
  expect(draft).toEqual({ startN: 1, startOff: 4, endN: 2, endOff: 4, quote: "cyclone spun. Toto" });
  const parts = rangesFor({ ...draft, id: "a" }, host).map((r) => r.toString());
  expect(parts).toEqual(["cyclone spun.", "Toto"]);
  window.localStorage.setItem(marksKey("oz"), "{not json");
  expect(loadMarks("oz")).toEqual([]);
  saveMarks("oz", [{ ...draft, id: "a" }, { id: 5 } as never]);
  expect(loadMarks("oz")).toHaveLength(1);
});

test("the menu offers every action and Highlight persists and removes", () => {
  mount(0, 4, 11);
  const labels = [...document.body.querySelectorAll(".sel-bar button")].map((b) => b.textContent);
  expect(labels).toEqual(["Highlight", "Add note", "Explain", "Ask", "Picture this"]);
  expect(document.body.querySelector('[role="toolbar"]')).not.toBeNull();
  click(button("Highlight"));
  expect(closed).toHaveBeenCalled();
  expect(loadMarks("oz")).toMatchObject([{ startN: 1, startOff: 4, endOff: 11, quote: "cyclone" }]);
  // Re-open: the mark loads back, and the same selection offers removal.
  act(() => root?.unmount());
  mount(0, 4, 11);
  expect(host.querySelector("output")?.textContent).toBe("1");
  click(button("Remove highlight"));
  expect(loadMarks("oz")).toEqual([]);
});

test("Add note saves the note with the passage", () => {
  mount(1, 0, 7);
  click(button("Add note"));
  const ta = document.body.querySelector(".note-editor textarea") as HTMLTextAreaElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(ta, "  Brave girl  ");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
  click(button("Save"));
  expect(loadMarks("oz")).toMatchObject([{ startN: 2, quote: "Dorothy", note: "Brave girl" }]);
});

test("Explain sends the quote to the chat and Picture this still picks", () => {
  const seen: QuoteDetail[] = [];
  const on = (e: Event) => seen.push((e as CustomEvent<QuoteDetail>).detail);
  window.addEventListener(CHAT_QUOTE_EVENT, on);
  mount(0, 0, 11);
  click(button("Picture this"));
  expect(picked).toHaveBeenCalledTimes(1);
  click(button("Explain"));
  window.removeEventListener(CHAT_QUOTE_EVENT, on);
  expect(seen).toEqual([{ intent: "explain", text: "Explain this passage in plain words: “The cyclone”" }]);
});

test("a single word shows its definition from the proxy, or a kind miss", async () => {
  const fetchSpy = vi.fn(async (url: string) =>
    url.endsWith("cyclone")
      ? Response.json({ word: "cyclone", senses: [{ pos: "noun", defs: [{ text: "A rotating storm." }] }] })
      : Response.json({ code: "not_found" }, { status: 404 }),
  );
  vi.stubGlobal("fetch", fetchSpy);
  mount(0, 4, 11);
  await act(async () => new Promise((r) => setTimeout(r, 10)));
  expect(fetchSpy.mock.calls[0]?.[0]).toBe("/api/define?word=cyclone");
  expect(document.body.querySelector(".define-card")?.textContent).toContain("A rotating storm.");
  act(() => root?.unmount());
  mount(1, 0, 7);
  await act(async () => new Promise((r) => setTimeout(r, 10)));
  expect(document.body.querySelector(".define-card")?.textContent).toBe("No definition found for “dorothy”.");
  act(() => root?.unmount());
  mount(0, 0, 11);
  expect(document.body.querySelector(".define-card")).toBeNull();
});
