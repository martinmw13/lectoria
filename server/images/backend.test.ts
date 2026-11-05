import { describe, expect, it } from "vitest";
import { readImageBackend as readFrom } from "./backend";

// Test env objects; NODE_ENV is irrelevant here.
const readImageBackend = (o: Record<string, string>) => readFrom(o as NodeJS.ProcessEnv);

const LOCAL = {
  META_API_KEY: "test-meta",
  SESSION_SECRET: "test-session",
  IP_HASH_SALT: "test-salt",
  LECTORIA_IMAGE_CACHE_DIR: "/tmp/lectoria-test-cache",
};
const REMOTE = {
  ...LOCAL,
  BLOB_READ_WRITE_TOKEN: "test-blob",
  UPSTASH_REDIS_REST_URL: "https://kv.example",
  UPSTASH_REDIS_REST_TOKEN: "test-kv",
};

describe("readImageBackend", () => {
  it("uses the disk cache off Vercel when Blob and KV are not configured", () => {
    const b = readImageBackend({ ...LOCAL });
    expect(b.mode).toBe("local");
    if (b.mode === "local") {
      expect(b.dir).toBe("/tmp/lectoria-test-cache");
      expect(b.env.metaKey).toBe("test-meta");
    }
  });

  it("uses the disk cache when only part of the remote setup is present", () => {
    expect(readImageBackend({ ...REMOTE, BLOB_READ_WRITE_TOKEN: "" }).mode).toBe("local");
    expect(readImageBackend({ ...REMOTE, UPSTASH_REDIS_REST_URL: "http://kv.example" }).mode).toBe("local");
    expect(readImageBackend({ ...REMOTE, BLOB_READ_WRITE_TOKEN: "[SENSITIVE]" }).mode).toBe("local");
  });

  it("keeps Blob and Redis off Vercel when they are fully configured", () => {
    const b = readImageBackend({ ...REMOTE });
    expect(b.mode).toBe("remote");
    expect(b.env.upstashUrl).toBe("https://kv.example");
  });

  it("forces the disk cache with LECTORIA_LOCAL_IMAGE_CACHE=1 off Vercel", () => {
    expect(readImageBackend({ ...REMOTE, LECTORIA_LOCAL_IMAGE_CACHE: "1" }).mode).toBe("local");
  });

  it("never picks the disk cache on Vercel", () => {
    expect(() => readImageBackend({ ...LOCAL, VERCEL: "1" })).toThrow(/missing image env:.*BLOB_READ_WRITE_TOKEN/);
    expect(readImageBackend({ ...REMOTE, VERCEL: "1", LECTORIA_LOCAL_IMAGE_CACHE: "1" }).mode).toBe("remote");
  });

  it("still reports missing names when the local keys are absent too", () => {
    expect(() => readImageBackend({})).toThrow(/missing image env:.*META_API_KEY/);
  });
});
