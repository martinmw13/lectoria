import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_IMAGE_BODY_BYTES, MSG_BAD_REQUEST, createMemoryKV } from "@/core/images";
import type { ImageStore } from "@/core/images";
import { loadBookData } from "@/server/books";

const { book: ozBook } = await loadBookData("oz");
import { issueHumanCookie } from "@/server/guard/human";
import { handleImagesPost } from "./handler";
import type { ImageEnv } from "./env";

const REQUIRED = [
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "BLOB_READ_WRITE_TOKEN",
  "META_API_KEY",
  "SESSION_SECRET",
  "IP_HASH_SALT",
] as const;

const KV_FALLBACK = ["KV_REST_API_URL", "KV_REST_API_TOKEN"] as const;
const ALL_ENV = [...REQUIRED, ...KV_FALLBACK];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ALL_ENV) saved[k] = process.env[k];
});

afterEach(() => {
  for (const k of ALL_ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

function passageBody() {
  const book = ozBook;
  const first = book.paragraphs[0];
  if (!first) throw new Error("test book has no paragraphs");
  return { kind: "passage", bookId: book.id, textVersion: book.textVersion, n: first.n };
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("handleImagesPost", () => {
  it("returns unavailable without touching quota when env is missing", async () => {
    for (const k of ALL_ENV) delete process.env[k];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const fetchSpy = vi.fn().mockRejectedValue(new Error("must not be called"));
      vi.stubGlobal("fetch", fetchSpy);
      const res = await handleImagesPost(post(passageBody()));
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ status: "error", code: "unavailable" });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledOnce();
      const line = String(warnSpy.mock.calls[0]?.[0] ?? "");
      expect(line).toContain("image env missing:");
      expect(line).toContain("UPSTASH_REDIS_REST_URL|KV_REST_API_URL");
      expect(line).toContain("UPSTASH_REDIS_REST_TOKEN|KV_REST_API_TOKEN");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("warns names only and never logs values when env is partly missing", async () => {
    for (const k of ALL_ENV) delete process.env[k];
    process.env.UPSTASH_REDIS_REST_URL = "secret-canary-url";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const fetchSpy = vi.fn().mockRejectedValue(new Error("must not be called"));
      vi.stubGlobal("fetch", fetchSpy);
      const res = await handleImagesPost(post(passageBody()));
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ status: "error", code: "unavailable" });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledOnce();
      const line = String(warnSpy.mock.calls[0]?.[0] ?? "");
      expect(line).toContain("image env missing:");
      expect(line).toContain("UPSTASH_REDIS_REST_TOKEN|KV_REST_API_TOKEN");
      expect(line).not.toContain("secret-canary-url");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("rejects an oversize content-length with 413 and no raw error", async () => {
    const marker = "raw-secret-marker-oversize";
    const res = await handleImagesPost(
      new Request("http://localhost/api/images", {
        method: "POST",
        headers: { "Content-Type": "application/json", "content-length": String(MAX_IMAGE_BODY_BYTES + 1) },
        body: JSON.stringify({ kind: "passage", marker }),
      }),
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      status: "error",
      code: "bad_request",
      message: MSG_BAD_REQUEST,
    });
  });

  it("rejects a lying small content-length with a big body", async () => {
    const res = await handleImagesPost(
      new Request("http://localhost/api/images", {
        method: "POST",
        headers: { "Content-Type": "application/json", "content-length": "10" },
        body: "a".repeat(MAX_IMAGE_BODY_BYTES + 100),
      }),
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      status: "error",
      code: "bad_request",
      message: MSG_BAD_REQUEST,
    });
  });

  it("rejects a big streamed body with no content-length", async () => {
    const enc = new TextEncoder();
    const res = await handleImagesPost(
      new Request("http://localhost/api/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: new ReadableStream({
          start(c) {
            c.enqueue(enc.encode("raw-secret-marker-stream".padEnd(MAX_IMAGE_BODY_BYTES + 100, "x")));
            c.close();
          },
        }),
        duplex: "half",
      } as RequestInit),
    );
    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json).toEqual({ status: "error", code: "bad_request", message: MSG_BAD_REQUEST });
    expect(JSON.stringify(json)).not.toContain("raw-secret-marker-stream");
  });

  it("treats a mid-upload client abort as 400 with a generic message", async () => {
    const res = await handleImagesPost(
      new Request("http://localhost/api/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: new ReadableStream({
          start(c) {
            c.error(new Error("raw-secret-marker-abort"));
          },
        }),
        duplex: "half",
      } as RequestInit),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ status: "error", code: "bad_request", message: MSG_BAD_REQUEST });
    expect(JSON.stringify(json)).not.toContain("raw-secret-marker-abort");
  });

  it("still parses a small body and rejects bad JSON with 400", async () => {
    const invalid = await handleImagesPost(post({ kind: "nope" }));
    expect(invalid.status).toBe(400);
    const malformed = await handleImagesPost(
      new Request("http://localhost/api/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json{",
      }),
    );
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ status: "error", code: "bad_request" });
  });

  it("rejects a text/plain cross-site POST with 400 without calling generate", async () => {
    const generate = { generate: vi.fn(async () => new Uint8Array([1, 2, 3])) };
    const res = await handleImagesPost(
      new Request("http://localhost/api/images", {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          Origin: "https://evil.example",
          "Sec-Fetch-Site": "cross-site",
        },
        body: JSON.stringify(passageBody()),
      }),
      { generate },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ status: "error", code: "bad_request" });
    expect(generate.generate).not.toHaveBeenCalled();
  });

  it("rejects an unknown book before env, quota, or spend", async () => {
    for (const k of ALL_ENV) delete process.env[k];
    const fetchSpy = vi.fn().mockRejectedValue(new Error("must not be called"));
    vi.stubGlobal("fetch", fetchSpy);
    const generate = { generate: vi.fn(async () => new Uint8Array([1, 2, 3])) };
    const res = await handleImagesPost(
      post({ kind: "passage", bookId: "nope", textVersion: "t", n: 1 }),
      { generate },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ status: "error", code: "bad_request" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(generate.generate).not.toHaveBeenCalled();
  });

  it("returns generic text when KV throws", async () => {
    for (const k of REQUIRED) process.env[k] = `test-${k}`;
    // A full remote setup, so the Redis path (not the local disk cache) runs.
    process.env.UPSTASH_REDIS_REST_URL = "https://test.example";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("upstash-boom-marker")),
    );
    const res = await handleImagesPost(post(passageBody()));
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json).toMatchObject({ status: "error", code: "unavailable" });
    expect(JSON.stringify(json)).not.toContain("upstash-boom-marker");
  });
});

