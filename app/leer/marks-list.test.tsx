/**
 * @vitest-environment jsdom
 */
import { expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MarksList } from "./marks-list";

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const mark = (id: string, note?: string) => ({ id, startN: 1, startOff: 0, endN: 1, endOff: 4, quote: `q${id}`, note });

it("sums marks in the row and opens into one card each", () => {
  const el = document.createElement("div");
  const root = createRoot(el);
  act(() => root.render(<MarksList marks={[mark("a"), mark("b", "n")]} onGo={() => {}} onRemove={() => {}} />));
  const row = el.querySelector<HTMLButtonElement>(".marks-row")!;
  expect(row.textContent).toContain("1 highlight · 1 note");
  act(() => row.click());
  expect(el.querySelectorAll(".marks-card")).toHaveLength(2);
  act(() => root.unmount());
});

it("stays closed with a hint when the book has no marks", () => {
  const el = document.createElement("div");
  const root = createRoot(el);
  act(() => root.render(<MarksList marks={[]} onGo={() => {}} onRemove={() => {}} />));
  expect(el.querySelector<HTMLButtonElement>(".marks-row")!.disabled).toBe(true);
  expect(el.textContent).toContain("Select a line to keep it here");
  act(() => root.unmount());
});
