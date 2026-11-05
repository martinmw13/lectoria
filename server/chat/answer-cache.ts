import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { CHAT_MAX_ANSWER_CHARS } from "@/core/chat";
import { CHAT_CACHE_TTL_SEC } from "@/core/chat-cache";
import type { KV } from "@/core/types";
import { remoteCacheReady } from "@/server/images/backend";
import { onVercel } from "@/server/images/local-cache";

// Shared answers for common questions. Same split as the image cache:
// Redis on Vercel (or when the remote cache is configured), else a disk
// cache outside the repo (~/.cache/lectoria/chat). Failures read as a miss
// and never fail the question.
export interface AnswerCache {
  get(key: string): Promise<string | null>;
  set(key: string, answer: string): Promise<void>;
}

function usableAnswer(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= CHAT_MAX_ANSWER_CHARS ? v : null;
}

export function createKvAnswerCache(kv: KV): AnswerCache {
  return {
    async get(key) {
      try {
        return usableAnswer(await kv.get(key));
      } catch {
        return null;
      }
    },
    async set(key, answer) {
      try {
        await kv.set(key, answer);
        await kv.expire(key, CHAT_CACHE_TTL_SEC);
      } catch {
        // A lost write only costs a later miss.
      }
    },
  };
}

export function localChatCacheDir(from: NodeJS.ProcessEnv = process.env): string {
  const override = from.LECTORIA_CHAT_CACHE_DIR?.trim() ?? "";
  if (override !== "" && isAbsolute(override)) return resolve(/*turbopackIgnore: true*/ override);
  return join(/*turbopackIgnore: true*/ homedir(), ".cache", "lectoria", "chat");
}

// File names are a hash of the key, so no request field reaches the path.
export function createDiskAnswerCache(dir: string, now: () => number = Date.now): AnswerCache {
  const fileFor = (key: string) => join(/*turbopackIgnore: true*/ dir, `${createHash("sha256").update(key).digest("hex")}.json`);
  return {
    async get(key) {
      try {
        const parsed = JSON.parse(await readFile(/*turbopackIgnore: true*/ fileFor(key), "utf8")) as Record<string, unknown>;
        if (parsed.key !== key || typeof parsed.expiresAt !== "number" || parsed.expiresAt < now()) return null;
        return usableAnswer(parsed.answer);
      } catch {
        return null;
      }
    },
    async set(key, answer) {
      try {
        await mkdir(/*turbopackIgnore: true*/ dir, { recursive: true });
        const file = fileFor(key);
        const tmp = `${file}.${randomUUID()}.tmp`;
        await writeFile(/*turbopackIgnore: true*/ tmp, JSON.stringify({ key, answer, expiresAt: now() + CHAT_CACHE_TTL_SEC * 1000 }));
        await rename(/*turbopackIgnore: true*/ tmp, file);
      } catch {
        // Disk full or read-only: no cache, same answer.
      }
    },
  };
}

export function selectAnswerCache(kv: KV, from: NodeJS.ProcessEnv = process.env): AnswerCache {
  if (onVercel(from)) return createKvAnswerCache(kv);
  const forced = from.LECTORIA_LOCAL_IMAGE_CACHE === "1";
  return forced || !remoteCacheReady(from) ? createDiskAnswerCache(localChatCacheDir(from)) : createKvAnswerCache(kv);
}
