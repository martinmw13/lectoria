import { describe, expect, it, vi } from "vitest";
import { createMemoryKV } from "@/core/images";
import type { KV } from "@/core/types";
import {
  BOOK_QUOTA_TTL_SEC,
  BYOK_UPLOADS_PER_PERSON,
  FREE_BOOKS_PER_PERSON,
  FRIEND_BOOKS_PER_PERSON,
  FRIEND_WRONG_GUESSES_PER_DAY,
  acceptFriendCode,
  judgeFriendCode,
  bookQuotaKeysFor,
  checkBookQuota,
  friendGuessKeyFor,
  matchFriendCode,
  parseFriendCodes,
  refundBookQuota,
  refundDualQuota,
  takeDualQuota,
} from "./quota";

const KEYS = { ip: "q:ip:x", anon: "q:anon:x" };

function throwingKV(kv: KV, on: "decr" | "decrBy"): KV {
  return {
    ...kv,
    decr: on === "decr" ? async () => { throw new Error("redis down"); } : kv.decr.bind(kv),
    decrBy: on === "decrBy" ? async () => { throw new Error("redis down"); } : kv.decrBy.bind(kv),
  };
}

describe("takeDualQuota", () => {
  it("counts both keys and reports counts", async () => {
    const kv = createMemoryKV();
    expect(await takeDualQuota(kv, KEYS, { limit: 5, ttlSec: 60 })).toEqual({
      ok: true,
      ipCount: 1,
      anonCount: 1,
    });
    expect(await takeDualQuota(kv, KEYS, { limit: 5, ttlSec: 60 })).toEqual({
      ok: true,
      ipCount: 2,
      anonCount: 2,
    });
  });

  it("refuses when either key runs out and refunds both", async () => {
    const kv = createMemoryKV();
    expect((await takeDualQuota(kv, KEYS, { limit: 2, ttlSec: 60 })).ok).toBe(true);
    expect((await takeDualQuota(kv, KEYS, { limit: 2, ttlSec: 60 })).ok).toBe(true);
    expect(await takeDualQuota(kv, KEYS, { limit: 2, ttlSec: 60 })).toEqual({ ok: false });
    // Both increments were compensated, so a fresh pair still works.
    expect((await takeDualQuota(kv, { ip: "i2", anon: "a2" }, { limit: 2, ttlSec: 60 })).ok).toBe(true);
    expect(Number(await kv.get(KEYS.ip))).toBe(2);
    expect(Number(await kv.get(KEYS.anon))).toBe(2);
  });

  it("refuses on the anon key while IPs stay fresh", async () => {
    const kv = createMemoryKV();
    const anon = "shared-anon";
    expect((await takeDualQuota(kv, { ip: "ip-1", anon }, { limit: 1, ttlSec: 60 })).ok).toBe(true);
    expect(await takeDualQuota(kv, { ip: "ip-2", anon }, { limit: 1, ttlSec: 60 })).toEqual({
      ok: false,
    });
  });

  it("refreshes both expiries with the given TTL", async () => {
    const kv = createMemoryKV();
    const expire = vi.spyOn(kv, "expire");
    await takeDualQuota(kv, KEYS, { limit: 5, ttlSec: 172800 });
    expect(expire).toHaveBeenCalledWith(KEYS.ip, 172800);
    expect(expire).toHaveBeenCalledWith(KEYS.anon, 172800);
  });

  it("never throws from the over-limit compensation when Redis fails", async () => {
    const kv = throwingKV(createMemoryKV(), "decr");
    await expect(takeDualQuota(kv, KEYS, { limit: 0, ttlSec: 60 })).resolves.toEqual({
      ok: false,
    });
  });

  it("gives back the ip increment when the anon increment times out", async () => {
    const kv = createMemoryKV();
    const failing: KV = {
      ...kv,
      incr: async (key: string) => {
        if (key === KEYS.anon) throw new DOMException("signal timed out", "TimeoutError");
        return kv.incr(key);
      },
    };
    await expect(takeDualQuota(failing, KEYS, { limit: 5, ttlSec: 60 })).rejects.toThrow();
    expect(await kv.get(KEYS.ip)).toBe("0");
    expect(await kv.get(KEYS.anon)).toBeNull();
  });
});

