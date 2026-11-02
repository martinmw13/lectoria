import { describe, expect, it } from "vitest";
import { readFriendCodeEnv, readUploadEnv } from "./env";

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

describe("readFriendCodeEnv", () => {
  it("needs no blob store or Meta key", () => {
    const env = readFriendCodeEnv({
      NODE_ENV: "test",
      KV_REST_API_URL: "https://kv.test",
      KV_REST_API_TOKEN: "kv-token",
      SESSION_SECRET: "session-secret",
      IP_HASH_SALT: "ip-salt",
      LECTORIA_FRIEND_CODES: "maple",
    });
    expect(env.friendCodes).toEqual(["maple"]);
    expect(env.upstashUrl).toBe("https://kv.test");
  });

  it("names what is missing without values", () => {
    expect(() => readFriendCodeEnv({ NODE_ENV: "test", SESSION_SECRET: "s" })).toThrow(
      /KV_REST_API_URL.*KV_REST_API_TOKEN.*IP_HASH_SALT/,
    );
  });
});