describe("human gate", () => {
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

  it("blocks without a cookie or token, taking nothing", async () => {
    const { kv, store, generate } = fakes();
    const siteFetch = vi.fn(async () => {
      throw new Error("siteverify must not be called");
    });
    const res = await handleImagesPost(post(passageBody()), {
      env: imgEnv,
      kv,
      store,
      generate,
      fetchFn: siteFetch as unknown as typeof fetch,
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ status: "error", code: "human" });
    expect(siteFetch).not.toHaveBeenCalled();
    expect(await kv.get("img:spend:micro")).toBeNull();
  });

  it("issues human_ok on a valid token, alongside the anon cookie", async () => {
    const { kv, store, generate } = fakes();
    const siteFetch = vi.fn(async () => Response.json({ success: true }));
    const res = await handleImagesPost(passagePost({ ...passageBody(), turnstileToken: "tok" }), {
      env: imgEnv,
      kv,
      store,
      generate,
      fetchFn: siteFetch as unknown as typeof fetch,
    });
    expect(res.status).toBe(200);
    expect(siteFetch).toHaveBeenCalledOnce();
    const setCookies = res.headers.getSetCookie();
    const human = setCookies.find((c) => c.startsWith("human_ok="));
    expect(human).toBeDefined();
    expect(human).toContain("Path=/api");
    expect(setCookies.find((c) => c.startsWith("img_anon="))).toBeDefined();
  });

  it("proceeds with a valid human_ok cookie and no new human cookie", async () => {
    const { kv, store, generate } = fakes();
    const siteFetch = vi.fn(async () => {
      throw new Error("siteverify must not be called");
    });
    const cookie = issueHumanCookie(secret).split(";")[0] as string;
    const res = await handleImagesPost(passagePost(passageBody(), { Cookie: cookie }), {
      env: imgEnv,
      kv,
      store,
      generate,
      fetchFn: siteFetch as unknown as typeof fetch,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ready" });
    expect(siteFetch).not.toHaveBeenCalled();
    expect(res.headers.getSetCookie().find((c) => c.startsWith("human_ok="))).toBeUndefined();
  });

  it("adds bookmap reference details to the passage prompt", async () => {
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
    const res = await handleImagesPost(passagePost(passageBody(), { Cookie: cookie }), {
      env: imgEnv,
      kv,
      store,
      generate,
      fetchFn: siteFetch as unknown as typeof fetch,
    });
    expect(res.status).toBe(200);
    expect(prompt).toContain("Reference details:");
    expect(prompt).toContain("Dorothy:");
  });

  it("serves a ready non-Oz book with its own style line and its own bookmap reference", async () => {
    const { book: alice } = await loadBookData("alice");
    const first = alice.paragraphs[0];
    if (!first) throw new Error("test book has no paragraphs");
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
        { kind: "passage", bookId: "alice", textVersion: alice.textVersion, n: first.n },
        { Cookie: cookie },
      ),
      { env: imgEnv, kv, store, generate, fetchFn: siteFetch as unknown as typeof fetch },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ready" });
    expect(prompt).toContain("Alice's Adventures in Wonderland");
    expect(prompt).not.toContain("Dorothy");
    expect(prompt).not.toContain("silver shoes");
    expect(prompt).toContain("Reference details:");
  });

  it("accepts the legacy chat_human cookie", async () => {
    const { kv, store, generate } = fakes();
    const siteFetch = vi.fn(async () => {
      throw new Error("siteverify must not be called");
    });
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const sig = createHmac("sha256", secret).update(`chat_human:${expiry}`).digest("hex");
    const res = await handleImagesPost(passagePost(passageBody(), { Cookie: `chat_human=${expiry}.${sig}` }), {
      env: imgEnv,
      kv,
      store,
      generate,
      fetchFn: siteFetch as unknown as typeof fetch,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ready" });
    expect(siteFetch).not.toHaveBeenCalled();
  });

  it("serves a cached hit with no cookie or token when a secret is set", async () => {
    const { kv, store, generate } = fakes();
    const siteFetch = vi.fn(async () => {
      throw new Error("siteverify must not be called");
    });
    const cookie = issueHumanCookie(secret).split(";")[0] as string;
    const first = await handleImagesPost(passagePost(passageBody(), { Cookie: cookie }), {
      env: imgEnv,
      kv,
      store,
      generate,
      fetchFn: siteFetch as unknown as typeof fetch,
    });
    expect(first.status).toBe(200);
    const hit = await handleImagesPost(passagePost(passageBody()), {
      env: imgEnv,
      kv,
      store,
      generate,
      fetchFn: siteFetch as unknown as typeof fetch,
    });
    expect(hit.status).toBe(200);
    expect(await hit.json()).toMatchObject({ status: "ready" });
    expect(siteFetch).not.toHaveBeenCalled();
  });
});
