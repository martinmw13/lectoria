import { describe, expect, it } from "vitest";
import { readUploadEnv } from "./env";

const FULL: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  UPSTASH_REDIS_REST_URL: "https://upstash.test",
  UPSTASH_REDIS_REST_TOKEN: "upstash-token",
  UPLOADS_BLOB_READ_WRITE_TOKEN: "uploads-token",
  META_API_KEY: "owner-meta-key",
  SESSION_SECRET: "session-secret",
  IP_HASH_SALT: "ip-salt",
};

describe("readUploadEnv", () => {
  it("reads the private uploads token", () => {
    expect(readUploadEnv({ ...FULL }).uploadsToken).toBe("uploads-token");
  });

  it("names the missing uploads token", () => {
    expect(() => readUploadEnv({ ...FULL, UPLOADS_BLOB_READ_WRITE_TOKEN: undefined })).toThrow(
      "UPLOADS_BLOB_READ_WRITE_TOKEN",
    );
  });

  it("rejects placeholder tokens", () => {
    expect(() => readUploadEnv({ ...FULL, UPLOADS_BLOB_READ_WRITE_TOKEN: "[SENSITIVE]" })).toThrow(
      "UPLOADS_BLOB_READ_WRITE_TOKEN",
    );
  });

  it("needs no public image token", () => {
    expect(() => readUploadEnv({ ...FULL })).not.toThrow();
  });

  it("parses friend codes, off when unset", () => {
    expect(readUploadEnv({ ...FULL }).friendCodes).toEqual([]);
    expect(readUploadEnv({ ...FULL, LECTORIA_FRIEND_CODES: "  , ," }).friendCodes).toEqual([]);
    expect(readUploadEnv({ ...FULL, LECTORIA_FRIEND_CODES: " maple ,, river " }).friendCodes).toEqual([
      "maple",
      "river",
    ]);
  });
});
