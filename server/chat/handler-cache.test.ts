import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BYOK_HEADER } from "@/core/chat";
import { answerCacheKey, isCommonQuestion, normalizeQuestion } from "@/core/chat-cache";
import { createMemoryKV } from "@/core/images";
import { loadBookData } from "@/server/books";
import type { BookPayload } from "@/server/books";
import { resetTurnstileWarnForTests } from "@/server/guard/human";
import { createDiskAnswerCache, createKvAnswerCache, localChatCacheDir, selectAnswerCache } from "./answer-cache";
import type { AnswerCache } from "./answer-cache";
import { handleChatPost } from "./handler";
import { ENV, NOW, OK_CHUNKS, factoryFor, post, validBody } from "./test-fixtures";
import type { Capture } from "./test-fixtures";

const envOf = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;
const RECAP = "What should I remember from previous chapters?";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  resetTurnstileWarnForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function spyCache(): AnswerCache & { store: Map<string, string>; gets: number } {
  const store = new Map<string, string>();
  const c = {
    store,
    gets: 0,
    async get(key: string) {
      c.gets += 1;
      return store.get(key) ?? null;
    },
    async set(key: string, answer: string) {
      store.set(key, answer);
    },
  };
  return c;
}

function ask(body: Record<string, unknown>, cache: AnswerCache, calls: { count: number }, capture: Capture = {}, headers = {}) {
  return handleChatPost(post(validBody({ messages: [{ role: "user", content: RECAP }], ...body }), headers), {
    env: ENV,
    kv: createMemoryKV(),
    now: NOW,
    answerCache: cache,
    createStreamer: factoryFor(OK_CHUNKS, capture, calls),
  });
}

describe("common-question normalizing", () => {
  it("treats recap-type questions as common and others not", () => {
    expect(normalizeQuestion("  What SHOULD I remember…   from previous chapters?! ")).toBe(
      "what should i remember from previous chapters",
    );
    for (const q of [RECAP, "Recap please", "Can you summarize the story so far?", "Catch me up", "What has happened so far?"]) {
      expect(isCommonQuestion(normalizeQuestion(q))).toBe(true);
    }
    for (const q of ["Why is the Tin Woodman sad?", "Zebra question alpha 42?", ""]) {
      expect(isCommonQuestion(normalizeQuestion(q))).toBe(false);
    }
  });

  it("keys apart by book, text version, scene, question and prompt", () => {
    const base = { bookId: "oz", textVersion: "t1", sceneId: "c1s2", normalizedQuestion: "recap", systemPrompt: "P" };
    const k = answerCacheKey(base);
    expect(k).toMatch(/^chat:answer:v1:[0-9a-f]{64}$/);
    for (const over of [{ bookId: "alice" }, { textVersion: "t2" }, { sceneId: "c1s3" }, { normalizedQuestion: "summary" }, { systemPrompt: "Q" }]) {
      expect(answerCacheKey({ ...base, ...over })).not.toBe(k);
    }
  });
});

