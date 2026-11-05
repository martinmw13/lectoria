/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { STYLE_PRESETS, type ImageStylePref } from "../image-style";
import { StylePicker } from "./vault";

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;
let onChange: ReturnType<typeof vi.fn<(p: ImageStylePref) => void>>;

const button = () => container.querySelector<HTMLButtonElement>('[role="combobox"]')!;
const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')];
function key(k: string) {
  act(() => {
    button().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  onChange = vi.fn<(p: ImageStylePref) => void>();
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
    root.render(<StylePicker pref={{ kind: "preset", id: STYLE_PRESETS[0]!.id }} onChange={onChange} />);
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
});

describe("margin picture-style picker", () => {
  it("is a labelled combobox with no native select", () => {
    expect(container.querySelector("select")).toBeNull();
    expect(button().getAttribute("aria-labelledby")).toContain("style-select-label");
    expect(button().textContent).toContain(STYLE_PRESETS[0]!.label);
  });

  it("lists every preset plus Other and picks one with the keyboard", () => {
    key("ArrowDown");
    expect(options().map((o) => o.textContent)).toEqual([...STYLE_PRESETS.map((p) => p.label), "Other…"]);
    key("ArrowDown");
    key("Enter");
    expect(onChange).toHaveBeenCalledWith({ kind: "preset", id: STYLE_PRESETS[1]!.id });
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it("Other… opens the custom style field without changing the pref", () => {
    act(() => button().click());
    act(() => options().at(-1)!.click());
    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector('input[aria-label="Custom drawing style"]')).not.toBeNull();
    key("Escape");
    expect(container.querySelector('input[aria-label="Custom drawing style"]')).toBeNull();
  });

  it("closes on an outside pointerdown", () => {
    act(() => button().click());
    act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });
});
