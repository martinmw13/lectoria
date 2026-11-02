import { describe, expect, it, vi } from "vitest";
import { BYOK_HEADER } from "@/core/chat";
import { MSG_BAD_REQUEST, createMemoryKV, quotaKeys } from "@/core/images";
import type { ImageStore } from "@/core/images";
import { dailySpendKey, spendKey } from "@/server/guard/spend";
import { hashIp, ipBucket, utcDay } from "@/server/guard/request";
import { issueAnonId, serializeAnonCookie } from "@/server/guard/anon";
import { loadBookData } from "@/server/books";
import type { BookPayload } from "@/server/books";
import { issueHumanCookie } from "@/server/guard/human";
import { handleImagesPost } from "./handler";
import type { ImageEnv } from "./env";

const { book: ozBook } = await loadBookData("oz");

function passageBody() {
  const first = ozBook.paragraphs[0];
  if (!first) throw new Error("test book has no paragraphs");
  return { kind: "passage", bookId: ozBook.id, textVersion: ozBook.textVersion, n: first.n };
}

// Uploaded books through the images route: injected loader, no bookmap,
// missing uploads, the reached-chapter gate, and the reader's own key.
describe("uploaded books", () => {
  const secret = "test-session-secret";
  const imgEnv: ImageEnv = {
    upstashUrl: "https://kv.example",
    upstashToken: "kv-token",
    metaKey: "test-meta",
    sessionSecret: secret,
    ipSalt: "test-salt",
    spendCapMicro: 10_000_000,
    dailySpendCapMicro: 2_000_000,
    turnstileSecret: "ts-secret",
    turnstileSiteKey: "ts-site",
  };

  const UPLOAD_ID = "u-AAAAAAAAAAAAAAAAAAAAAA";

  function fakes() {
    const kv = createMemoryKV();
    const store: ImageStore = {
      findUrl: async () => null,
      save: async (path) => `https://blob.example/${path}`,
    };
    const generate = { generate: async () => new Uint8Array([1, 2, 3]) };
    return { kv, store, generate };
  }

  function passagePost(body: unknown, headers: Record<string, string> = {}): Request {
    return new Request("http://localhost/api/images", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }

  it("serves an upload passage through the injected loader with no bookmap reference", async () => {
    const payload = {
      book: {
        id: UPLOAD_ID,
        title: "Middlemarch",
        author: "George Eliot",
        chapters: [
          { ch: 1, title: "One", start_n: 1, end_n: 1 },
          { ch: 2, title: "Two", start_n: 2, end_n: 2 },
        ],
        paragraphs: [
          { id: "c1p1", n: 1, ch: 1, text: "Hello world, said Dorothy." },
          { id: "c2p1", n: 2, ch: 2, text: "Later words." },
        ],
        textVersion: "v1",
      },
      scenes: [
        { id: "c1s1", ch: 1, start_n: 1, end_n: 1, title: "Start", summary: "A start.", characters: [] },
        { id: "c2s1", ch: 2, start_n: 2, end_n: 2, title: "Next", summary: "A next.", characters: [] },
      ],
    } as unknown as BookPayload;
    const { kv, store } = fakes();
    let prompt = "";
    const generate = {
      generate: async (p: string) => {
        prompt = p;
        return new Uint8Array([1, 2, 3]);
      },
    };
    const siteFetch = vi.fn(async () => {
      throw new Error("siteverify must not be called");
    });
    const cookie = issueHumanCookie(secret).split(";")[0] as string;
    const res = await handleImagesPost(
      passagePost(
        { kind: "passage", bookId: UPLOAD_ID, textVersion: "v1", n: 1 },
        { Cookie: cookie },
      ),
      {
        env: imgEnv,
        kv,
        store,
        generate,
        fetchFn: siteFetch as unknown as typeof fetch,
        loadBook: async () => payload,
      },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ status: "ready" });
    expect(String(json.url)).toContain(`images/${UPLOAD_ID}/`);
    // Uploads have no bookmap: the prompt is passage text alone.
    expect(prompt).toContain("Hello world, said Dorothy.");
    expect(prompt).not.toContain("Reference details:");
  });

  it("answers 400 for a missing upload instead of throwing notFound", async () => {
    const { kv, store } = fakes();
    const generate = { generate: vi.fn(async () => new Uint8Array([1, 2, 3])) };
    const siteFetch = vi.fn(async () => {
      throw new Error("siteverify must not be called");
    });
    const cookie = issueHumanCookie(secret).split(";")[0] as string;
    const res = await handleImagesPost(
      passagePost(
        { kind: "passage", bookId: UPLOAD_ID, textVersion: "v1", n: 1 },
        { Cookie: cookie },
      ),
      {
        env: imgEnv,
        kv,
        store,
        generate,
        fetchFn: siteFetch as unknown as typeof fetch,
        loadBook: async () => {
          throw new Error("NEXT_NOT_FOUND");
        },
      },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ status: "error", code: "bad_request" });
    expect(generate.generate).not.toHaveBeenCalled();
  });

  it("refuses an unreached upload chapter like a shelf one", async () => {
    const payload = {
      book: {
        id: UPLOAD_ID,
        title: "Middlemarch",
        author: "George Eliot",
        chapters: [
          { ch: 1, title: "One", start_n: 1, end_n: 1 },
          { ch: 2, title: "Two", start_n: 2, end_n: 2 },
        ],
        paragraphs: [
          { id: "c1p1", n: 1, ch: 1, text: "Hello." },
          { id: "c2p1", n: 2, ch: 2, text: "Later." },
        ],
        textVersion: "v1",
      },
      scenes: [],
    } as unknown as BookPayload;
    const { kv, store } = fakes();
    const generate = { generate: vi.fn(async () => new Uint8Array([1, 2, 3])) };
    const cookie = issueHumanCookie(secret).split(";")[0] as string;
    const res = await handleImagesPost(
      passagePost(
        { kind: "chapter", bookId: UPLOAD_ID, textVersion: "v1", ch: 2, reachedCh: 1 },
        { Cookie: cookie },
      ),
      { env: imgEnv, kv, store, generate, loadBook: async () => payload },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ status: "error", code: "bad_request" });
    expect(generate.generate).not.toHaveBeenCalled();
  });

  it("uses the reader key and skips our spend while still taking quota", async () => {
    const payload = {
      book: {
        id: UPLOAD_ID,
        title: "Middlemarch",
        author: "George Eliot",
        chapters: [{ ch: 1, title: "One", start_n: 1, end_n: 1 }],
        paragraphs: [{ id: "c1p1", n: 1, ch: 1, text: "Hello world." }],
        textVersion: "v1",
      },
      scenes: [
        { id: "c1s1", ch: 1, start_n: 1, end_n: 1, title: "Start", summary: "A start.", characters: [] },
      ],
    } as unknown as BookPayload;
    const kv = createMemoryKV();
    const store: ImageStore = {
      findUrl: async () => null,
      save: async (path) => `https://blob.example/${path}`,
    };
    const generate = { generate: async () => new Uint8Array([1, 2, 3]) };
    const siteFetch = vi.fn(async () => {
      throw new Error("siteverify must not be called");
    });
    const issued = issueAnonId(imgEnv.sessionSecret);
    const cookie = serializeAnonCookie(issued.value).split(";")[0] as string;
    const human = issueHumanCookie(secret).split(";")[0] as string;
    const readerKey = "reader-meta-key-123";
    const res = await handleImagesPost(
      passagePost(
        { kind: "passage", bookId: UPLOAD_ID, textVersion: "v1", n: 1 },
        { Cookie: `${cookie}; ${human}`, "x-forwarded-for": "9.9.9.9", [BYOK_HEADER]: `  ${readerKey}  ` },
      ),
      {
        env: imgEnv,
        kv,
        store,
        generate,
        fetchFn: siteFetch as unknown as typeof fetch,
        loadBook: async () => payload,
      },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ status: "ready" });
    expect(JSON.stringify(json)).not.toContain(readerKey);
    const day = utcDay();
    expect(await kv.get(spendKey())).toBeNull();
    expect(await kv.get(dailySpendKey(day))).toBeNull();
    const keys = quotaKeys({
      day,
      ipHash: hashIp(ipBucket("9.9.9.9", issued.id), imgEnv.ipSalt),
      anonId: issued.id,
    });
    expect(await kv.get(keys.ip)).toBe("1");
    expect(await kv.get(keys.anon)).toBe("1");
  });

  it("reserves our spend for an upload without a reader key", async () => {
    const payload = {
      book: {
        id: UPLOAD_ID,
        title: "Middlemarch",
        author: "George Eliot",
        chapters: [{ ch: 1, title: "One", start_n: 1, end_n: 1 }],
        paragraphs: [{ id: "c1p1", n: 1, ch: 1, text: "Hello world." }],
        textVersion: "v1",
      },
      scenes: [
        { id: "c1s1", ch: 1, start_n: 1, end_n: 1, title: "Start", summary: "A start.", characters: [] },
      ],
    } as unknown as BookPayload;
    const { kv, store, generate } = fakes();
    const siteFetch = vi.fn(async () => {
      throw new Error("siteverify must not be called");
    });
    const cookie = issueHumanCookie(secret).split(";")[0] as string;
    const res = await handleImagesPost(
      passagePost(
        { kind: "passage", bookId: UPLOAD_ID, textVersion: "v1", n: 1 },
        { Cookie: cookie },
      ),
      { env: imgEnv, kv, store, generate, fetchFn: siteFetch as unknown as typeof fetch, loadBook: async () => payload },
    );
    expect(res.status).toBe(200);
    expect(await kv.get(spendKey())).not.toBeNull();
  });

  it("rejects a malformed reader key with 400 and generates nothing", async () => {
    const { kv, store } = fakes();
    const generate = { generate: vi.fn(async () => new Uint8Array([1, 2, 3])) };
    const cookie = issueHumanCookie(secret).split(";")[0] as string;
    const res = await handleImagesPost(
      passagePost(passageBody(), { Cookie: cookie, [BYOK_HEADER]: "short" }),
      { env: imgEnv, kv, store, generate },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ status: "error", code: "bad_request" });
    expect(generate.generate).not.toHaveBeenCalled();
  });
});
