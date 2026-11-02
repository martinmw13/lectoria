import "server-only";
import { ensureAnon } from "@/server/guard/anon";
import { readBodyCapped } from "@/server/guard/body";
import { createRestKV } from "@/server/guard/kv";
import { friendGuessKeyFor, judgeFriendCode } from "@/server/guard/quota";
import { clientIp, rejectsCrossSite, utcDay } from "@/server/guard/request";
import type { KV } from "@/core/types";
import { readFriendCodeEnv } from "./env";
import type { FriendCodeEnv } from "./env";

// Small enough that no real code needs more; a lying content-length fails fast.
const FRIEND_CODE_BODY_BYTES = 1024;

function deny(cookies: string[]): Response {
  return Response.json({ ok: false }, { status: 400, headers: withCookies(cookies) });
}

function withCookies(cookies: string[]): Headers {
  const headers = new Headers();
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return headers;
}

// Instant friend-code check for the Apply button: same constant-time compare
// and per-hashed-IP guess limiter as the upload path. Answers { ok } only;
// the code is never echoed, logged, or stored. No Turnstile: the guess
// limiter caps abuse. Order: same-origin, body cap, strict parse, env,
// anon cookie, then the guess-limited compare.
export interface FriendCodeDeps {
  env?: FriendCodeEnv;
  kv?: KV;
  now?: Date;
}

export async function handleFriendCodeCheck(req: Request, deps: FriendCodeDeps = {}): Promise<Response> {
  const cookies: string[] = [];
  if (rejectsCrossSite(req.headers, req.url)) return deny(cookies);
  const capped = await readBodyCapped(req, FRIEND_CODE_BODY_BYTES);
  if (!capped.ok) return deny(cookies);
  let code: string;
  try {
    const parsed: unknown = JSON.parse(capped.text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return deny(cookies);
    const record = parsed as Record<string, unknown>;
    if (Object.keys(record).length !== 1 || typeof record.code !== "string") return deny(cookies);
    code = record.code;
  } catch {
    return deny(cookies);
  }
  let env = deps.env;
  if (!env) {
    try {
      env = readFriendCodeEnv();
    } catch (err) {
      // Names only, never values, so a local box shows what it lacks.
      console.error(err instanceof Error ? err.message : "friend-code env missing");
      return Response.json({ ok: false }, { status: 503, headers: withCookies(cookies) });
    }
  }
  try {
    const anonId = ensureAnon(req.headers.get("cookie"), env.sessionSecret, cookies);
    const kv = deps.kv ?? createRestKV(env.upstashUrl, env.upstashToken);
    const day = utcDay(deps.now ?? new Date());
    const verdict = await judgeFriendCode(
      kv,
      code,
      env.friendCodes ?? [],
      friendGuessKeyFor({ day, ip: clientIp(req.headers), salt: env.ipSalt, anonId }),
    );
    if (verdict === "unavailable") throw new Error("kv unavailable");
    return Response.json({ ok: verdict === "ok" }, { status: 200, headers: withCookies(cookies) });
  } catch {
    console.error("friend-code check failed");
    return Response.json({ ok: false }, { status: 503, headers: withCookies(cookies) });
  }
}
