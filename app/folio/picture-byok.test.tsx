// @vitest-environment jsdom
// Bring your own key for pictures: the key typed at a quota note serves
// every picture request in this tab, rides only in the BYOK header, and
// never lands in storage, cookies, the URL, the body, or the console.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { BYOK_HEADER } from "@/core/chat";
import { MSG_BYOK_IMAGES, MSG_QUOTA } from "@/core/images";
import { getReaderKey, setSessionKey } from "../leer/reader-key";
import { ImageRequestError, poll } from "./image-poll";
import { PictureByok } from "./picture-byok";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = "my-meta-key-canary-987";

afterEach(() => {
  setSessionKey(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  document.body.innerHTML = "";
});

function stubFetch(...answers: unknown[]) {
  const fn = vi.fn(async (_url: unknown, _init?: RequestInit) => ({ json: async () => answers.shift() }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

const BODY = { kind: "scene", bookId: "oz", textVersion: "v", sceneId: "c1s1" };

test("without a key, shelf pictures send no BYOK header", async () => {
  const fetch = stubFetch({ status: "ready", url: "/a.webp", caption: "c" });
  await poll(BODY);
  expect(new Headers(fetch.mock.calls[0]![1]!.headers).has(BYOK_HEADER)).toBe(false);
});

test("a key typed at the quota note pictures any book through the header only", async () => {
  const onKey = vi.fn();
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<PictureByok onKey={onKey} />));
  const input = host.querySelector<HTMLInputElement>('input[type="password"]')!;
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(input, KEY);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => host.querySelector<HTMLButtonElement>(".ob-action")!.click());
  expect(onKey).toHaveBeenCalledOnce();
  expect(input.value).toBe("");
  expect(getReaderKey("oz")).toBe(KEY);
  expect(getReaderKey("dracula")).toBe(KEY);

  const fetch = stubFetch({ status: "ready", url: "/a.webp", caption: "c" });
  await poll(BODY);
  const [url, init] = fetch.mock.calls[0]!;
  expect(new Headers(init!.headers).get(BYOK_HEADER)).toBe(KEY);
  expect(String(url)).not.toContain(KEY);
  expect(String(init!.body)).not.toContain(KEY);

  expect(setItem).not.toHaveBeenCalled();
  expect(document.cookie).not.toContain(KEY);
  expect(window.location.href).not.toContain(KEY);
  for (const spy of logs) for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(KEY);
  act(() => root.unmount());
});

test("a refused key is dropped and reported as a key problem, offering another", async () => {
  setSessionKey(KEY);
  stubFetch({ status: "error", code: "byok_invalid", message: MSG_BYOK_IMAGES });
  const err = await poll(BODY).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ImageRequestError);
  expect((err as ImageRequestError).message).toBe(MSG_BYOK_IMAGES);
  expect((err as ImageRequestError).message).not.toContain(KEY);
  expect(getReaderKey("oz")).toBeNull();
});

test("the free-quota error keeps the friendly copy", async () => {
  stubFetch({ status: "error", code: "quota", message: MSG_QUOTA });
  await expect(poll(BODY)).rejects.toMatchObject({ code: "quota", message: MSG_QUOTA });
});
