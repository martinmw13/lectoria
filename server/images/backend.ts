import "server-only";
import { createMemoryKV } from "@/core/images";
import type { KV } from "@/core/types";
import { parseCapUsd, turnstilePair, usable } from "@/server/guard/env";
import { readImageEnv } from "./env";
import type { ImageEnv } from "./env";
import { localImageCacheDir, onVercel } from "./local-cache";

// Picks where generated pictures are cached. Vercel always uses Blob plus
// Redis (readImageEnv, strict). Off Vercel, a missing or partial Blob/KV
// setup (or LECTORIA_LOCAL_IMAGE_CACHE=1) switches to the disk cache with
// an in-process KV, so localhost never writes local URLs into the shared
// Redis index. Names only are inspected; values never leave this file.
export type ImageBackend =
  | { mode: "remote"; env: ImageEnv }
  | { mode: "local"; env: ImageEnv; dir: string };

const LOCAL_REQUIRED = ["META_API_KEY", "SESSION_SECRET", "IP_HASH_SALT"] as const;

export function remoteCacheReady(from: NodeJS.ProcessEnv): boolean {
  const url = usable(from.UPSTASH_REDIS_REST_URL) ?? usable(from.KV_REST_API_URL);
  const token = usable(from.UPSTASH_REDIS_REST_TOKEN) ?? usable(from.KV_REST_API_TOKEN);
  return Boolean(usable(from.BLOB_READ_WRITE_TOKEN) && url?.startsWith("https://") && token);
}

export function readImageBackend(from: NodeJS.ProcessEnv = process.env): ImageBackend {
  if (!onVercel(from)) {
    const forced = from.LECTORIA_LOCAL_IMAGE_CACHE === "1";
    const localReady = LOCAL_REQUIRED.every((k) => usable(from[k]));
    if ((forced || !remoteCacheReady(from)) && localReady) {
      return {
        mode: "local",
        dir: localImageCacheDir(from),
        env: {
          upstashUrl: "",
          upstashToken: "",
          metaKey: from.META_API_KEY as string,
          sessionSecret: from.SESSION_SECRET as string,
          ipSalt: from.IP_HASH_SALT as string,
          spendCapMicro: Math.round(parseCapUsd(from.SPEND_CAP_USD, 10) * 1_000_000),
          dailySpendCapMicro: Math.round(parseCapUsd(from.DAILY_SPEND_CAP_USD, 2) * 1_000_000),
          ...turnstilePair(from),
        },
      };
    }
  }
  // Throws "missing image env: <names>" exactly as before.
  return { mode: "remote", env: readImageEnv(from) };
}

// One in-process KV for locks, quota, and spend in local mode. The disk
// store, not this KV, is what survives restarts.
let localKv: KV | null = null;
let announced = false;
export function localImageKV(dir: string): KV {
  if (!announced) {
    announced = true;
    console.info(`image cache: local disk at ${dir}`);
  }
  localKv ??= createMemoryKV();
  return localKv;
}
