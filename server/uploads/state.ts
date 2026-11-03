import "server-only";
import type { KV } from "@/core/types";
import {
  UPLOAD_JOB_TTL_SEC,
  isUploadId,
  partKey,
  uploadDailySpendKey,
  uploadPartPath,
  type UploadErrorCode,
  type UploadPart,
} from "@/core/uploads";
import { refundDualQuota } from "@/server/guard/quota";
import { spendKey } from "@/server/guard/spend";
import { jevCostUsd, metaCostUsd } from "../../pipeline/prices";
import type { UploadStore } from "./blob";

// Control flow between orchestration and HTTP: the handler maps the code
// to a status and message, never the wrapped error.
export class UploadFailure extends Error {
  constructor(public code: UploadErrorCode) {
    super(code);
    this.name = "UploadFailure";
  }
}

// A step that hit a passing upstream failure: the job stays working and
// the route answers an uncoded 503, which the client retries.
export class UploadRetry extends Error {
  constructor() {
    super("upload step retry");
    this.name = "UploadRetry";
  }
}

// Tries per part before a passing failure fails the whole job.
export const UPLOAD_PART_ATTEMPTS = 3;

// Job state lives in Redis; book text lives in private Blob. The state
// holds ordinals and money only, never text and never keys.
export interface UploadUsage {
  metaPrompt: number;
  metaCached: number;
  metaCompletion: number;
  metaRequests: number;
  jevInput: number;
  jevOutput: number;
  jevRequests: number;
}

export function emptyUsage(): UploadUsage {
  return { metaPrompt: 0, metaCached: 0, metaCompletion: 0, metaRequests: 0, jevInput: 0, jevOutput: 0, jevRequests: 0 };
}

// Steps never mutate the job's usage (parallel drivers would lose each
// other's counts); each part result carries its own usage and the terminal
// paths sum job usage plus every finished part.
export function sumUsage(all: UploadUsage[]): UploadUsage {
  const total = emptyUsage();
  for (const usage of all) {
    total.metaPrompt += usage.metaPrompt;
    total.metaCached += usage.metaCached;
    total.metaCompletion += usage.metaCompletion;
    total.metaRequests += usage.metaRequests;
    total.jevInput += usage.jevInput;
    total.jevOutput += usage.jevOutput;
    total.jevRequests += usage.jevRequests;
  }
  return total;
}

export function isUsageZero(usage: UploadUsage): boolean {
  return (
    usage.metaPrompt === 0 &&
    usage.metaCached === 0 &&
    usage.metaCompletion === 0 &&
    usage.metaRequests === 0 &&
    usage.jevInput === 0 &&
    usage.jevOutput === 0 &&
    usage.jevRequests === 0
  );
}

export function usageCostMicro(usage: UploadUsage): number {
  const usd =
    metaCostUsd({ prompt: usage.metaPrompt, cached: usage.metaCached, completion: usage.metaCompletion }) +
    jevCostUsd(usage.jevInput);
  return Math.round(usd * 1_000_000);
}

export function usageCostUsd(usage: UploadUsage): number {
  return Math.round((usageCostMicro(usage) / 1_000_000) * 1_000_000) / 1_000_000;
}

export type UploadStatus = "working" | "done" | "failed";

export interface UploadJobChapter {
  ch: number;
  title: string;
  start_n: number;
  end_n: number;
}

export interface UploadJob {
  v: 1;
  id: string;
  path: "free" | "byok";
  anonId: string | null;
  day: string;
  createdAt: number;
  title: string;
  author: string;
  textVersion: string;
  chapters: UploadJobChapter[];
  parts: UploadPart[];
  doneParts: string[];
  status: UploadStatus;
  usage: UploadUsage;
  reservedMicro: number;
  quotaIp: string | null;
  quotaAnon: string | null;
  costMicro: number | null;
  // Passing upstream failures per part key; absent on older jobs.
  partAttempts?: Record<string, number>;
}

export function uploadJobKey(id: string): string {
  return `upload:job:${id}`;
}

export function uploadLockKey(id: string, part: string): string {
  return `upload:lock:${id}:${part}`;
}

// Guards the exactly-once refund and finalize across concurrent drivers.
export function uploadRefundKey(id: string): string {
  return `upload:refunded:${id}`;
}

export function uploadFinalizeKey(id: string): string {
  return `upload:finalized:${id}`;
}

// Both outlive the 120 s step route, so a slow step never overlaps itself.
export const UPLOAD_LOCK_TTL_SEC = 150;
// Short lease, not a durable marker: a finalize killed at the route limit
// frees the key, and the settle guard below still keeps spend exactly-once.
export const UPLOAD_FINALIZE_LEASE_SEC = 150;

function isPart(value: unknown): value is UploadPart {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(p.ch) &&
    (p.ch as number) >= 1 &&
    Number.isSafeInteger(p.part) &&
    (p.part as number) >= 1 &&
    Number.isSafeInteger(p.startN) &&
    Number.isSafeInteger(p.endN) &&
    (p.startN as number) <= (p.endN as number)
  );
}

export function isUsage(value: unknown): value is UploadUsage {
  if (typeof value !== "object" || value === null) return false;
  return (["metaPrompt", "metaCached", "metaCompletion", "metaRequests", "jevInput", "jevOutput", "jevRequests"] as const).every(
    (k) => typeof (value as Record<string, unknown>)[k] === "number",
  );
}

