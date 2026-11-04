/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChapterMenu, typeAheadMatch } from "./chapter-menu";

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const chapters = [
  { ch: 1, title: "The Cyclone" },
  { ch: 2, title: "The Council with the Munchkins" },
  { ch: 3, title: "How Dorothy Saved the Scarecrow" },
  { ch: 12, title: "The Search for the Wicked Witch" },
];

let container: HTMLDivElement;
let root: Root | null = null;
let onJump: ReturnType<typeof vi.fn<(ch: number) => void>>;

function render(ch = 2) {
  act(() => {
    root?.render(<ChapterMenu ch={ch} chaptersTotal={4} chapters={chapters} onJumpChapter={onJump} />);
  });
}

const button = () => container.querySelector<HTMLButtonElement>('[role="combobox"]')!;
const list = () => document.querySelector('[role="listbox"]');
const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')];
function key(k: string) {
  act(() => {
    button().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  onJump = vi.fn<(ch: number) => void>();
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
  render();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
});

describe("ChapterMenu", () => {
  it("is a collapsed combobox with no native select", () => {
    expect(container.querySelector("select")).toBeNull();
    expect(button().getAttribute("aria-haspopup")).toBe("listbox");
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(button().textContent).toContain("Chapter 2 of 4");
    expect(list()).toBeNull();
  });

  it("opens on click with the current chapter selected, active and scrolled into view", () => {
    act(() => button().click());
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(button().getAttribute("aria-controls")).toBe(list()?.id);
    const current = options().find((o) => o.getAttribute("aria-selected") === "true");
    expect(current?.dataset.ch).toBe("2");
    expect(button().getAttribute("aria-activedescendant")).toBe(current?.id);
    expect(current?.scrollIntoView).toHaveBeenCalled();
  });

  it("moves with arrows/Home/End and jumps with Enter", () => {
    key("ArrowDown");
    expect(list()).not.toBeNull();
    key("ArrowDown");
    key("ArrowDown");
    key("ArrowDown"); // clamps at the end
    expect(document.getElementById(button().getAttribute("aria-activedescendant")!)?.dataset.ch).toBe("12");
    key("Home");
    key("Enter");
    expect(onJump).toHaveBeenCalledWith(1);
    expect(list()).toBeNull();
    expect(document.activeElement).toBe(button());
  });

  it("type-ahead by number or title", () => {
    key("ArrowDown");
    key("1");
    key("2");
    expect(document.getElementById(button().getAttribute("aria-activedescendant")!)?.dataset.ch).toBe("12");
    expect(typeAheadMatch(chapters, "how", 0)).toBe(2);
    expect(typeAheadMatch(chapters, "the", 0)).toBe(1);
    expect(typeAheadMatch(chapters, "zzz", 0)).toBe(-1);
  });

  it("Escape and outside clicks close without jumping", () => {
    key("ArrowDown");
    key("Escape");
    expect(list()).toBeNull();
    expect(document.activeElement).toBe(button());
    act(() => button().click());
    act(() => {
      document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    expect(list()).toBeNull();
    expect(onJump).not.toHaveBeenCalled();
  });

  it("clicking an option jumps to that chapter", () => {
    act(() => button().click());
    act(() => options()[3]!.click());
    expect(onJump).toHaveBeenCalledWith(12);
    expect(list()).toBeNull();
  });
});