describe("refundDualQuota", () => {
  it("gives back both counters", async () => {
    const kv = createMemoryKV();
    await takeDualQuota(kv, KEYS, { limit: 5, ttlSec: 60 });
    await refundDualQuota(kv, KEYS);
    expect(Number(await kv.get(KEYS.ip))).toBe(0);
    expect(Number(await kv.get(KEYS.anon))).toBe(0);
  });

  it("never throws when Redis fails", async () => {
    const kv = throwingKV(createMemoryKV(), "decr");
    await expect(refundDualQuota(kv, KEYS)).resolves.toBeUndefined();
  });
});

describe("free book quota", () => {
  const SALT = "test-salt";
  const DAY = "2026-10-30";

  it("allows one book a day", async () => {
    const kv = createMemoryKV();
    const keys = bookQuotaKeysFor({ day: DAY, ip: "1.2.3.4", salt: SALT, anonId: "anon-1" });
    expect(await checkBookQuota(kv, keys)).toEqual({ ok: true });
    expect(await checkBookQuota(kv, keys)).toEqual({ ok: false });
  });

  it("blocks a second book on a new cookie from the same IP", async () => {
    const kv = createMemoryKV();
    const first = bookQuotaKeysFor({ day: DAY, ip: "1.2.3.4", salt: SALT, anonId: "anon-1" });
    expect(await checkBookQuota(kv, first)).toEqual({ ok: true });
    const second = bookQuotaKeysFor({ day: DAY, ip: "1.2.3.4", salt: SALT, anonId: "anon-2" });
    expect(await checkBookQuota(kv, second)).toEqual({ ok: false });
  });

  it("blocks a second book on a new IP with the same cookie", async () => {
    const kv = createMemoryKV();
    const first = bookQuotaKeysFor({ day: DAY, ip: "1.2.3.4", salt: SALT, anonId: "anon-1" });
    expect(await checkBookQuota(kv, first)).toEqual({ ok: true });
    const second = bookQuotaKeysFor({ day: DAY, ip: "9.9.9.9", salt: SALT, anonId: "anon-1" });
    expect(await checkBookQuota(kv, second)).toEqual({ ok: false });
  });

  it("starts fresh the next day", async () => {
    const kv = createMemoryKV();
    const today = bookQuotaKeysFor({ day: DAY, ip: "1.2.3.4", salt: SALT, anonId: "anon-1" });
    expect(await checkBookQuota(kv, today)).toEqual({ ok: true });
    expect(await checkBookQuota(kv, today)).toEqual({ ok: false });
    const tomorrow = bookQuotaKeysFor({ day: "2026-10-31", ip: "1.2.3.4", salt: SALT, anonId: "anon-1" });
    expect(await checkBookQuota(kv, tomorrow)).toEqual({ ok: true });
  });

  it("allows a retry after a refund", async () => {
    const kv = createMemoryKV();
    const keys = bookQuotaKeysFor({ day: DAY, ip: "1.2.3.4", salt: SALT, anonId: "anon-1" });
    expect(await checkBookQuota(kv, keys)).toEqual({ ok: true });
    await refundBookQuota(kv, keys);
    expect(await checkBookQuota(kv, keys)).toEqual({ ok: true });
  });

  it("never throws the refund when Redis fails", async () => {
    const kv = throwingKV(createMemoryKV(), "decr");
    await expect(refundBookQuota(kv, KEYS)).resolves.toBeUndefined();
  });

  it("caps one free book per person per day", () => {
    expect(FREE_BOOKS_PER_PERSON).toBe(1);
    expect(FRIEND_BOOKS_PER_PERSON).toBe(5);
    expect(BYOK_UPLOADS_PER_PERSON).toBe(10);
    expect(BOOK_QUOTA_TTL_SEC).toBe(48 * 3600);
  });

  it("keeps a separate bucket under a distinct prefix", () => {
    const keys = bookQuotaKeysFor({ day: DAY, ip: "1.2.3.4", salt: SALT, anonId: "anon-1", prefix: "upload:byok" });
    expect(keys.ip.startsWith("upload:byok:ip:")).toBe(true);
    expect(keys.anon.startsWith("upload:byok:anon:")).toBe(true);
  });
});

