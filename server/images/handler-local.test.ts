import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryKV } from "@/core/images";
import { loadBookData } from "@/server/books";
import { handleImagesPost } from "./handler";
import { handleLocalImageGet } from "./local-cache";

// Localhost without Blob/KV: pictures come back from the disk cache across
// restarts (a fresh KV each call) and never call the generator twice.
const { book: ozBook } = await loadBookData("oz");

const NAMES = [
  "VERCEL",
  "LECTORIA_IMAGE_CACHE_DIR",
  "LECTORIA_LOCAL_IMAGE_CACHE",
  "BLOB_READ_WRITE_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "META_API_KEY",
  "SESSION_SECRET",
  "IP_HASH_SALT",
  "TURNSTILE_SECRET_KEY",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
] as const;

let saved: Record<string, string | undefined>;
let dir: string;

beforeEach(async () => {
  saved = {};
  for (const k of NAMES) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  dir = await mkdtemp(join(tmpdir(), "lectoria-handler-"));
  process.env.LECTORIA_IMAGE_CACHE_DIR = dir;
  process.env.META_API_KEY = "test-meta";
  process.env.SESSION_SECRET = "test-session";
  process.env.IP_HASH_SALT = "test-salt";
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  for (const k of NAMES) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});

function post(style: string): Request {
  const first = ozBook.paragraphs[0];
  if (!first) throw new Error("test book has no paragraphs");
  return new Request("http://localhost/api/images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "passage",
      bookId: ozBook.id,
      textVersion: ozBook.textVersion,
      n: first.n,
      style: { preset: style },
    }),
  });
}

describe("handleImagesPost local disk cache", () => {
  it("generates once, then serves the same book+scene+style from disk after a restart", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("no network in local mode"));
    vi.stubGlobal("fetch", fetchSpy);
    const bytes = new Uint8Array([82, 73, 70, 70, 9]);
    const generate = { generate: vi.fn(async () => bytes) };

    const first = await handleImagesPost(post("pencil"), { generate });
    const a = (await first.json()) as { status: string; url: string; cached: boolean };
    expect(a).toMatchObject({ status: "ready", cached: false });
    expect(a.url).toMatch(/^\/api\/images\/local\/[0-9a-f]{64}\.webp$/);

    // Fresh KV: only the disk survives, like a rebuilt localhost server.
    const second = await handleImagesPost(post("pencil"), { generate, kv: createMemoryKV() });
    expect(await second.json()).toMatchObject({ status: "ready", cached: true, url: a.url });
    expect(generate.generate).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();

    const name = a.url.split("/").pop() ?? "";
    const served = await handleLocalImageGet(name);
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(bytes);
  });

  it("generates again for a different style", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no network")));
    const generate = { generate: vi.fn(async () => new Uint8Array([1])) };
    await handleImagesPost(post("pencil"), { generate, kv: createMemoryKV() });
    const other = await handleImagesPost(post("anime"), { generate, kv: createMemoryKV() });
    expect(await other.json()).toMatchObject({ status: "ready", cached: false });
    expect(generate.generate).toHaveBeenCalledTimes(2);
  });

  it("on Vercel without Blob/KV stays unavailable and never touches disk", async () => {
    process.env.VERCEL = "1";
    const generate = { generate: vi.fn(async () => new Uint8Array([1])) };
    const res = await handleImagesPost(post("pencil"), { generate });
    expect(res.status).toBe(503);
    expect(generate.generate).not.toHaveBeenCalled();
  });
});