// Defensive read: Redis is trusted but a corrupt value must not crash the
// route. Returns the job, or null when missing or unparseable.
export function parseUploadJob(raw: string | null): UploadJob | null {
  if (raw === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null) return null;
  const j = json as Record<string, unknown>;
  if (j.v !== 1 || !isUploadId(j.id)) return null;
  if (j.path !== "free" && j.path !== "byok") return null;
  if (j.anonId !== null && typeof j.anonId !== "string") return null;
  if (typeof j.day !== "string" || typeof j.createdAt !== "number") return null;
  if (typeof j.title !== "string" || typeof j.author !== "string") return null;
  if (typeof j.textVersion !== "string") return null;
  if (!Array.isArray(j.chapters) || !Array.isArray(j.parts) || !Array.isArray(j.doneParts)) return null;
  if (!j.parts.every(isPart) || !j.doneParts.every((d) => typeof d === "string")) return null;
  if (j.status !== "working" && j.status !== "done" && j.status !== "failed") return null;
  if (!isUsage(j.usage)) return null;
  if (typeof j.reservedMicro !== "number") return null;
  if (j.quotaIp !== null && typeof j.quotaIp !== "string") return null;
  if (j.quotaAnon !== null && typeof j.quotaAnon !== "string") return null;
  if (j.costMicro !== null && typeof j.costMicro !== "number") return null;
  if (j.partAttempts !== undefined) {
    if (typeof j.partAttempts !== "object" || j.partAttempts === null) return null;
    if (!Object.values(j.partAttempts).every((n) => Number.isSafeInteger(n))) return null;
  }
  for (const c of j.chapters) {
    if (typeof c !== "object" || c === null) return null;
    const ch = c as Record<string, unknown>;
    if (!Number.isSafeInteger(ch.ch) || typeof ch.title !== "string") return null;
    if (!Number.isSafeInteger(ch.start_n) || !Number.isSafeInteger(ch.end_n)) return null;
  }
  return json as UploadJob;
}

export async function loadUploadJob(kv: KV, id: string): Promise<UploadJob | null> {
  return parseUploadJob(await kv.get(uploadJobKey(id)));
}

export async function saveUploadJob(kv: KV, job: UploadJob): Promise<void> {
  await kv.set(uploadJobKey(job.id), JSON.stringify(job));
  await kv.expire(uploadJobKey(job.id), UPLOAD_JOB_TTL_SEC);
}

function parsePartUsage(raw: string | null): UploadUsage {
  if (raw === null) return emptyUsage();
  try {
    const json: unknown = JSON.parse(raw);
    if (typeof json === "object" && json !== null && isUsage((json as { usage?: unknown }).usage)) {
      return (json as { usage: UploadUsage }).usage;
    }
  } catch {
    // A corrupt part counts as empty here; finalize still validates scenes.
  }
  return emptyUsage();
}

// Every terminal path tallies the same way: create-time judge usage plus
// each finished part's blob usage, plus the failing step's in-flight usage
// when the caller hands it over. Blobs without a usage field count as
// empty, so jobs straddling the deploy still tally exactly once.
export async function sumRecordedUsage(store: UploadStore, job: UploadJob, extra?: UploadUsage): Promise<UploadUsage> {
  const parts: UploadUsage[] = [];
  for (const p of job.parts) {
    parts.push(parsePartUsage(await store.readText(uploadPartPath(job.id, partKey(p)))));
  }
  return sumUsage(extra ? [job.usage, extra, ...parts] : [job.usage, ...parts]);
}

// The only money writer. The first caller folds actual-minus-reserved into
// both spend counters; every other terminal path is a no-op, so a retried
// finalize, a racing fail, and the stale cleanup can never double-adjust.
// Never throws; true when this call won the guard.
export async function settleSpendOnce(kv: KV, job: UploadJob, actualMicro: number): Promise<boolean> {
  let first = false;
  try {
    first = await kv.setNxEx(uploadRefundKey(job.id), "1", UPLOAD_JOB_TTL_SEC);
  } catch {
    return false;
  }
  if (!first || job.reservedMicro <= 0) return first;
  const delta = actualMicro - job.reservedMicro;
  if (delta !== 0) {
    try {
      await kv.incrBy(spendKey(), delta);
      await kv.incrBy(uploadDailySpendKey(job.day), delta);
    } catch {
      // Kept on Redis failure: conservative, like an abandoned job.
    }
  }
  return true;
}

// Marks the job failed, keeps what was really spent, and refunds the
// per-person quota only when nothing ran at all. Exactly once via the
// settle guard,
// best effort throughout: when the tally itself fails the reserve is kept,
// which is the conservative side. Settles before saving, so a kill between
// the two leaves at most an unsettled working job the cron still picks up.
// A job already done is never touched.
export async function failUploadJob(kv: KV, store: UploadStore, job: UploadJob, extra?: UploadUsage): Promise<void> {
  if (job.status === "done") return;
  let usage: UploadUsage | null = null;
  try {
    usage = await sumRecordedUsage(store, job, extra);
  } catch {
    usage = null;
  }
  const first = await settleSpendOnce(kv, job, usage ? usageCostMicro(usage) : job.reservedMicro);
  if (first && usage && isUsageZero(usage) && job.quotaIp && job.quotaAnon) {
    await refundDualQuota(kv, { ip: job.quotaIp, anon: job.quotaAnon });
  }
  job.status = "failed";
  if (usage) job.usage = usage;
  try {
    await saveUploadJob(kv, job);
  } catch {
    // Spend already settled above; a later fail or the cron re-saves this.
  }
}
