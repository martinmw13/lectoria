// Who pays decides the quota: the reader's own key skips the daily free
// picture quota, local development skips it, and production never does.
// The reader's key is used for that request only and never surfaces.
import { afterEach, describe, expect, it, vi } from "vitest";
import { MSG_BYOK_IMAGES, MSG_QUOTA, createMemoryKV } from "@/core/images";
import type { ImageGenerator } from "@/core/images";
import { BYOK_HEADER } from "@/core/chat";
import { loadBookData } from "@/server/books";
import { localQuotaExempt } from "./env";
import { handleImagesPost } from "./handler";
import { orchestrate } from "./orchestrate";
import { MetaImageError } from "./meta";
import { deps, env, passage } from "./orchestrate-fixtures";

const { book: oz } = await loadBookData("oz");
const KEY = "reader-own-meta-key-canary-123";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function body(i: number) {
  const p = oz.paragraphs[i];
  if (!p) throw new Error("no paragraph");
  return { kind: "passage", bookId: oz.id, textVersion: oz.textVersion, n: p.n };
}

function post(b: unknown, key?: string): Request {
  return new Request("https://lectoria.example/api/images", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "5.6.7.8",
      ...(key ? { [BYOK_HEADER]: key } : {}),
    },
    body: JSON.stringify(b),
  });
}

function fakeMetaFetch(status = 200) {
  const fn = vi.fn(async (_url: unknown, _init?: RequestInit) =>
    status === 200
      ? Response.json({ data: [{ b64_json: Buffer.from([1, 2, 3]).toString("base64") }] })
      : Response.json({ error: { code: "invalid_key", message: `bad key ${KEY}` } }, { status }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("localQuotaExempt", () => {
  it("is true only for next dev off Vercel", () => {
    expect(localQuotaExempt({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("is false in production, on any Vercel deploy, and for non-dev builds", () => {
    const cases: Record<string, string>[] = [
      { NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "production" },
      { NODE_ENV: "development", VERCEL: "1", VERCEL_ENV: "production" },
      { NODE_ENV: "development", VERCEL_ENV: "production" },
      { NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "preview" },
      { NODE_ENV: "production" },
      { NODE_ENV: "test" },
    ];
    for (const c of cases) expect(localQuotaExempt(c as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("daily picture quota", () => {
  it("production (no exemption, our key) still stops at five", async () => {
    const d = deps({ skipQuota: false });
    for (let i = 0; i < 5; i++) expect((await orchestrate({ ...passage, n: 600 + i }, d)).status).toBe("ready");
    expect(await orchestrate({ ...passage, n: 605 }, d)).toEqual({ status: "error", code: "quota", message: MSG_QUOTA });
  });

  it("local development skips it", async () => {
    const d = deps({ skipQuota: true });
    for (let i = 0; i < 8; i++) expect((await orchestrate({ ...passage, n: 700 + i }, d)).status).toBe("ready");
  });

  it("the reader's own key skips it, even after the free five are used", async () => {
    const d = deps();
    for (let i = 0; i < 5; i++) await orchestrate({ ...passage, n: 800 + i }, d);
    expect((await orchestrate({ ...passage, n: 805 }, d)).status).toBe("error");
    expect((await orchestrate({ ...passage, n: 805 }, { ...d, byok: true })).status).toBe("ready");
  });

  it("a refused reader key gets a fixed message, not the provider's", async () => {
    const generate: ImageGenerator = {
      generate: async () => {
        throw new MetaImageError(401, `"bad key ${KEY}"`);
      },
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await orchestrate(passage, deps({ byok: true, generate }));
    expect(res).toEqual({ status: "error", code: "byok_invalid", message: MSG_BYOK_IMAGES });
  });
});

describe("handler with a reader key", () => {
  it("bills the reader's key past the quota and never echoes or logs it", async () => {
    const meta = fakeMetaFetch();
    const logs = [vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "log"), vi.spyOn(console, "info")];
    const kv = createMemoryKV();
    const files = new Map<string, Uint8Array>();
    const store = {
      findUrl: async (p: string) => (files.has(p) ? `https://blob.example/${p}` : null),
      save: async (p: string, b: Uint8Array) => {
        files.set(p, b);
        return `https://blob.example/${p}`;
      },
    };
    const base = { env, kv, store, quotaExempt: false };
    // Our five, then the sixth is refused without a key.
    for (let i = 0; i < 5; i++) {
      const res = await handleImagesPost(post(body(i)), { ...base, generate: { generate: async () => new Uint8Array([1]) } });
      expect(res.status).toBe(200);
    }
    const refused = await handleImagesPost(post(body(5)), { ...base, generate: { generate: async () => new Uint8Array([1]) } });
    expect(refused.status).toBe(429);

    const res = await handleImagesPost(post(body(5), KEY), base);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(KEY);
    expect(res.headers.get("set-cookie") ?? "").not.toContain(KEY);
    const init = meta.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${KEY}`);
    for (const spy of logs) for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(KEY);
    // Nothing about the key is kept server-side.
    for (const [, bytes] of files) expect(Buffer.from(bytes).toString()).not.toContain(KEY);
  });

  it("a key without image access answers the fixed message, without the key or provider text", async () => {
    fakeMetaFetch(401);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handleImagesPost(post(body(9), KEY), { env, kv: createMemoryKV(), store: { findUrl: async () => null, save: async () => "x" }, quotaExempt: false });
    const json = (await res.json()) as { code: string; message: string };
    expect(json).toEqual({ status: "error", code: "byok_invalid", message: MSG_BYOK_IMAGES });
    for (const call of errors.mock.calls) expect(JSON.stringify(call)).not.toContain(KEY);
  });
});
