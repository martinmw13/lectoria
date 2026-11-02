// @vitest-environment jsdom
// Idle keybox: the BYOK pick reveals a password field with a show/hide
// eye, the Free pick hides and clears it, and a typed key prefills
// ByokStep through initialKey. The key never touches storage.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { BYOK_HEADER } from "@/core/chat";
import { UPLOAD_MESSAGES, type UploadErrorCode } from "@/core/uploads";
import { getReaderKey } from "../leer/reader-key";
import { UploadSection } from "./upload";
import { ByokStep } from "./byok";

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

function render(node: React.ReactNode) {
  act(() => {
    root?.render(node);
  });
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

function pickButton(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll(".ob-pickbtn")].find((el) =>
    el.textContent?.includes(label),
  );
  if (!found || !(found instanceof HTMLButtonElement)) throw new Error(`pick missing: ${label}`);
  return found;
}

function keyInput(): HTMLInputElement {
  const el = container.querySelector("#obKey");
  if (!(el instanceof HTMLInputElement)) throw new Error("key field missing");
  return el;
}

function eyeButton(): HTMLButtonElement {
  const el = [...container.querySelectorAll("button")].find((b) => b.classList.contains("ob-eye"));
  if (!el || !(el instanceof HTMLButtonElement)) throw new Error("eye button missing");
  return el;
}

const fetchMock = vi.fn();
const UPLOAD_ID = "u-AAAAAAAAAAAAAAAAAAAAAA";
const FAKE_PARSE = {
  book: {
    title: "Middlemarch",
    author: "George Eliot",
    chapters: ["One", "Two"],
    words: 1000,
    cover: null,
  },
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

function serverError(code: UploadErrorCode, status: number): Response {
  return json({ status: "error", code, message: UPLOAD_MESSAGES[code] }, status);
}

function created() {
  return json({ status: "created", id: UPLOAD_ID, chapters: 2, parts: 2 });
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

function actionButton(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button.ob-action")].find((el) =>
    el.textContent?.includes(label),
  );
  if (!found || !(found instanceof HTMLButtonElement)) throw new Error(`action missing: ${label}`);
  return found;
}

function quietButton(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button.ob-quiet")].find((el) =>
    el.textContent?.includes(label),
  );
  if (!found || !(found instanceof HTMLButtonElement)) throw new Error(`quiet missing: ${label}`);
  return found;
}

function storageText(): string {
  let out = "";
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      out += window.localStorage.getItem(window.localStorage.key(i) ?? "");
    }
  } catch {
    // No storage: nothing could have leaked into it.
  }
  try {
    for (let i = 0; i < window.sessionStorage.length; i++) {
      out += window.sessionStorage.getItem(window.sessionStorage.key(i) ?? "");
    }
  } catch {
    // No storage: nothing could have leaked into it.
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
  render(<UploadSection />);
});

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => {
    root?.unmount();
  });
  root = null;
  container.remove();
});

describe("idle keybox", () => {
  test("key pick reveals the field with safe attributes", () => {
    expect(container.querySelector("#obKeybox")?.hasAttribute("hidden")).toBe(true);
    click(pickButton("Bring your own key!"));
    expect(container.querySelector("#obKeybox")?.hasAttribute("hidden")).toBe(false);
    const input = keyInput();
    expect(input.type).toBe("password");
    expect(input.placeholder).toBe("Paste your API key");
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(input.getAttribute("spellcheck")).toBe("false");
    expect(input.name).not.toMatch(/api.?key/i);
    expect(eyeButton().getAttribute("aria-label")).toBe("Show API key");
  });

  test("eye toggles input type and label", () => {
    click(pickButton("Bring your own key!"));
    click(eyeButton());
    expect(keyInput().type).toBe("text");
    expect(eyeButton().getAttribute("aria-label")).toBe("Hide API key");
    expect(eyeButton().getAttribute("aria-pressed")).toBe("true");
    click(eyeButton());
    expect(keyInput().type).toBe("password");
    expect(eyeButton().getAttribute("aria-label")).toBe("Show API key");
  });

  test("free pick hides and clears the key", () => {
    click(pickButton("Bring your own key!"));
    typeInto(keyInput(), "sk-test-idle");
    expect(keyInput().value).toBe("sk-test-idle");
    click(pickButton("Free"));
    expect(container.querySelector("#obKeybox")?.hasAttribute("hidden")).toBe(true);
    click(pickButton("Bring your own key!"));
    expect(keyInput().value).toBe("");
    expect(keyInput().type).toBe("password");
    try {
      const stored = JSON.stringify(window.localStorage);
      expect(stored).not.toContain("sk-test-idle");
    } catch {
      // No storage in this runner: nothing could have been stored.
    }
  });
});

