import { describe, expect, it, vi } from "vitest";
import { uploadDailySpendKey } from "@/core/uploads";
import { bookQuotaKeysFor } from "@/server/guard/quota";
import { spendKey } from "@/server/guard/spend";
import { handleUploadsCreate } from "./handler";
import {
  cookiesFrom,
  createMemoryKV,
  helpfulMeta,
  memoryStore,
  postRequest,
  section,
  testEnv,
  tinyBook,
  turnstileFetch,
} from "./test-support";

const DAY = "2026-10-30";
const URL = "https://lectoria.test/api/uploads";

function anonIdOf(cookies: string): string {
  const m = /img_anon=([^;]+)/.exec(cookies);
  return (m?.[1] ?? "").split(".")[0] ?? "";
}

describe("create validation", () => {
  it("rejects cross-site posts", async () => {
    const kv = createMemoryKV();
    const plain = new Request(URL, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(tinyBook()),
    });
    expect((await (await handleUploadsCreate(plain, { env: testEnv(), kv, store: memoryStore(), meta: helpfulMeta() })).json()) as { code: string }).toEqual(
      expect.objectContaining({ status: "error", code: "bad_request" }),
    );
    const foreign = postRequest(URL, tinyBook(), { origin: "https://evil.test" });
    const res = await handleUploadsCreate(foreign, { env: testEnv(), kv, store: memoryStore(), meta: helpfulMeta() });
    expect(res.status).toBe(400);
  });

  it("rejects bad bodies without touching quota", async () => {
    const kv = createMemoryKV();
    const store = memoryStore();
    const res = await handleUploadsCreate(postRequest(URL, { title: "x" }), {
      env: testEnv(),
      kv,
      store,
      meta: helpfulMeta(),
      now: new Date(`${DAY}T00:00:00Z`),
    });
    expect(res.status).toBe(400);
    expect(await kv.get(spendKey())).toBeNull();
    expect(await kv.get(uploadDailySpendKey(DAY))).toBeNull();
  });

  it("rejects books with no chapters", async () => {
    const kv = createMemoryKV();
    const body = { title: "Empty", sections: [{ ...section("s1", "One", 2, 5), linear: false }] };
    const res = await handleUploadsCreate(postRequest(URL, body), {
      env: testEnv(),
      kv,
      store: memoryStore(),
      meta: helpfulMeta(),
      now: new Date(`${DAY}T00:00:00Z`),
    });
    expect(await res.json()).toEqual(expect.objectContaining({ code: "bad_request" }));
    expect(await kv.get(spendKey())).toBeNull();
  });

  it("rejects malformed BYOK headers", async () => {
    const res = await handleUploadsCreate(postRequest(URL, tinyBook(), { "x-byok-key": "short" }), {
      env: testEnv(),
      kv: createMemoryKV(),
      store: memoryStore(),
      meta: helpfulMeta(),
    });
    expect(res.status).toBe(400);
  });
});

