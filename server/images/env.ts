import "server-only";
import { parseCapUsd, turnstilePair, usable } from "@/server/guard/env";
import type { TurnstilePair } from "@/server/guard/env";

// Reads image env once per request. Any missing key means unavailable:
// with no quotas or budget configured, the route must never spend.
export interface ImageEnv extends TurnstilePair {
  upstashUrl: string;
  upstashToken: string;
  metaKey: string;
  sessionSecret: string;
  ipSalt: string;
  spendCapMicro: number;
  dailySpendCapMicro: number;
}

// Vercel's Upstash marketplace integration injects KV_REST_API_* names.
// UPSTASH_* wins when non-empty, else the KV_* fallback applies per value.
// The read-only token is never used (we write).
const URL_NAMES = "UPSTASH_REDIS_REST_URL|KV_REST_API_URL";
const TOKEN_NAMES = "UPSTASH_REDIS_REST_TOKEN|KV_REST_API_TOKEN";

const REQUIRED = [
  "BLOB_READ_WRITE_TOKEN",
  "META_API_KEY",
  "SESSION_SECRET",
  "IP_HASH_SALT",
] as const;

// The daily free picture quota is for the public site. Local development
// (next dev, off Vercel) skips it so the owner can iterate; any Vercel
// deploy (production or preview) and any non-dev build always enforce it.
// There is no request-controlled switch: only the server's own env.
export function localQuotaExempt(from: NodeJS.ProcessEnv = process.env): boolean {
  if (from.VERCEL || from.VERCEL_ENV) return false;
  return from.NODE_ENV === "development";
}

export function readImageEnv(from: NodeJS.ProcessEnv = process.env): ImageEnv {
  const upstashUrl = usable(from.UPSTASH_REDIS_REST_URL) ?? usable(from.KV_REST_API_URL);
  const upstashToken = usable(from.UPSTASH_REDIS_REST_TOKEN) ?? usable(from.KV_REST_API_TOKEN);
  // A non-https URL is a placeholder or typo, never a real endpoint.
  const url = upstashUrl?.startsWith("https://") ? upstashUrl : undefined;
  const missing = [
    url ? null : URL_NAMES,
    upstashToken ? null : TOKEN_NAMES,
    ...REQUIRED.filter((k) => !usable(from[k])),
  ].filter((m): m is string => m !== null);
  if (missing.length > 0) throw new Error(`missing image env: ${missing.join(",")}`);
  return {
    upstashUrl: url as string,
    upstashToken: upstashToken as string,
    metaKey: from.META_API_KEY as string,
    sessionSecret: from.SESSION_SECRET as string,
    ipSalt: from.IP_HASH_SALT as string,
    spendCapMicro: Math.round(parseCapUsd(from.SPEND_CAP_USD, 10) * 1_000_000),
    dailySpendCapMicro: Math.round(parseCapUsd(from.DAILY_SPEND_CAP_USD, 2) * 1_000_000),
    // Optional like chat: without both keys the route skips the human check (dev).
    ...turnstilePair(from),
  };
}