describe("friend codes", () => {
  const SALT = "test-salt";
  const DAY = "2026-10-30";
  const CODES = ["maple", "river-lantern"];
  const guessKey = (anonId = "anon-1"): string =>
    friendGuessKeyFor({ day: DAY, ip: "1.2.3.4", salt: SALT, anonId });

  it("parses comma-separated codes, trims, and drops empties", () => {
    expect(parseFriendCodes(undefined)).toEqual([]);
    expect(parseFriendCodes("")).toEqual([]);
    expect(parseFriendCodes("  , ,")).toEqual([]);
    expect(parseFriendCodes(" maple ,, river-lantern ")).toEqual(["maple", "river-lantern"]);
  });

  it("matches any of several codes, nothing else", () => {
    expect(matchFriendCode("maple", CODES)).toBe(true);
    expect(matchFriendCode("river-lantern", CODES)).toBe(true);
    expect(matchFriendCode("Maple", CODES)).toBe(false);
    expect(matchFriendCode("maple ", CODES)).toBe(false);
    expect(matchFriendCode("", CODES)).toBe(false);
    expect(matchFriendCode("maple", [])).toBe(false);
  });

  it("accepts a valid code without spending the guess budget", async () => {
    const kv = createMemoryKV();
    expect(await acceptFriendCode(kv, "maple", CODES, guessKey())).toBe(true);
    expect(Number(await kv.get(guessKey()))).toBe(0);
  });

  it("ignores codes when none are configured", async () => {
    const kv = createMemoryKV();
    expect(await acceptFriendCode(kv, "maple", [], guessKey())).toBe(false);
  });

  it("rejects missing, blank, and over-long codes without counting a guess", async () => {
    const kv = createMemoryKV();
    for (const submitted of [undefined, null, 42, "", "   ", "x".repeat(65)]) {
      expect(await acceptFriendCode(kv, submitted, CODES, guessKey())).toBe(false);
    }
    expect(await kv.get(guessKey())).toBeNull();
  });

  it("counts wrong guesses and then stops checking for the day", async () => {
    expect(FRIEND_WRONG_GUESSES_PER_DAY).toBe(10);
    const kv = createMemoryKV();
    for (let i = 0; i < FRIEND_WRONG_GUESSES_PER_DAY; i++) {
      expect(await acceptFriendCode(kv, `nope-${i}`, CODES, guessKey())).toBe(false);
    }
    expect(Number(await kv.get(guessKey()))).toBe(FRIEND_WRONG_GUESSES_PER_DAY);
    // Even the right code is no longer checked once the budget is spent.
    expect(await acceptFriendCode(kv, "maple", CODES, guessKey())).toBe(false);
  });

  it("treats Redis failure as no code, never an error", async () => {
    const kv = createMemoryKV();
    const failing: KV = { ...kv, incr: async () => { throw new Error("redis down"); } };
    await expect(acceptFriendCode(failing, "maple", CODES, guessKey())).resolves.toBe(false);
    await expect(judgeFriendCode(failing, "maple", CODES, guessKey())).resolves.toBe("unavailable");
  });

  it("counts parallel guesses atomically, so a burst cannot pass the limit", async () => {
    const kv = createMemoryKV();
    // Every guess reads the same count under the old get-then-incr; now
    // each takes its own number, and only the first ten are judged.
    const verdicts = await Promise.all(
      Array.from({ length: 30 }, (_, i) => judgeFriendCode(kv, i === 29 ? "maple" : `nope-${i}`, CODES, guessKey())),
    );
    expect(verdicts.filter((v) => v === "ok")).toEqual([]);
    expect(Number(await kv.get(guessKey()))).toBe(30);
  });

  it("does not count a right code toward the limit", async () => {
    const kv = createMemoryKV();
    for (let i = 0; i < FRIEND_WRONG_GUESSES_PER_DAY - 1; i++) {
      await acceptFriendCode(kv, `nope-${i}`, CODES, guessKey());
    }
    for (let i = 0; i < 3; i++) expect(await acceptFriendCode(kv, "maple", CODES, guessKey())).toBe(true);
    expect(Number(await kv.get(guessKey()))).toBe(FRIEND_WRONG_GUESSES_PER_DAY - 1);
  });
});