describe("create happy path", () => {
  it("creates a free job with quota and spend taken", async () => {
    const kv = createMemoryKV();
    const store = memoryStore();
    const res = await handleUploadsCreate(postRequest(URL, tinyBook(), { "x-real-ip": "1.2.3.4" }), {
      env: testEnv(),
      kv,
      store,
      meta: helpfulMeta(),
      now: new Date(`${DAY}T00:00:00Z`),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string; id: string; chapters: number; parts: number };
    expect(json.status).toBe("created");
    expect(json.chapters).toBe(2);
    expect(json.parts).toBe(2);
    expect(json.id).toMatch(/^u-/);
    // Tiny book: 2 parts, 60 words, so the sized hold hits the 50k floor.
    expect(await kv.get(spendKey())).toBe("50000");
    expect(await kv.get(uploadDailySpendKey(DAY))).toBe("50000");
    const keys = bookQuotaKeysFor({ day: DAY, ip: "1.2.3.4", salt: "ip-salt-for-tests", anonId: anonIdOf(cookiesFrom(res)) });
    expect(await kv.get(keys.ip)).toBe("1");
    expect(await kv.get(keys.anon)).toBe("1");
  });
});

describe("create size limits", () => {
  const long = { title: "Long", sections: [section("s1", "One", 100, 600)] };

  it("sends long free books to BYOK and takes nothing", async () => {
    const kv = createMemoryKV();
    const res = await handleUploadsCreate(postRequest(URL, long), {
      env: testEnv(),
      kv,
      store: memoryStore(),
      meta: helpfulMeta(),
      now: new Date(`${DAY}T00:00:00Z`),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual(expect.objectContaining({ code: "too_long" }));
    expect(await kv.get(spendKey())).toBeNull();
    expect(await kv.get(uploadDailySpendKey(DAY))).toBeNull();
  });

  it("accepts the same book with a key", async () => {
    const res = await handleUploadsCreate(postRequest(URL, long, { "x-byok-key": "byok-key-long-book-1" }), {
      env: testEnv(),
      kv: createMemoryKV(),
      store: memoryStore(),
      meta: helpfulMeta(),
      now: new Date(`${DAY}T00:00:00Z`),
    });
    expect(res.status).toBe(200);
  });
});

describe("create caps", () => {
  it("allows one free book per IP per day", async () => {
    const kv = createMemoryKV();
    const store = memoryStore();
    const deps = { env: testEnv(), kv, store, meta: helpfulMeta(), now: new Date(`${DAY}T00:00:00Z`) };
    const headers = { "x-real-ip": "5.6.7.8" };
    expect((await handleUploadsCreate(postRequest(URL, tinyBook(), headers), deps)).status).toBe(200);
    const second = await handleUploadsCreate(postRequest(URL, tinyBook(), headers), deps);
    expect(second.status).toBe(429);
    expect(await second.json()).toEqual(expect.objectContaining({ code: "daily_books_reached" }));
  });

  it("counts the anon cookie too, whichever hits first", async () => {
    const kv = createMemoryKV();
    const store = memoryStore();
    const deps = { env: testEnv(), kv, store, meta: helpfulMeta(), now: new Date(`${DAY}T00:00:00Z`) };
    const first = await handleUploadsCreate(postRequest(URL, tinyBook(), { "x-real-ip": "9.9.9.1" }), deps);
    expect(first.status).toBe(200);
    const second = await handleUploadsCreate(
      postRequest(URL, tinyBook(), { "x-real-ip": "9.9.9.2", cookie: cookiesFrom(first) }),
      deps,
    );
    expect(second.status).toBe(429);
    expect(await second.json()).toEqual(expect.objectContaining({ code: "daily_books_reached" }));
  });

  it("refuses when the daily upload budget is spent, and refunds quota", async () => {
    const kv = createMemoryKV();
    await kv.incrBy(uploadDailySpendKey(DAY), 1_000_000);
    const res = await handleUploadsCreate(postRequest(URL, tinyBook(), { "x-real-ip": "2.3.4.5" }), {
      env: testEnv(),
      kv,
      store: memoryStore(),
      meta: helpfulMeta(),
      now: new Date(`${DAY}T00:00:00Z`),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual(expect.objectContaining({ code: "daily_budget_reached" }));
    const keys = bookQuotaKeysFor({ day: DAY, ip: "2.3.4.5", salt: "ip-salt-for-tests", anonId: anonIdOf(cookiesFrom(res)) });
    expect(await kv.get(keys.ip)).toBe("0");
    expect(await kv.get(keys.anon)).toBe("0");
    expect(await kv.get(spendKey())).toBe("0");
  });
});

describe("create friend codes", () => {
  const CODE = "maple-river";
  const withCode = (over: Record<string, string> = {}) => ({ ...tinyBook(), friendCode: CODE, ...over });
  const friendEnv = () => testEnv({ friendCodes: [CODE, "lantern-meadow"] });

  it("allows five books with a valid code and refuses the sixth", async () => {
    const kv = createMemoryKV();
    const deps = { env: friendEnv(), kv, store: memoryStore(), meta: helpfulMeta(), now: new Date(`${DAY}T00:00:00Z`) };
    const headers = { "x-real-ip": "6.6.6.6" };
    for (let i = 0; i < 5; i++) {
      const res = await handleUploadsCreate(postRequest(URL, withCode(), headers), deps);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(expect.objectContaining({ status: "created", friendAccepted: true }));
    }
    const sixth = await handleUploadsCreate(postRequest(URL, withCode(), headers), deps);
    expect(sixth.status).toBe(429);
    expect(await sixth.json()).toEqual(expect.objectContaining({ code: "daily_books_reached" }));
  });

  it("keeps the normal one-book quota on a wrong code, without an error", async () => {
    const kv = createMemoryKV();
    const deps = { env: friendEnv(), kv, store: memoryStore(), meta: helpfulMeta(), now: new Date(`${DAY}T00:00:00Z`) };
    const headers = { "x-real-ip": "6.6.6.7" };
    const first = await handleUploadsCreate(postRequest(URL, { ...tinyBook(), friendCode: "not-a-code" }, headers), deps);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual(expect.objectContaining({ status: "created", friendAccepted: false }));
    const second = await handleUploadsCreate(postRequest(URL, { ...tinyBook(), friendCode: "not-a-code" }, headers), deps);
    expect(second.status).toBe(429);
    expect(await second.json()).toEqual(expect.objectContaining({ code: "daily_books_reached" }));
  });

  it("ignores codes when none are configured", async () => {
    const kv = createMemoryKV();
    const deps = { env: testEnv(), kv, store: memoryStore(), meta: helpfulMeta(), now: new Date(`${DAY}T00:00:00Z`) };
    const headers = { "x-real-ip": "6.6.6.8" };
    expect((await handleUploadsCreate(postRequest(URL, withCode(), headers), deps)).status).toBe(200);
    const second = await handleUploadsCreate(postRequest(URL, withCode(), headers), deps);
    expect(second.status).toBe(429);
  });

  it("ignores codes on the BYOK path", async () => {
    const kv = createMemoryKV();
    const deps = { env: friendEnv(), kv, store: memoryStore(), meta: helpfulMeta(), now: new Date(`${DAY}T00:00:00Z`) };
    const res = await handleUploadsCreate(
      postRequest(URL, withCode(), { "x-byok-key": "byok-key-friend-1", "x-real-ip": "6.6.6.9" }),
      deps,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(expect.objectContaining({ status: "created", friendAccepted: false }));
  });

  it("never puts the code in a response body or console output", async () => {
    const kv = createMemoryKV();
    const deps = { env: friendEnv(), kv, store: memoryStore(), meta: helpfulMeta(), now: new Date(`${DAY}T00:00:00Z`) };
    const headers = { "x-real-ip": "6.6.6.10" };
    const warned: unknown[][] = [];
    const errored: unknown[][] = [];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => void warned.push(args));
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void errored.push(args));
    try {
      const bodies: string[] = [];
      bodies.push(JSON.stringify(await (await handleUploadsCreate(postRequest(URL, withCode(), headers), deps)).json()));
      bodies.push(JSON.stringify(await (await handleUploadsCreate(postRequest(URL, withCode(), headers), deps)).json()));
      expect(bodies.join("")).not.toContain(CODE);
      for (const args of [...warned, ...errored]) expect(JSON.stringify(args)).not.toContain(CODE);
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

describe("create judge", () => {
  it("keeps deterministic chapters when the judge fails", async () => {
    const kv = createMemoryKV();
    const meta = helpfulMeta();
    const real = meta.completeJson.bind(meta);
    meta.completeJson = async (input) => {
      if (input.schemaName === "clean_judge") throw new Error("meta down");
      return real(input);
    };
    const res = await handleUploadsCreate(postRequest(URL, tinyBook()), {
      env: testEnv(),
      kv,
      store: memoryStore(),
      meta,
      now: new Date(`${DAY}T00:00:00Z`),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(expect.objectContaining({ status: "created", chapters: 2 }));
  });
});

describe("create refunds and BYOK", () => {
  it("refunds spend and quota exactly once when Blob fails", async () => {
    const kv = createMemoryKV();
    const store = memoryStore();
    store.saveJson = async () => {
      throw new Error("blob down");
    };
    const res = await handleUploadsCreate(postRequest(URL, tinyBook(), { "x-real-ip": "3.4.5.6" }), {
      env: testEnv(),
      kv,
      store,
      meta: helpfulMeta(),
      now: new Date(`${DAY}T00:00:00Z`),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual(expect.objectContaining({ code: "unavailable" }));
    expect(await kv.get(spendKey())).toBe("0");
    expect(await kv.get(uploadDailySpendKey(DAY))).toBe("0");
    const keys = bookQuotaKeysFor({ day: DAY, ip: "3.4.5.6", salt: "ip-salt-for-tests", anonId: anonIdOf(cookiesFrom(res)) });
    expect(await kv.get(keys.ip)).toBe("0");
    expect(await kv.get(keys.anon)).toBe("0");
  });

  it("takes BYOK quota but no spend, and never stores the key", async () => {
    const kv = createMemoryKV();
    const store = memoryStore();
    const key = "byok-secret-never-stored-001";
    const deps = { env: testEnv(), kv, store, meta: helpfulMeta(), now: new Date(`${DAY}T00:00:00Z`) };
    for (let i = 0; i < 3; i++) {
      const res = await handleUploadsCreate(postRequest(URL, tinyBook(), { "x-byok-key": key, "x-real-ip": "7.7.7.7" }), deps);
      expect(res.status).toBe(200);
      const json = (await res.json()) as { id: string };
      const job = await kv.get(`upload:job:${json.id}`);
      expect(job).not.toContain(key);
    }
    expect(await kv.get(spendKey())).toBeNull();
    expect(await kv.get(uploadDailySpendKey(DAY))).toBeNull();
    const keys = bookQuotaKeysFor({ day: DAY, ip: "7.7.7.7", salt: "ip-salt-for-tests", anonId: "nope", prefix: "upload:byok" });
    expect(await kv.get(keys.ip)).toBe("3");
    for (const write of store.writes) {
      expect(write.json).not.toContain(key);
      expect(write.path).not.toContain(key);
    }
  });

  it("caps BYOK creates at ten per IP per day", async () => {
    const kv = createMemoryKV();
    const deps = { env: testEnv(), kv, store: memoryStore(), meta: helpfulMeta(), now: new Date(`${DAY}T00:00:00Z`) };
    const headers = { "x-byok-key": "byok-key-ten-a-day-1", "x-real-ip": "8.8.8.8" };
    for (let i = 0; i < 10; i++) {
      expect((await handleUploadsCreate(postRequest(URL, tinyBook(), headers), deps)).status).toBe(200);
    }
    const over = await handleUploadsCreate(postRequest(URL, tinyBook(), headers), deps);
    expect(over.status).toBe(429);
    expect(await over.json()).toEqual(expect.objectContaining({ code: "daily_books_reached" }));
  });

  it("refunds BYOK quota when Blob fails", async () => {
    const kv = createMemoryKV();
    const store = memoryStore();
    store.saveJson = async () => {
      throw new Error("blob down");
    };
    const res = await handleUploadsCreate(
      postRequest(URL, tinyBook(), { "x-byok-key": "test byok refund", "x-real-ip": "3.4.5.7" }),
      { env: testEnv(), kv, store, meta: helpfulMeta(), now: new Date(`${DAY}T00:00:00Z`) },
    );
    expect(res.status).toBe(503);
    const keys = bookQuotaKeysFor({ day: DAY, ip: "3.4.5.7", salt: "ip-salt-for-tests", anonId: anonIdOf(cookiesFrom(res)), prefix: "upload:byok" });
    expect(await kv.get(keys.ip)).toBe("0");
    expect(await kv.get(keys.anon)).toBe("0");
  });
});

describe("create human check", () => {
  const gated = () => testEnv({ turnstileSecret: "ts-secret", turnstileSiteKey: "ts-site" });

  it("requires a passing check when Turnstile is configured", async () => {
    const res = await handleUploadsCreate(postRequest(URL, { ...tinyBook(), turnstileToken: "tok" }), {
      env: gated(),
      kv: createMemoryKV(),
      store: memoryStore(),
      meta: helpfulMeta(),
      fetchFn: turnstileFetch(false),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(expect.objectContaining({ code: "human_required" }));
  });

  it("issues the human cookie on a pass", async () => {
    const res = await handleUploadsCreate(postRequest(URL, { ...tinyBook(), turnstileToken: "tok" }), {
      env: gated(),
      kv: createMemoryKV(),
      store: memoryStore(),
      meta: helpfulMeta(),
      fetchFn: turnstileFetch(true),
    });
    expect(res.status).toBe(200);
    expect(cookiesFrom(res)).toContain("human_ok=");
  });
});