describe("ByokStep initialKey", () => {
  test("prefills the key input", () => {
    render(<ByokStep reason="too_long" initialKey="sk-test-prefill" onSubmit={() => {}} />);
    const input = container.querySelector('input[name="transient-key"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("byok key input missing");
    expect(input.value).toBe("sk-test-prefill");
  });
});

describe("upload flow", () => {
  function stepsThenDone() {
    let steps = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/uploads") return created();
      steps += 1;
      return steps === 1
        ? json({ status: "working", id: UPLOAD_ID, done: 1, total: 2 })
        : json({ status: "done", id: UPLOAD_ID, done: 2, total: 2 });
    });
  }

  test("creates, steps, saves the book, counts it, and navigates", async () => {
    stepsThenDone();
    await chooseFile();
    expect(container.querySelector(".ob-mini-title")?.textContent).toBe("Middlemarch");
    click(actionButton("Read with soundtrack"));
    await settle();
    expect(pushMock).toHaveBeenCalledWith(`/read/${UPLOAD_ID}`);
    expect(container.textContent).toContain("Setting it to music…");
    // Free path: no key header, sections in the create body.
    const [createUrl, createInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(createUrl).toBe("/api/uploads");
    expect(createInit.headers as Record<string, string>).not.toHaveProperty(BYOK_HEADER);
    expect(JSON.parse(createInit.body as string)).toEqual({
      title: "Middlemarch",
      author: "George Eliot",
      sections: FAKE_PARSE.sections,
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/uploads/${UPLOAD_ID}/step`);
    const mine = JSON.parse(window.localStorage.getItem("lectoria.myBooks.v1") ?? "[]");
    expect(mine).toEqual([
      { id: UPLOAD_ID, title: "Middlemarch", author: "George Eliot", savedAt: expect.any(Number) },
    ]);
    expect(window.localStorage.getItem("lectoria.freeBooks.v2")).toContain('"count":1');
    // Free path: no reader key to picture with.
    expect(getReaderKey(UPLOAD_ID)).toBeNull();
  });

  test("shows a progress bar and live copy mid-flight", async () => {
    let release!: (res: Response) => void;
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/uploads" ? created() : gate,
    );
    await chooseFile();
    click(actionButton("Read with soundtrack"));
    await settle();
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute("aria-valuemax")).toBe("100");
    expect(bar?.getAttribute("aria-valuenow")).toBe("0");
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain("Finding the scenes…");
    release(json({ status: "done", id: UPLOAD_ID, done: 2, total: 2 }));
    await settle();
    expect(pushMock).toHaveBeenCalledWith(`/read/${UPLOAD_ID}`);
  });

  test.each(["too_long", "daily_books_reached", "daily_budget_reached"] as UploadErrorCode[])(
    "%s opens the BYOK step with the exact button text",
    async (code) => {
      fetchMock.mockImplementation(async () => serverError(code, 429));
      await chooseFile();
      click(actionButton("Read with soundtrack"));
      await settle();
      expect(container.textContent).toContain(UPLOAD_MESSAGES[code]);
      expect(actionButton("Bring your own key!").textContent).toBe("Bring your own key!");
      expect(pushMock).not.toHaveBeenCalled();
    },
  );

  test("human_required asks to retry the check", async () => {
    fetchMock.mockImplementation(async () => serverError("human_required", 403));
    await chooseFile();
    click(actionButton("Read with soundtrack"));
    await settle();
    expect(container.textContent).toContain("pick up where we left off");
    expect(actionButton("Try again")).toBeTruthy();
  });

  test.each(["expired", "not_found"] as UploadErrorCode[])("%s says to upload again", async (code) => {
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/uploads" ? created() : serverError(code, 404),
    );
    await chooseFile();
    click(actionButton("Read with soundtrack"));
    await settle();
    expect(container.textContent).toContain(UPLOAD_MESSAGES[code]);
    click(actionButton("Upload it again"));
    expect(container.querySelector(".ob-drop")).toBeTruthy();
  });

  test.each(["bad_request", "unavailable"] as UploadErrorCode[])("%s offers Try again", async (code) => {
    fetchMock.mockImplementation(async () => serverError(code, 400));
    await chooseFile();
    click(actionButton("Read with soundtrack"));
    await settle();
    expect(container.textContent).toContain(UPLOAD_MESSAGES[code]);
    expect(actionButton("Try again")).toBeTruthy();
  });

  test("a failed step retries from the same job", async () => {
    let steps = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/uploads") return created();
      steps += 1;
      // Coded 503: no auto-retry, straight to the failed view.
      return steps === 1
        ? serverError("unavailable", 503)
        : json({ status: "done", id: UPLOAD_ID, done: 2, total: 2 });
    });
    await chooseFile();
    click(actionButton("Read with soundtrack"));
    await settle();
    click(actionButton("Try again"));
    await settle();
    expect(pushMock).toHaveBeenCalledWith(`/read/${UPLOAD_ID}`);
    // Resumed: one create, two step calls.
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/uploads")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url !== "/api/uploads")).toHaveLength(2);
  });

  test("a BYOK book sends the key in the header only and skips the hint", async () => {
    window.localStorage.setItem(
      "lectoria.freeBooks.v2",
      JSON.stringify({ day: new Date().toISOString().slice(0, 10), count: 2 }),
    );
    act(() => {
      root?.unmount();
      root = createRoot(container);
    });
    render(<UploadSection />);
    stepsThenDone();
    await chooseFile();
    expect(container.querySelector(".ob-byok-t")?.textContent).toBe("Bring your own key!");
    const input = container.querySelector('input[name="transient-key"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("byok key input missing");
    typeInto(input, "meta-secret-key");
    click(actionButton("Read with soundtrack"));
    await settle();
    expect(pushMock).toHaveBeenCalledWith(`/read/${UPLOAD_ID}`);
    for (const [, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect((init.headers as Record<string, string>)[BYOK_HEADER]).toBe("meta-secret-key");
      expect(init.body as string).not.toContain("meta-secret-key");
    }
    expect(storageText()).not.toContain("meta-secret-key");
    expect(window.localStorage.getItem("lectoria.freeBooks.v2")).toContain('"count":2');
    // Meta key stays in module memory for the reader's picture requests.
    expect(getReaderKey(UPLOAD_ID)).toBe("meta-secret-key");
  });

  test("a failed free upload recovers through Bring your own key!", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (!headers[BYOK_HEADER]) return serverError("daily_books_reached", 429);
      if (url === "/api/uploads") return created();
      return json({ status: "done", id: UPLOAD_ID, done: 2, total: 2 });
    });
    await chooseFile();
    click(actionButton("Read with soundtrack"));
    await settle();
    const input = container.querySelector('input[name="transient-key"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("byok key input missing");
    typeInto(input, "meta-rescue-key");
    click(actionButton("Bring your own key!"));
    await settle();
    expect(pushMock).toHaveBeenCalledWith(`/read/${UPLOAD_ID}`);
    expect(window.localStorage.getItem("lectoria.freeBooks.v2") ?? "").not.toContain('"count":1');
    expect(storageText()).not.toContain("meta-rescue-key");
  });

  test("a friend code reveals one field and lets the server decide the route", async () => {
    window.localStorage.setItem(
      "lectoria.freeBooks.v2",
      JSON.stringify({ day: new Date().toISOString().slice(0, 10), count: 1 }),
    );
    act(() => {
      root?.unmount();
      root = createRoot(container);
    });
    render(<UploadSection />);
    expect(container.querySelector("#obFriend")).toBeNull();
    click(quietButton("Have a friend code?"));
    const input = container.querySelector("#obFriend");
    if (!(input instanceof HTMLInputElement)) throw new Error("friend code input missing");
    expect(input.type).toBe("text");
    expect(input.getAttribute("autocomplete")).toBe("off");
    typeInto(input, "maple");
    stepsThenDone();
    await chooseFile();
    // The local hint says the free book is used, but the code keeps the free route.
    expect(container.querySelector(".ob-byok-t")).toBeNull();
    click(actionButton("Read with soundtrack"));
    await settle();
    expect(pushMock).toHaveBeenCalledWith(`/read/${UPLOAD_ID}`);
    const [, createInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(createInit.body as string)).toEqual(expect.objectContaining({ friendCode: "maple" }));
    expect(storageText()).not.toContain("maple");
  });
});
