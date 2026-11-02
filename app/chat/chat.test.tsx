// @vitest-environment jsdom
// Reader chat: launcher, suggestions, send/stream, quota BYOK, errors,
// spoilers, persistence, and the home ByokStep default. Rendering follows
// app/home/upload.test.tsx (react-dom root + act, native event dispatch).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ByokStep } from "../home/byok";
import { setReaderKey } from "../leer/reader-key";
import { ReaderChat } from "./reader-chat";
import { SUGGESTED_QUESTIONS } from "./suggestions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STORE = "lectoria:chat:oz";

let container: HTMLDivElement;
let root: Root | null = null;

function render(node: React.ReactNode) {
  act(() => {
    root?.render(node);
  });
}

function renderChat() {
  render(
    <ReaderChat
      bookId="oz"
      upToN={42}
      chapter={3}
      chapterTitle="How Dorothy Saved the Scarecrow"
    />,
  );
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function launcher(): HTMLButtonElement {
  const el = container.querySelector(".chat-launch");
  if (!(el instanceof HTMLButtonElement)) throw new Error("launcher missing");
  return el;
}

function textarea(): HTMLTextAreaElement {
  const el = container.querySelector(".chat-ta");
  if (!(el instanceof HTMLTextAreaElement)) throw new Error("composer missing");
  return el;
}

function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function pressKey(el: Element, key: string, opts?: { shiftKey?: boolean }) {
  act(() => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, shiftKey: opts?.shiftKey ?? false }),
    );
  });
}

async function flush(ms = 30) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function sse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk));
      c.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream" } });
}

