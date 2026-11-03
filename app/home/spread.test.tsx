// @vitest-environment jsdom
// Shelf links: every ready book's plate reads /read/<id>, and books
// still off the shelf show the coming-soon plate instead. Driven by
// the shelf data, so enabling a book needs no test change.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { shelf } from "./shelf";
import { HomeSpread } from "./spread";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function shelfButton(id: string): HTMLButtonElement {
  const el = container.querySelector(`.lb-item[data-book="${id}"]`);
  if (!(el instanceof HTMLButtonElement)) throw new Error(`shelf button missing: ${id}`);
  return el;
}

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    // jsdom without storage: the shelf tolerates it.
  }
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
  act(() => {
    root?.render(<HomeSpread />);
  });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container.remove();
});

describe("shelf links", () => {
  test("each ready book starts reading at /read/<id>", () => {
    const ready = shelf.filter((book) => book.ready);
    expect(ready.length).toBeGreaterThan(0);
    for (const book of ready) {
      click(shelfButton(book.id));
      const link = container.querySelector("a.ob-read");
      expect(link?.getAttribute("href")).toBe(`/read/${book.id}`);
    }
  });

  test("every book on the shelf opens its own reader", () => {
    expect(shelf.every((book) => book.ready)).toBe(true);
    for (const book of shelf) {
      click(shelfButton(book.id));
      expect(container.querySelector(".ob-cta-soon")).toBeNull();
      expect(container.querySelector("a.ob-read")?.getAttribute("href")).toBe(`/read/${book.id}`);
    }
  });

  test("a known first scene skips the /read/<id> redirect", () => {
    act(() => {
      root?.render(<HomeSpread readHrefs={{ oz: "/read/oz/c1s1" }} />);
    });
    click(shelfButton("oz"));
    expect(container.querySelector("a.ob-read")?.getAttribute("href")).toBe("/read/oz/c1s1");
    const other = shelf.find((book) => book.id !== "oz")!;
    click(shelfButton(other.id));
    expect(container.querySelector("a.ob-read")?.getAttribute("href")).toBe(`/read/${other.id}`);
  });

  test("the shelf shows small covers and the plate keeps the full one", () => {
    const shelfImg = shelfButton("alice")?.querySelector("img");
    expect(shelfImg?.getAttribute("src")).toMatch(/^\/covers\/v1\/[a-z]+\/sm\/alice\.webp$/);
    const plate = container.querySelector("img.ob-art");
    expect(plate?.getAttribute("src")).toMatch(/^\/covers\/v1\/[a-z]+\/oz\.webp$/);
  });
});

describe("your books", () => {
  const UPLOAD_ID = "u-AAAAAAAAAAAAAAAAAAAAAA";

  function seed() {
    window.localStorage.setItem(
      "lectoria.myBooks.v1",
      JSON.stringify([
        { id: UPLOAD_ID, title: "Middlemarch", author: "George Eliot", savedAt: 1 },
        { id: "u-BBBBBBBBBBBBBBBBBBBBBB", title: "Emma", author: "Jane Austen", savedAt: 2 },
      ]),
    );
  }

  function rerender() {
    act(() => {
      root?.unmount();
      root = createRoot(container);
    });
    act(() => {
      root?.render(<HomeSpread />);
    });
  }

  test("shows nothing without stored books", () => {
    expect(container.querySelector('[aria-label="Your books"]')).toBeNull();
  });

  test("bad JSON shows nothing", () => {
    window.localStorage.setItem("lectoria.myBooks.v1", "{oops");
    rerender();
    expect(container.querySelector('[aria-label="Your books"]')).toBeNull();
  });

  test("links each book to its reader and forgets on x", () => {
    seed();
    rerender();
    const section = container.querySelector('[aria-label="Your books"]');
    expect(section?.querySelector("h2")?.textContent).toBe("Your books");
    const links = [...section!.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      `/read/${UPLOAD_ID}`,
      "/read/u-BBBBBBBBBBBBBBBBBBBBBB",
    ]);
    const forget = [...section!.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Forget Middlemarch",
    );
    if (!forget) throw new Error("forget button missing");
    click(forget);
    expect(JSON.parse(window.localStorage.getItem("lectoria.myBooks.v1") ?? "[]")).toEqual([
      { id: "u-BBBBBBBBBBBBBBBBBBBBBB", title: "Emma", author: "Jane Austen", savedAt: 2 },
    ]);
    expect(container.querySelector('[aria-label="Your books"]')?.textContent).not.toContain("Middlemarch");
  });
});