describe("handleChatPost answer cache", () => {
  it("serves a second reader in the same scene from the cache, without the model", async () => {
    const cache = spyCache();
    const calls = { count: 0 };
    const first = await ask({ upToN: 10 }, cache, calls);
    expect(await first.text()).toContain("Hello ");
    expect(cache.store.size).toBe(1);
    expect([...cache.store.values()]).toEqual(["Hello there"]);
    const second = await ask({ upToN: 8 }, cache, calls);
    const text = await second.text();
    expect(text).toContain('"text":"Hello there"');
    expect(text).toContain("event: done");
    expect(calls.count).toBe(1);
  });

  it("answers from text before the reader's scene, so the cached answer has no spoilers", async () => {
    const { book } = await loadBookData("oz");
    const at = (n: number) => book.paragraphs.find((p) => p.n === n)!.text;
    const capture: Capture = {};
    await (await ask({ upToN: 10 }, spyCache(), { count: 0 }, capture)).text();
    const system = capture.messages?.[0]?.content ?? "";
    // Scene c1s2 starts at paragraph 6.
    expect(system).toContain(at(5));
    expect(system).not.toContain(at(6));
  });

  it("a later scene is a different entry", async () => {
    const cache = spyCache();
    const calls = { count: 0 };
    await (await ask({ upToN: 10 }, cache, calls)).text();
    await (await ask({ upToN: 14 }, cache, calls)).text();
    expect(calls.count).toBe(2);
    expect(cache.store.size).toBe(2);
  });

  it("never reads or writes the cache for BYOK, spoilers, follow-ups, other questions or uploads", async () => {
    const cache = spyCache();
    const calls = { count: 0 };
    await (await ask({ upToN: 10 }, cache, calls, {}, { [BYOK_HEADER]: "reader-meta-key-1" })).text();
    await (await ask({ upToN: 10, spoilers: true }, cache, calls)).text();
    await (await ask({ upToN: 10, messages: [{ role: "user", content: "Why is Dorothy in Kansas?" }] }, cache, calls)).text();
    await (
      await ask(
        {
          upToN: 10,
          messages: [
            { role: "user", content: "hi" },
            { role: "assistant", content: "hello" },
            { role: "user", content: RECAP },
          ],
        },
        cache,
        calls,
      )
    ).text();
    const upload = (): BookPayload => ({
      book: {
        id: "u-AAAAAAAAAAAAAAAAAAAAAA",
        title: "Up",
        author: "A",
        textVersion: "v1",
        chapters: [{ ch: 1, title: "One", start_n: 1, end_n: 3 }],
        paragraphs: [1, 2, 3].map((n) => ({ id: `c1p${n}`, ch: 1, n, text: `para ${n}` })),
      },
      scenes: [{ id: "c1s2", ch: 1, start_n: 2, end_n: 3, title: "", summary: "", characters: [] } as unknown as BookPayload["scenes"][number]],
    });
    const res = await handleChatPost(post(validBody({ bookId: "u-AAAAAAAAAAAAAAAAAAAAAA", upToN: 3, messages: [{ role: "user", content: RECAP }] })), {
      env: ENV,
      kv: createMemoryKV(),
      now: NOW,
      answerCache: cache,
      loadBook: async () => upload(),
      createStreamer: factoryFor(OK_CHUNKS, {}, calls),
    });
    await res.text();
    expect(calls.count).toBe(5);
    expect(cache.gets).toBe(0);
    expect(cache.store.size).toBe(0);
  });

  it("uses the injected KV when no cache is given, with a TTL", async () => {
    const kv = createMemoryKV();
    const expire = vi.spyOn(kv, "expire");
    const calls = { count: 0 };
    const run = () =>
      handleChatPost(post(validBody({ upToN: 10, messages: [{ role: "user", content: RECAP }] })), {
        env: ENV,
        kv,
        now: NOW,
        createStreamer: factoryFor(OK_CHUNKS, {}, calls),
      });
    await (await run()).text();
    await (await run()).text();
    expect(calls.count).toBe(1);
    expect(expire).toHaveBeenCalledWith(expect.stringMatching(/^chat:answer:v1:/), expect.any(Number));
  });
});

describe("answer cache stores", () => {
  it("disk cache round-trips, expires, and ignores a mismatched key", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lectoria-chat-"));
    try {
      let t = 1_000;
      const disk = createDiskAnswerCache(dir, () => t);
      expect(await disk.get("k")).toBeNull();
      await disk.set("k", "An answer");
      expect(await disk.get("k")).toBe("An answer");
      expect(await disk.get("other")).toBeNull();
      t += 31 * 24 * 60 * 60 * 1000;
      expect(await disk.get("k")).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("kv cache drops oversized or empty values", async () => {
    const kv = createMemoryKV();
    const c = createKvAnswerCache(kv);
    await kv.set("a", "");
    await kv.set("b", "x".repeat(5000));
    expect(await c.get("a")).toBeNull();
    expect(await c.get("b")).toBeNull();
  });

  it("picks disk off Vercel without a remote cache, KV on Vercel", () => {
    expect(localChatCacheDir(envOf({}))).toMatch(/\.cache[\\/]lectoria[\\/]chat$/);
    expect(localChatCacheDir(envOf({ LECTORIA_CHAT_CACHE_DIR: "relative" }))).toMatch(/lectoria[\\/]chat$/);
    const kv = createMemoryKV();
    const set = vi.spyOn(kv, "get");
    void selectAnswerCache(kv, envOf({ VERCEL: "1" })).get("z");
    expect(set).toHaveBeenCalledWith("z");
    set.mockClear();
    void selectAnswerCache(kv, envOf({ LECTORIA_CHAT_CACHE_DIR: "/nonexistent-lectoria-test" })).get("z");
    expect(set).not.toHaveBeenCalled();
  });
});
