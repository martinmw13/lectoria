// Instant friend-code check: ok only for a valid code, wrong guesses count
// against the daily limiter, and the code never appears in a response.
import { describe, expect, it } from "vitest";
import { friendGuessKeyFor } from "@/server/guard/quota";
import { handleFriendCodeCheck } from "./friend-code";
import { cookiesFrom, createMemoryKV, postRequest, testEnv } from "./test-support";

const URL = "https://lectoria.test/api/uploads/friend-code";
const CODE = "maple-river-zz9";
const IP = "9.9.9.9";
const SALT = "ip-salt-for-tests";

const withCodes = () => testEnv({ friendCodes: [CODE] });

function anonIdOf(cookies: string): string {
  return (cookies.match(/img_anon=([^;]+)/)?.[1] ?? "").split(".")[0] ?? "";
}

function dayOf(): string {
  return new Date().toISOString().slice(0, 10);
}

describe("friend-code check", () => {
  it("accepts a valid code without echoing it", async () => {
    const kv = createMemoryKV();
    const res = await handleFriendCodeCheck(postRequest(URL, { code: CODE }, { "x-real-ip": IP }), {
      env: withCodes(),
      kv,
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true });
    expect(text).not.toContain(CODE);
    expect(cookiesFrom(res)).toContain("img_anon=");
  });

  it("rejects a wrong code and counts the guess", async () => {
    const kv = createMemoryKV();
    const res = await handleFriendCodeCheck(postRequest(URL, { code: "nope" }, { "x-real-ip": IP }), {
      env: withCodes(),
      kv,
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: false });
    expect(text).not.toContain(CODE);
    const key = friendGuessKeyFor({ day: dayOf(), ip: IP, salt: SALT, anonId: anonIdOf(cookiesFrom(res)) });
    expect(await kv.get(key)).toBe("1");
  });

  it("blocks even the valid code after 10 wrong guesses", async () => {
    const kv = createMemoryKV();
    const deps = { env: withCodes(), kv };
    let jar = "";
    for (let i = 0; i < 10; i++) {
      const res = await handleFriendCodeCheck(postRequest(URL, { code: `wrong-${i}` }, { "x-real-ip": IP, ...(jar ? { cookie: jar } : {}) }), deps);
      expect(res.status).toBe(200);
      jar = cookiesFrom(res, jar);
    }
    const res = await handleFriendCodeCheck(postRequest(URL, { code: CODE }, { "x-real-ip": IP, cookie: jar }), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false });
  });

  it("answers 400 for bad JSON, non-string codes, and cross-site posts", async () => {
    const kv = createMemoryKV();
    const deps = { env: withCodes(), kv };
    const bodies: Array<[string, Request]> = [
      ["bad json", postRequest(URL, "not json{", { "x-real-ip": IP })],
      ["non-string", postRequest(URL, { code: 42 }, { "x-real-ip": IP })],
      ["missing", postRequest(URL, {}, { "x-real-ip": IP })],
      ["extra", postRequest(URL, { code: CODE, other: 1 }, { "x-real-ip": IP })],
    ];
    for (const [label, req] of bodies) {
      const res = await handleFriendCodeCheck(req, deps);
      expect(res.status, label).toBe(400);
      expect(await res.json()).toEqual({ ok: false });
    }
    const plain = new Request(URL, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ code: CODE }),
    });
    const cross = await handleFriendCodeCheck(plain, deps);
    expect(cross.status).toBe(400);
    expect(await cross.json()).toEqual({ ok: false });
  });

  it("answers false when the feature is off", async () => {
    const kv = createMemoryKV();
    const res = await handleFriendCodeCheck(postRequest(URL, { code: CODE }, { "x-real-ip": IP }), {
      env: testEnv({ friendCodes: [] }),
      kv,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false });
  });
});

describe("friend-code check env", () => {
  it("works without the uploads blob token or Meta key", async () => {
    const saved = { ...process.env };
    try {
      for (const k of ["UPLOADS_BLOB_READ_WRITE_TOKEN", "META_API_KEY", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) delete process.env[k];
      Object.assign(process.env, {
        KV_REST_API_URL: "https://kv.test",
        KV_REST_API_TOKEN: "kv-token",
        SESSION_SECRET: "session-secret",
        IP_HASH_SALT: SALT,
        LECTORIA_FRIEND_CODES: CODE,
      });
      const res = await handleFriendCodeCheck(postRequest(URL, { code: CODE }, { "x-real-ip": IP }), {
        kv: createMemoryKV(),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    } finally {
      process.env = saved;
    }
  });

  it("answers 503 when the KV store fails", async () => {
    const broken = createMemoryKV();
    broken.incr = async () => {
      throw new Error("kv down");
    };
    const res = await handleFriendCodeCheck(postRequest(URL, { code: CODE }, { "x-real-ip": IP }), {
      env: withCodes(),
      kv: broken,
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
  });
});
