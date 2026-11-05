// @vitest-environment jsdom
// Two or more kept pictures fold into a fanned stack (up to FAN_MAX cards,
// +N for the rest); clicking it opens the vault window: a grid of every
// picture, one pick shows it large, and delete lives only in there.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { FAN_MAX, PictureVault } from "./vault";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const scene = (n: number) => ({ id: `s${n}`, sceneId: `c${n}s1`, url: `/p${n}.png`, caption: `Picture ${n}` });

function mount(count: number, onDelete = () => {}) {
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() =>
    root.render(
      <PictureVault
        scenes={Array.from({ length: count }, (_, i) => scene(i + 1))}
        figures={[]}
        onGotoScene={() => {}}
        onGotoFigure={() => {}}
        onOpen={() => {}}
        onDelete={onDelete}
        pref={{ kind: "preset", id: "denslow" }}
        onPrefChange={() => {}}
      />,
    ),
  );
  document.body.appendChild(host);
  return { host, root };
}

test("one picture shows as a card, with no fan", () => {
  const { host, root } = mount(1);
  expect(host.querySelector(".vault-fan")).toBeNull();
  expect(host.querySelectorAll(".vault-item")).toHaveLength(1);
  act(() => root.unmount());
});

test("several pictures fan out, newest on top, with a +N badge past the cap", () => {
  const { host, root } = mount(FAN_MAX + 2);
  const fan = host.querySelector<HTMLButtonElement>(".vault-fan")!;
  expect(fan.getAttribute("aria-label")).toBe("Open the Picture Vault: 7 pictures");
  const cards = [...fan.querySelectorAll("img")].map((i) => i.getAttribute("src"));
  expect(cards).toEqual(["/p3.png", "/p4.png", "/p5.png", "/p6.png", "/p7.png"]);
  expect(fan.querySelector(".vault-fan-more")?.textContent).toBe("+2");
  expect(host.querySelector(".vault-item")).toBeNull();
  act(() => root.unmount());
  host.remove();
});

test("the fan opens a window with every picture; a pick shows it large and only there can it be deleted", () => {
  const onDelete = vi.fn();
  const { host, root } = mount(FAN_MAX + 2, onDelete);
  expect(host.querySelector("#vault-window")).toBeNull();
  act(() => host.querySelector<HTMLButtonElement>(".vault-fan")!.click());
  const win = host.querySelector("#vault-window")!;
  expect(win.getAttribute("role")).toBe("dialog");
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Close Picture Vault");
  const grid = [...win.querySelectorAll<HTMLButtonElement>(".vault-grid-btn")];
  expect(grid.map((b) => b.querySelector("img")!.getAttribute("src"))).toHaveLength(7);
  expect(win.querySelector(".vault-act-del")).toBeNull();
  act(() => grid[1]!.click());
  expect(win.querySelector<HTMLImageElement>(".vault-big-img")!.getAttribute("src")).toBe("/p2.png");
  // Esc steps back to the grid first, then closes the window.
  act(() => win.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(win.querySelector(".vault-big")).toBeNull();
  act(() => win.querySelectorAll<HTMLButtonElement>(".vault-grid-btn")[2]!.click());
  act(() => win.querySelector<HTMLButtonElement>(".vault-act-del")!.click());
  expect(onDelete).toHaveBeenCalledWith("/p3.png");
  act(() => win.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(host.querySelector("#vault-window")).toBeNull();
  expect(document.activeElement).toBe(host.querySelector(".vault-fan"));
  act(() => root.unmount());
  host.remove();
});
