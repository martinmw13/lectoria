import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import type { KV } from "@/core/types";
import { FRIEND_CODE_MAX_LEN } from "@/core/uploads";
import { hashIp, ipBucket } from "./request";

// Per-person quota, counted by hashed IP and by the anonymous
// cookie, whichever runs out first. Day keys are UTC dates.
export const CHAT_QUOTA_TTL_SEC = 48 * 3600;

export interface DualKeys {
  ip: string;
  anon: string;
}

export async function takeDualQuota(
  kv: KV,
  keys: DualKeys,
  opts: { limit: number; ttlSec: number },
): Promise<{ ok: true; ipCount: number; anonCount: number } | { ok: false }> {
  let ipTaken = false;
  let anonTaken = false;
  try {
    const ipCount = await kv.incr(keys.ip);
    ipTaken = true;
    await kv.expire(keys.ip, opts.ttlSec);
    const anonCount = await kv.incr(keys.anon);
    anonTaken = true;
    await kv.expire(keys.anon, opts.ttlSec);
    if (ipCount > opts.limit || anonCount > opts.limit) {
      // Compensating decrs are best effort: a Redis failure here must
      // neither throw nor leak the caller's counts, so each stands alone.
      try {
        await kv.decr(keys.ip);
      } catch {
        // The increment already landed; the TTL bounds the damage.
      }
      try {
        await kv.decr(keys.anon);
      } catch {
        // The increment already landed; the TTL bounds the damage.
      }
      return { ok: false };
    }
    return { ok: true, ipCount, anonCount };
  } catch (e) {
    // A Redis failure between increments gives back what landed, so a
    // timeout never leaks quota. Best effort, then the caller maps it.
    if (anonTaken) {
      try {
        await kv.decr(keys.anon);
      } catch {
        // The increment already landed; the TTL bounds the damage.
      }
    }
    if (ipTaken) {
      try {
        await kv.decr(keys.ip);
      } catch {
        // The increment already landed; the TTL bounds the damage.
      }
    }
    throw e;
  }
}

// Best effort: a Redis failure here must never become a client 500.
export async function refundDualQuota(kv: KV, keys: DualKeys): Promise<void> {
  try {
    await kv.decr(keys.ip);
    await kv.decr(keys.anon);
  } catch {
    // Redis down: nothing reserved server-side to retry against.
  }
}

// Free uploaded-book processing: one book per person per UTC day,
// counted on hashed IP and the anon cookie, whichever hits first.
export const FREE_BOOKS_PER_PERSON = 1;
// A valid friend code raises the free path to five books that day,
// on the same quota keys, so a friend gets five total, not five more.
export const FRIEND_BOOKS_PER_PERSON = 5;
// Wrong friend-code guesses per hashed IP per day before codes stop
// being checked; a wrong guess never errors, the upload just keeps
// the normal quota.
export const FRIEND_WRONG_GUESSES_PER_DAY = 10;
// BYOK uploads spend the reader's key, but creates still need a per-person
// cap so a bot cannot farm infinite jobs; same dual counting, own prefix.
export const BYOK_UPLOADS_PER_PERSON = 10;
export const BOOK_QUOTA_TTL_SEC = 48 * 3600;

export function bookQuotaKeys(args: { day: string; ipHash: string; anonId: string; prefix?: string }): DualKeys {
  const prefix = args.prefix ?? "books:quota";
  return {
    ip: `${prefix}:ip:${args.day}:${args.ipHash}`,
    anon: `${prefix}:anon:${args.day}:${args.anonId}`,
  };
}

export function bookQuotaKeysFor(args: {
  day: string;
  ip: string;
  salt: string;
  anonId: string;
  prefix?: string;
}): DualKeys {
  return bookQuotaKeys({
    day: args.day,
    ipHash: hashIp(ipBucket(args.ip, args.anonId), args.salt),
    anonId: args.anonId,
    prefix: args.prefix,
  });
}

// Thin wrapper so the book hook shares the never-throw compensation.
export async function checkBookQuota(
  kv: KV,
  keys: DualKeys,
): Promise<{ ok: true } | { ok: false }> {
  const taken = await takeDualQuota(kv, keys, {
    limit: FREE_BOOKS_PER_PERSON,
    ttlSec: BOOK_QUOTA_TTL_SEC,
  });
  return taken.ok ? { ok: true } : { ok: false };
}

export async function refundBookQuota(kv: KV, keys: DualKeys): Promise<void> {
  await refundDualQuota(kv, keys);
}

// Server-only friend codes from LECTORIA_FRIEND_CODES: comma-separated,
// trimmed, empties dropped. Unset or empty means the feature is off.
export function parseFriendCodes(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((code) => code.trim())
    .filter((code) => code.length > 0);
}

// Constant-time match over sha256 digests so lengths always match, and
// every configured code is checked with no early exit.
export function matchFriendCode(submitted: string, codes: string[]): boolean {
  const want = createHash("sha256").update(submitted, "utf8").digest();
  let hit = false;
  for (const code of codes) {
    const got = createHash("sha256").update(code, "utf8").digest();
    if (timingSafeEqual(want, got)) hit = true;
  }
  return hit;
}

export function friendGuessKeyFor(args: { day: string; ip: string; salt: string; anonId: string }): string {
  return `books:friend-guess:ip:${args.day}:${hashIp(ipBucket(args.ip, args.anonId), args.salt)}`;
}

// True when the submitted code is valid and the guess budget remains.
// Anything else is false, never an error: the upload keeps the normal
// quota. Never logs or returns the code itself.
export async function acceptFriendCode(
  kv: KV,
  submitted: unknown,
  codes: string[],
  guessKey: string,
): Promise<boolean> {
  if (typeof submitted !== "string") return false;
  const code = submitted.trim();
  if (code.length === 0 || code.length > FRIEND_CODE_MAX_LEN) return false;
  if (codes.length === 0) return false;
  let guesses = 0;
  try {
    const raw = await kv.get(guessKey);
    guesses = raw === null ? 0 : Number(raw);
    if (!Number.isFinite(guesses) || guesses < 0) guesses = 0;
  } catch {
    return false; // Redis down: no friend path, the normal quota still applies.
  }
  if (guesses >= FRIEND_WRONG_GUESSES_PER_DAY) return false;
  if (matchFriendCode(code, codes)) return true;
  try {
    await kv.incr(guessKey);
    await kv.expire(guessKey, BOOK_QUOTA_TTL_SEC);
  } catch {
    // Best effort; the guess just goes uncounted.
  }
  return false;
}
