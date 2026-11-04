// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { READING_KEY } from "../reading-prefs";
import { keepPlace, ReadingControl } from "./reading-control";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-justify");
  document.body.innerHTML = "";
});

async function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  await act(async () => createRoot(host).render(<ReadingControl />));
  const button = host.querySelector<HTMLButtonElement>(".reading-btn")!;
  await act(async () => button.click());
  return host;
}

test("changes size, spacing and justify, saves them and sets them on <html>", async () => {
  const host = await mount();
  const radios = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  expect(radios).toHaveLength(7);
  await act(async () => radios[3]!.click());
  await act(async () => radios[6]!.click());
  await act(async () => host.querySelector<HTMLInputElement>(".reading-toggle input")!.click());
  expect(radios[3]!.getAttribute("aria-checked")).toBe("true");
  // The default skin (engraving) is justified, so the first toggle turns it off.
  expect(JSON.parse(localStorage.getItem(READING_KEY)!)).toEqual({
    size: 3,
    spacing: 2,
    justify: false,
  });
  expect(document.documentElement.style.getPropertyValue("--read-scale")).toBe("1.25");
  expect(document.documentElement.getAttribute("data-justify")).toBe("off");
  await act(async () => host.querySelector<HTMLInputElement>(".reading-toggle input")!.click());
  expect(document.documentElement.getAttribute("data-justify")).toBe("on");
});

test("closes on Escape", async () => {
  const host = await mount();
  expect(host.querySelector(".reading-pop")).not.toBeNull();
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(host.querySelector(".reading-pop")).toBeNull();
});

test("keeps the paragraph at the top of the column in place across a reflow", () => {
  const col = document.createElement("div");
  const p = document.createElement("p");
  p.dataset.n = "1";
  col.append(p);
  let height = 100;
  let pTop = -50; // half of the paragraph is above the column top
  col.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  p.getBoundingClientRect = () => ({ top: pTop, bottom: pTop + height, height }) as DOMRect;
  col.scrollTop = 500;
  keepPlace(col, () => {
    height = 200;
    pTop = 40;
  });
  // half of 200 = 100 above the top: shift by 40 + 100.
  expect(col.scrollTop).toBe(640);
});
