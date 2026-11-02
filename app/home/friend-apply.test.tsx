// @vitest-environment jsdom
// Friend-code Apply: click and Enter each check once, ok shows the exact
// welcome right away, a miss shows a warm note, and Enter never reaches
// the file picker or submits anything.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { FRIEND_WELCOME } from "./friend-code";
import { UploadSection } from "./upload";

const { pushMock, epubMock } = vi.hoisted(() => ({ pushMock: vi.fn(), epubMock: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock("@/core/epub", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/epub")>();
  return {
    ...actual,
    readEpubFileWithSections: (...args: unknown[]) =>
      (epubMock as (...inner: unknown[]) => unknown)(...args),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;
const fetchMock = vi.fn();
const CODE = "maple-42-qx";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function typeInto(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function quietButton(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button.ob-quiet")].find((el) =>
    el.textContent?.includes(label),
  );
  if (!found || !(found instanceof HTMLButtonElement)) throw new Error(`quiet missing: ${label}`);
  return found;
}

function friendInput(): HTMLInputElement {
  click(quietButton("Have a friend code?"));
  const el = container.querySelector("#obFriend");
  if (!(el instanceof HTMLInputElement)) throw new Error("friend code input missing");
  return el;
}

async function settle(rounds = 25) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  fetchMock.mockReset();
  pushMock.mockClear();
  epubMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
  act(() => {
    root?.render(<UploadSection />);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => {
    root?.unmount();
  });
  root = null;
  container.remove();
});

describe("friend-code apply", () => {
  test("Apply checks once and shows the exact welcome on ok", async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));
    const input = friendInput();
    typeInto(input, CODE);
    const apply = quietButton("Apply");
    expect(apply.disabled).toBe(false);
    click(apply);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/uploads/friend-code");
    expect(JSON.parse(init.body as string)).toEqual({ code: CODE });
    const note = container.querySelector(".ob-friend-ok");
    expect(note?.getAttribute("role")).toBe("status");
    expect(note?.textContent).toBe(FRIEND_WELCOME);
    // Editing after the result clears it.
    typeInto(input, `${CODE}!`);
    await settle();
    expect(container.querySelector(".ob-friend-ok")).toBeNull();
  });

  test("Enter applies once without opening the file picker or submitting", async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));
    const input = friendInput();
    typeInto(input, CODE);
    const file = container.querySelector('input[type="file"]');
    if (!(file instanceof HTMLInputElement)) throw new Error("file input missing");
    const clickSpy = vi.spyOn(file, "click");
    const submitSpy = vi.fn();
    container.addEventListener("submit", submitSpy);
    let dispatched = true;
    act(() => {
      dispatched =
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    await settle();
    expect(dispatched).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({ code: CODE });
    expect(clickSpy).not.toHaveBeenCalled();
    expect(submitSpy).not.toHaveBeenCalled();
    expect(container.querySelector(".ob-friend-ok")?.textContent).toBe(FRIEND_WELCOME);
  });

  test("a miss shows a warm note and keeps no welcome", async () => {
    fetchMock.mockResolvedValue(json({ ok: false }));
    const input = friendInput();
    typeInto(input, CODE);
    click(quietButton("Apply"));
    await settle();
    const miss = [...container.querySelectorAll('[role="status"]')].find((el) =>
      el.textContent?.includes("That code didn't work."),
    );
    expect(miss).toBeTruthy();
    expect(container.querySelector(".ob-friend-ok")).toBeNull();
    // A network error reads the same as a miss.
    fetchMock.mockRejectedValue(new Error("down"));
    typeInto(input, `${CODE}!`);
    click(quietButton("Apply"));
    await settle();
    expect(container.querySelector(".ob-friend-ok")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("empty code keeps Apply disabled", () => {
    friendInput();
    expect(quietButton("Apply").disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
