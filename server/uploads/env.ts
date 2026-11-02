import "server-only";
import { parseCapUsd, turnstilePair, usable } from "@/server/guard/env";
import type { TurnstilePair } from "@/server/guard/env";
import { parseFriendCodes } from "@/server/guard/quota";

// Upload env, read once per request. Jev is optional: without a usable key
// the free path classifies with the contributor model alone. Missing
// required env means 503 unavailable, never unauthenticated spend.
export interface UploadEnv extends TurnstilePair {
  upstashUrl: string;
  upstashToken: string;
  uploadsToken: string;
  metaKey: string;
  jevKey?: string;
  sessionSecret: string;
  ipSalt: string;
  spendCapMicro: number;
  // Valid friend codes raising the free path to five books a day.
  // Empty when LECTORIA_FRIEND_CODES is unset: the feature is off.
  friendCodes?: string[];
}

const URL_NAMES = "UPSTASH_REDIS_REST_URL|KV_REST_API_URL";
const TOKEN_NAMES = "UPSTASH_REDIS_REST_TOKEN|KV_REST_API_TOKEN";

// The uploads token is its own private store: the image store is public
// and a store's access mode is fixed at creation, so private puts would
// fail against it. Never fall back to the public store.
const REQUIRED = [
  "UPLOADS_BLOB_READ_WRITE_TOKEN",
  "META_API_KEY",
  "SESSION_SECRET",
  "IP_HASH_SALT",
] as const;

export function readUploadEnv(from: NodeJS.ProcessEnv = process.env): UploadEnv {
  const candidate = usable(from.UPSTASH_REDIS_REST_URL) ?? usable(from.KV_REST_API_URL);
  const upstashUrl = candidate?.startsWith("https://") ? candidate : undefined;
  const upstashToken = usable(from.UPSTASH_REDIS_REST_TOKEN) ?? usable(from.KV_REST_API_TOKEN);
  const missing = [
    upstashUrl ? null : URL_NAMES,
    upstashToken ? null : TOKEN_NAMES,
    ...REQUIRED.filter((k) => !usable(from[k])),
  ].filter((m): m is string => m !== null);
  if (missing.length > 0) throw new Error(`missing upload env: ${missing.join(",")}`);
  const jevKey = usable(from.JEV_API_KEY);
  return {
    upstashUrl: upstashUrl as string,
    upstashToken: upstashToken as string,
    uploadsToken: from.UPLOADS_BLOB_READ_WRITE_TOKEN as string,
    metaKey: from.META_API_KEY as string,
    ...(jevKey ? { jevKey } : {}),
    sessionSecret: from.SESSION_SECRET as string,
    ipSalt: from.IP_HASH_SALT as string,
    spendCapMicro: Math.round(parseCapUsd(from.SPEND_CAP_USD, 10) * 1_000_000),
    friendCodes: parseFriendCodes(usable(from.LECTORIA_FRIEND_CODES)),
    ...turnstilePair(from),
  };
}
