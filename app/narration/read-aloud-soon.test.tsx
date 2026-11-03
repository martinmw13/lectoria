// @vitest-environment jsdom
// Books without narration keep Read aloud in place: greyed out,
// aria-disabled, with its voice picker and volume disabled beside it,
// and a "not available" note that a click also opens.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { ReadAloudSoon } from "./read-aloud-soon";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function render(): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<ReadAloudSoon />));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

test("stays visible as a disabled Read aloud button", () => {
  const host = render();
  const btn = host.querySelector("button")!;
  expect(btn.textContent).toBe("Read aloud");
  expect(btn.getAttribute("aria-disabled")).toBe("true");
  // Focusable on purpose, so keyboard users can reach the note.
  expect(btn.hasAttribute("disabled")).toBe(false);
});

test("keeps the voice picker and narration volume, disabled", () => {
  const host = render();
  const select = host.querySelector("select")!;
  const range = host.querySelector('input[type="range"]') as HTMLInputElement;
  expect(select.disabled).toBe(true);
  expect(select.getAttribute("aria-label")).toBe("Narration voice");
  expect(range.disabled).toBe(true);
  expect(range.getAttribute("aria-label")).toBe("Narration volume");
  const tipId = host.querySelector('[role="tooltip"]')!.id;
  expect(select.getAttribute("aria-describedby")).toBe(tipId);
  expect(range.getAttribute("aria-describedby")).toBe(tipId);
});

test("explains that read aloud is not available", () => {
  const host = render();
  const btn = host.querySelector("button")!;
  const tip = host.querySelector('[role="tooltip"]')!;
  expect(tip.textContent).toBe("Read aloud not available for this book");
  expect(btn.getAttribute("aria-describedby")).toBe(tip.id);
});

test("a click opens the note and Escape or blur closes it", () => {
  const host = render();
  const wrap = host.querySelector(".read-aloud-soon")!;
  const btn = host.querySelector("button")!;
  act(() => btn.click());
  expect(wrap.getAttribute("data-open")).toBe("1");
  act(() => {
    btn.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(wrap.hasAttribute("data-open")).toBe(false);
  act(() => btn.click());
  act(() => btn.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  expect(wrap.hasAttribute("data-open")).toBe(false);
});

test("never plays audio", () => {
  const host = render();
  act(() => host.querySelector("button")!.click());
  expect(host.querySelector("audio")).toBeNull();
});