function errJson(code: string, status: number): Response {
  return new Response(JSON.stringify({ status: "error", code, message: "x" }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const ANSWER = [
  "event: delta\ndata: {\"text\": \"Hello \"}\n\n",
  "event: delta\ndata: {\"text\": \"there\"}\n\n",
  'event: done\ndata: {"remaining": 14}\n\n',
];

function mockFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(async (url: string, init?: RequestInit) => impl(url, init));
  vi.stubGlobal("fetch", spy);
  return spy;
}

function bodyOf(spy: ReturnType<typeof mockFetch>, n = 0): Record<string, unknown> {
  const init = spy.mock.calls[n]?.[1] as RequestInit | undefined;
  return JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>;
}

function headersOf(spy: ReturnType<typeof mockFetch>, n = 0): Record<string, string> {
  const init = spy.mock.calls[n]?.[1] as RequestInit | undefined;
  return { ...((init?.headers as Record<string, string> | undefined) ?? {}) };
}

beforeEach(() => {
  try {
    window.sessionStorage.removeItem(STORE);
  } catch {
    // No storage in this runner: persistence tests degrade to smoke only.
  }
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
  renderChat();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container.remove();
  vi.unstubAllGlobals();
});

describe("launcher", () => {
  test("opens, closes, and toggles label and aria state", () => {
    const btn = launcher();
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(btn.textContent).toContain("Ask the book");
    expect(container.querySelector("#chat-panel")).toBeNull();

    click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(btn.textContent).toContain("Close");
    expect(btn.getAttribute("aria-label")).toBe("Close chat");
    const panel = container.querySelector("#chat-panel");
    expect(panel?.getAttribute("role")).toBe("dialog");
    expect(document.activeElement).toBe(textarea());

    click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(btn.textContent).toContain("Ask the book");
    expect(container.querySelector("#chat-panel")).toBeNull();
  });

  test("Escape closes and returns focus to the launcher", () => {
    const btn = launcher();
    click(btn);
    expect(container.querySelector("#chat-panel")).not.toBeNull();
    pressKey(textarea(), "Escape");
    expect(container.querySelector("#chat-panel")).toBeNull();
    expect(document.activeElement).toBe(btn);
  });
});

describe("conversation", () => {
  test("empty state shows the three general suggestions", () => {
    click(launcher());
    expect(container.querySelector(".chat-welcome")?.textContent).toContain(
      "from the book itself",
    );
    const links = [...container.querySelectorAll(".chat-sugg .chat-link")].map((el) =>
      el.textContent?.trim(),
    );
    expect(links).toEqual([...SUGGESTED_QUESTIONS]);
  });

  test("sending posts the right body and renders the streamed answer", async () => {
    const spy = mockFetch(() => sse(ANSWER));
    click(launcher());
    typeInto(textarea(), "Why wings?");
    click(container.querySelector(".chat-send") as Element);
    await flush();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe("/api/chat");
    expect(bodyOf(spy)).toEqual({
      bookId: "oz",
      upToN: 42,
      spoilers: false,
      messages: [{ role: "user", content: "Why wings?" }],
    });
    expect(headersOf(spy)["x-byok-key"]).toBeUndefined();
    expect(container.querySelector(".chat-a")?.textContent).toBe("Hello there");
    expect(container.querySelector(".chat-foot")?.textContent).toContain("14 questions left today");
  });

  test("loading shows the waiting line and Stop aborts cleanly", async () => {
    let release!: (v: Response) => void;
    mockFetch(() => new Promise<Response>((r) => (release = r)));
    click(launcher());
    typeInto(textarea(), "A slow question?");
    click(container.querySelector(".chat-send") as Element);

    expect(container.querySelector(".chat-wait")?.textContent).toContain(
      "Looking back through the pages",
    );
    const stop = container.querySelector(".chat-stop");
    expect(stop?.textContent).toBe("Stop");

    click(stop as Element);
    await act(async () => {
      release(sse(ANSWER));
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(container.querySelector(".chat-note-error")).toBeNull();
    expect(container.querySelector(".chat-send")).not.toBeNull();
  });
});

describe("quota and errors", () => {
  test("429 quota shows BYOK; the key resends with header and footer", async () => {
    const spy = mockFetch(() => errJson("quota", 429));
    click(launcher());
    typeInto(textarea(), "One question?");
    click(container.querySelector(".chat-send") as Element);
    await flush();

    expect(container.querySelector(".chat-note")?.textContent).toContain("Bring your own key!");
    expect(container.querySelector(".chat-note")?.textContent).toContain(
      "your 15 questions for today",
    );

    spy.mockImplementation(async () => sse(['event: done\ndata: {}\n\n']));
    const key = container.querySelector('.chat-note input[name="transient-key"]');
    if (!(key instanceof HTMLInputElement)) throw new Error("key field missing");
    typeInto(key, "sk-test-123");
    click([...container.querySelectorAll(".chat-note button")].find((b) =>
      b.textContent?.includes("Keep asking"),
    ) as Element);
    await flush();

    expect(spy).toHaveBeenCalledTimes(2);
    expect(headersOf(spy, 1)["x-byok-key"]).toBe("sk-test-123");
    expect(bodyOf(spy, 1)).toMatchObject({ bookId: "oz", spoilers: false });
    expect(container.querySelector(".chat-foot")?.textContent).toContain("Using your key");
  });

  test("503 shows the error copy and Try again resends", async () => {
    const spy = mockFetch(() => errJson("unavailable", 503));
    click(launcher());
    typeInto(textarea(), "Fragile question?");
    click(container.querySelector(".chat-send") as Element);
    await flush();

    expect(container.querySelector(".chat-note-error")?.textContent).toContain(
      "Something went wrong on our side",
    );
    const retry = [...container.querySelectorAll(".chat-note-error button")].find((b) =>
      b.textContent?.includes("Try again"),
    );
    expect(document.activeElement).toBe(retry as Element);

    spy.mockImplementation(async () => sse(ANSWER));
    click(retry as Element);
    await flush();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(bodyOf(spy, 1)).toEqual(bodyOf(spy, 0));
    expect(container.querySelector(".chat-a")?.textContent).toBe("Hello there");
  });

  test("human check shows the person line without a raw code", async () => {
    mockFetch(() => errJson("human", 403));
    click(launcher());
    typeInto(textarea(), "Are you real?");
    click(container.querySelector(".chat-send") as Element);
    await flush();

    expect(container.querySelector(".chat-note")?.textContent).toContain(
      "One quick check that you're a person.",
    );
    expect(container.textContent).not.toContain("403");
  });
});

describe("spoilers", () => {
  test("switch asks once, then widens the scope and the request", async () => {
    const spy = mockFetch(() => sse(ANSWER));
    click(launcher());
    const scope = () => container.querySelector(".chat-scope")?.textContent ?? "";
    expect(scope()).toContain("Chapter 3, How Dorothy Saved the Scarecrow");

    click(container.querySelector(".chat-switch") as Element);
    expect(container.querySelector(".chat-confirm")?.textContent).toContain(
      "give away the ending",
    );
    click(
      [...container.querySelectorAll(".chat-confirm button")].find((b) =>
        b.textContent?.includes("Yes"),
      ) as Element,
    );
    expect(scope()).toContain("Spoilers on");

    typeInto(textarea(), "What happens later?");
    click(container.querySelector(".chat-send") as Element);
    await flush();
    expect(bodyOf(spy)).toMatchObject({ spoilers: true });

    click(container.querySelector(".chat-switch") as Element);
    expect(scope()).toContain("Chapter 3, How Dorothy Saved the Scarecrow");
  });
});

describe("persistence", () => {
  test("conversation and remaining survive a remount", async () => {
    mockFetch(() => sse(ANSWER));
    click(launcher());
    typeInto(textarea(), "Remember me?");
    click(container.querySelector(".chat-send") as Element);
    await flush();
    expect(container.querySelector(".chat-a")?.textContent).toBe("Hello there");

    act(() => {
      root?.unmount();
    });
    act(() => {
      root = createRoot(container);
    });
    renderChat();
    click(launcher());
    expect(container.querySelector(".chat-q")?.textContent).toBe("Remember me?");
    expect(container.querySelector(".chat-a")?.textContent).toBe("Hello there");
    expect(container.querySelector(".chat-foot")?.textContent).toContain("14 questions left today");
  });

  test("the key is never written to storage", async () => {
    const secret = "sk-never-store-me-789";
    const spy = mockFetch(() => errJson("quota", 429));
    click(launcher());
    typeInto(textarea(), "Quota question?");
    click(container.querySelector(".chat-send") as Element);
    await flush();

    spy.mockImplementation(async () => sse(['event: done\ndata: {}\n\n']));
    const key = container.querySelector('.chat-note input[name="transient-key"]');
    if (!(key instanceof HTMLInputElement)) throw new Error("key field missing");
    typeInto(key, secret);
    click([...container.querySelectorAll(".chat-note button")].find((b) =>
      b.textContent?.includes("Keep asking"),
    ) as Element);
    await flush();
    expect(headersOf(spy, 1)["x-byok-key"]).toBe(secret);

    const values: string[] = [];
    for (const store of [window.sessionStorage, window.localStorage]) {
      try {
        for (let i = 0; i < store.length; i++) values.push(store.getItem(store.key(i) ?? "") ?? "");
      } catch {
        // Storage blocked: nothing could have been written.
      }
    }
    expect(values.length).toBeGreaterThan(0);
    expect(values.join("\n")).not.toContain(secret);
  });
});

describe("suggestions", () => {
  test("are three general questions that name nothing from the story", () => {
    expect(SUGGESTED_QUESTIONS).toHaveLength(3);
    const names = /Dorothy|Toto|Scarecrow|Tin|Lion|Oz|Witch|Kansas|Emerald/i;
    for (const q of SUGGESTED_QUESTIONS) expect(q).not.toMatch(names);
  });
});

describe("reader key", () => {
  test("an upload finished with the reader key sends it as BYOK", async () => {
    setReaderKey("u-AAAAAAAAAAAAAAAAAAAAAA", "reader-secret-key");
    render(
      <ReaderChat bookId="u-AAAAAAAAAAAAAAAAAAAAAA" upToN={7} chapter={1} chapterTitle="Early" />,
    );
    const spy = mockFetch(() => sse(ANSWER));
    click(launcher());
    typeInto(textarea(), "What happened here?");
    click(container.querySelector(".chat-send") as Element);
    await flush();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(headersOf(spy)["x-byok-key"]).toBe("reader-secret-key");
    expect(container.querySelector(".chat-foot")?.textContent).toContain("Using your key");
  });
});

describe("ByokStep on the home page", () => {
  test("still reads Read with soundtrack by default", () => {
    render(<ByokStep reason="too_long" onSubmit={() => {}} />);
    expect(container.querySelector(".ob-byok-t")?.textContent).toBe("Bring your own key!");
    expect(container.querySelector(".ob-action")?.textContent).toContain("Read with soundtrack");
  });
});
