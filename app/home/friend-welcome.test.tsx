// @vitest-environment jsdom
// Friend welcome: the exact note appears only after the server confirms
// the code (working view and failed retry), never on a wrong code, and
// the code itself never leaks into rendered text or storage.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { UPLOAD_MESSAGES } from "@/core/uploads";
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
const UPLOAD_ID = "u-AAAAAAAAAAAAAAAAAAAAAA";
const CODE = "zrbl-42-qx";
const FAKE_PARSE = {
  book: { title: "Middlemarch", author: "George Eliot", chapters: ["One"], words: 1000, cover: null },
  sections: [
    {
      id: "s1",
      href: "s1.xhtml",
      linear: true,
      types: [],
      docTitle: null,
      navLabel: null,
      blocks: [{ text: "Once upon a time.", heading: false }],
    },
  ],
};

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

function actionButton(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button.ob-action")].find((el) =>
    el.textContent?.includes(label),
  );
  if (!found || !(found instanceof HTMLButtonElement)) throw new Error(`action missing: ${label}`);
  return found;
}

async function chooseFile() {
  const input = container.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("file input missing");
  const file = new File(["epub-bytes"], "middlemarch.epub", { type: "application/epub+zip" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function settle(rounds = 25) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function enterFriendCode() {
  await chooseFile();
  click(quietButton("Have a friend code?"));
  const input = container.querySelector("#obFriend");
  if (!(input instanceof HTMLInputElement)) throw new Error("friend code input missing");
  typeInto(input, CODE);
}

function leaked(): string {
  // textContent skips input values, so any hit here is rendered or stored text.
  let out = container.textContent ?? "";
  try {
    out += window.localStorage.getItem("lectoria.myBooks.v1") ?? "";
  } catch {
    // No storage in this runner: nothing could have been stored.
  }
  return out;
}

beforeEach(() => {
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    // jsdom without storage: the components tolerate it.
  }
  fetchMock.mockReset();
  pushMock.mockClear();
  epubMock.mockReset();
  epubMock.mockResolvedValue(FAKE_PARSE);
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

describe("friend welcome", () => {
  test("an accepted code shows the exact note while working", async () => {
    let release!: (res: Response) => void;
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/uploads"
        ? json({ status: "created", id: UPLOAD_ID, chapters: 1, parts: 1, friendAccepted: true })
        : gate,
    );
    await enterFriendCode();
    click(actionButton("Read with soundtrack"));
    await settle();
    const note = container.querySelector(".ob-friend-ok");
    expect(note?.getAttribute("role")).toBe("status");
    expect(note?.textContent).toBe(FRIEND_WELCOME);
    expect(FRIEND_WELCOME).toBe(
      "Hola, escofletudo, te estaba esperando. Mirá cómo te gusta gastarme los créditos. No pinta, amigo. Literalmente una escofleta.",
    );
    expect(leaked()).not.toContain(CODE);
    release(json({ status: "done", id: UPLOAD_ID, done: 1, total: 1 }));
    await settle();
    expect(pushMock).toHaveBeenCalledWith(`/read/${UPLOAD_ID}`);
  });

  test("a wrong code shows no note and leaks nothing", async () => {
    let release!: (res: Response) => void;
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/uploads"
        ? json({ status: "created", id: UPLOAD_ID, chapters: 1, parts: 1, friendAccepted: false })
        : gate,
    );
    await enterFriendCode();
    click(actionButton("Read with soundtrack"));
    await settle();
    expect(container.querySelector(".ob-friend-ok")).toBeNull();
    expect(container.textContent).not.toContain(FRIEND_WELCOME);
    expect(leaked()).not.toContain(CODE);
    release(json({ status: "done", id: UPLOAD_ID, done: 1, total: 1 }));
    await settle();
  });

  test("an accepted code keeps the note next to the friend field after a failure", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/uploads"
        ? json({ status: "created", id: UPLOAD_ID, chapters: 1, parts: 1, friendAccepted: true })
        : json(
            { status: "error", code: "too_long", message: UPLOAD_MESSAGES.too_long },
            413,
          ),
    );
    await enterFriendCode();
    click(actionButton("Read with soundtrack"));
    await settle();
    click(quietButton("Have a friend code?"));
    expect(container.querySelector("#obFriend")).not.toBeNull();
    expect(container.querySelector(".ob-friend-ok")?.textContent).toBe(FRIEND_WELCOME);
    expect(leaked()).not.toContain(CODE);
  });
});
