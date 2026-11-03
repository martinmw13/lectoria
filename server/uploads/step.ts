import "server-only";
import { randomUUID } from "node:crypto";
import type { AnalyzedScene, SceneEmotion, SceneInput } from "@/core/types";
import { validateBookCoverage } from "@/core/scenes";
import { UPLOAD_TTL_DAYS, partKey, uploadAnalysisPath, uploadBookPath, uploadPartPath } from "@/core/uploads";
import type { KV } from "@/core/types";
import type { JevClient } from "../../pipeline/jev";
import type { MetaClient } from "../../pipeline/meta";
import type { UploadStore } from "./blob";
import type { UploadBook } from "./create";
import {
  emptyUsage,
  failUploadJob,
  isUsage,
  loadUploadJob,
  saveUploadJob,
  settleSpendOnce,
  sumRecordedUsage,
  sumUsage,
  uploadFinalizeKey,
  uploadLockKey,
  UPLOAD_FINALIZE_LEASE_SEC,
  UPLOAD_LOCK_TTL_SEC,
  UploadFailure,
  UploadRetry,
  UPLOAD_PART_ATTEMPTS,
  usageCostMicro,
  usageCostUsd,
  type UploadJob,
  type UploadUsage,
} from "./state";
import { upstreamKind } from "@/server/guard/upstream";
import { classifyPart, segmentPart, WorkError } from "./work";

export interface StepArgs {
  kv: KV;
  store: UploadStore;
  meta: MetaClient;
  jev: JevClient | null;
  id: string;
  chapter?: number;
  // Aborts the step's model calls just before the route limit.
  signal?: AbortSignal;
}

export type StepResult =
  | { status: "working"; id: string; done: number; total: number }
  | { status: "done"; id: string; done: number; total: number; costUsd: number };

interface StoredPart {
  part: string;
  ch: number;
  scenes: (SceneInput & SceneEmotion & { ch: number })[];
  usage: UploadUsage;
}

function parseStoredPart(raw: string): StoredPart | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null) return null;
  const p = json as Record<string, unknown>;
  if (typeof p.part !== "string" || typeof p.ch !== "number" || !Array.isArray(p.scenes)) return null;
  for (const s of p.scenes) {
    if (typeof s !== "object" || s === null) return null;
    const scene = s as Record<string, unknown>;
    if (typeof scene.start_n !== "number" || typeof scene.end_n !== "number") return null;
    if (typeof scene.title !== "string" || typeof scene.summary !== "string") return null;
    if (!Array.isArray(scene.characters)) return null;
  }
  // Blobs written before per-part usage count as empty; their spend sits in
  // the job usage already.
  return { part: p.part as string, ch: p.ch as number, scenes: p.scenes as StoredPart["scenes"], usage: isUsage(p.usage) ? p.usage : emptyUsage() };
}

function parseUploadBook(raw: string | null, job: UploadJob): UploadBook | null {
  if (raw === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null) return null;
  const book = json as Partial<UploadBook>;
  if (book.id !== job.id || book.textVersion !== job.textVersion) return null;
  if (!Array.isArray(book.chapters) || !Array.isArray(book.paragraphs)) return null;
  return json as UploadBook;
}

function workingResult(job: UploadJob): StepResult {
  return { status: "working", id: job.id, done: job.doneParts.length, total: job.parts.length };
}

function doneResult(job: UploadJob): StepResult {
  return {
    status: "done",
    id: job.id,
    done: job.parts.length,
    total: job.parts.length,
    costUsd: job.costMicro !== null ? job.costMicro / 1_000_000 : usageCostUsd(job.usage),
  };
}

async function markDoneAndMaybeFinalize(args: StepArgs, job: UploadJob, part: string): Promise<StepResult> {
  if (!job.doneParts.includes(part)) job.doneParts.push(part);
  await saveUploadJob(args.kv, job);
  if (job.doneParts.length < job.parts.length) return workingResult(job);
  return finalize(args, job);
}

// Assembles the analysis under a short lease: concurrent last-part drivers
// converge on the winner's result, a finalize killed at the route limit
// frees the key for a retake, and a finalize that died between the blob
// write and the job save repairs from the blob on retry. Spend settles
// exactly once through the shared guard, whichever path lands first.
async function finalize(args: StepArgs, job: UploadJob): Promise<StepResult> {
  const first = await args.kv.setNxEx(uploadFinalizeKey(job.id), "1", UPLOAD_FINALIZE_LEASE_SEC);
  if (!first) {
    const fresh = await loadUploadJob(args.kv, job.id);
    if (!fresh) throw new UploadFailure("not_found");
    if (fresh.status === "done") return doneResult(fresh);
    if (fresh.status === "failed") throw new UploadFailure("unavailable");
    const analysis = await args.store.readText(uploadAnalysisPath(job.id));
    if (analysis) {
      const usage = await sumRecordedUsage(args.store, fresh);
      fresh.status = "done";
      fresh.usage = usage;
      fresh.costMicro = usageCostMicro(usage);
      await settleSpendOnce(args.kv, fresh, fresh.costMicro);
      await saveUploadJob(args.kv, fresh);
      return doneResult(fresh);
    }
    return workingResult(fresh);
  }
  const scenes: AnalyzedScene[] = [];
  const partUsages: UploadUsage[] = [];
  for (const chapter of [...job.chapters].sort((a, b) => a.ch - b.ch)) {
    const chParts = job.parts.filter((p) => p.ch === chapter.ch).sort((a, b) => a.part - b.part);
    let k = 0;
    for (const p of chParts) {
      const stored = parseStoredPart(await args.store.readText(uploadPartPath(job.id, partKey(p))) ?? "");
      if (!stored) throw new WorkError("store");
      partUsages.push(stored.usage);
      for (const s of stored.scenes) {
        k += 1;
        scenes.push({ ...s, id: `c${chapter.ch}s${k}`, ch: chapter.ch });
      }
    }
  }
  const book = parseUploadBook(await args.store.readText(uploadBookPath(job.id)), job);
  if (!book) throw new WorkError("store");
  const problems = validateBookCoverage(book, scenes);
  if (problems.length > 0) throw new WorkError("segment");
  await args.store.saveJson(uploadAnalysisPath(job.id), JSON.stringify({ bookId: job.id, textVersion: job.textVersion, scenes }));
  const usage = sumUsage([job.usage, ...partUsages]);
  const costMicro = usageCostMicro(usage);
  await settleSpendOnce(args.kv, job, costMicro);
  job.status = "done";
  job.usage = usage;
  job.costMicro = costMicro;
  await saveUploadJob(args.kv, job);
  return doneResult(job);
}

// Keeps the job working after a passing failure: folds the part's spend
// into the job usage and, when counted, bumps the part's attempt tally.
// Returns the fresh job and whether the part may still be retried.
async function deferPart(
  args: StepArgs,
  job: UploadJob,
  key: string,
  usage: UploadUsage,
  counted: boolean,
): Promise<{ job: UploadJob; retry: boolean }> {
  const fresh = (await loadUploadJob(args.kv, job.id)) ?? job;
  const attempts = (fresh.partAttempts?.[key] ?? 0) + (counted ? 1 : 0);
  if (counted && attempts >= UPLOAD_PART_ATTEMPTS) return { job: fresh, retry: false };
  fresh.usage = sumUsage([fresh.usage, usage]);
  fresh.partAttempts = { ...fresh.partAttempts, [key]: attempts };
  await saveUploadJob(args.kv, fresh);
  return { job: fresh, retry: true };
}

// One idempotent unit of work: re-calling a finished part or a finished
// job costs nothing. Usage accrues to this part's blob only, so parallel
// drivers on different parts never overwrite each other. Any throw after
// the guards fails the job with the once-guarded settle, and the client
// sees only `unavailable`.
export async function stepUpload(args: StepArgs): Promise<StepResult> {
  const job = await loadUploadJob(args.kv, args.id);
  if (!job) throw new UploadFailure("not_found");
  if (Date.now() - job.createdAt > UPLOAD_TTL_DAYS * 24 * 3600 * 1000) throw new UploadFailure("expired");
  if (job.status === "failed") throw new UploadFailure("unavailable");
  if (job.status === "done") return doneResult(job);

  const pending = job.parts.filter((p) => !job.doneParts.includes(partKey(p)));
  if (args.chapter !== undefined && !job.chapters.some((c) => c.ch === args.chapter)) {
    throw new UploadFailure("bad_request");
  }
  const wanted = args.chapter === undefined ? pending : pending.filter((p) => p.ch === args.chapter);
  if (wanted.length === 0) {
    if (pending.length > 0) return workingResult(job);
    try {
      return await finalize(args, job);
    } catch (e) {
      if (e instanceof UploadFailure) throw e;
      await failUploadJob(args.kv, args.store, job);
      throw new UploadFailure("unavailable");
    }
  }
  const part = wanted[0] as (typeof wanted)[number];
  const key = partKey(part);
  const path = uploadPartPath(job.id, key);
  if (parseStoredPart((await args.store.readText(path)) ?? "")) {
    return markDoneAndMaybeFinalize(args, job, key);
  }

  const lock = uploadLockKey(job.id, key);
  const token = randomUUID();
  if (!(await args.kv.setNxEx(lock, token, UPLOAD_LOCK_TTL_SEC))) return workingResult(job);
  const partUsage = emptyUsage();
  // Once the part blob holds its usage, deferring must not count it again.
  let saved = false;
  try {
    if (parseStoredPart((await args.store.readText(path)) ?? "")) {
      return markDoneAndMaybeFinalize(args, job, key);
    }
    const book = parseUploadBook(await args.store.readText(uploadBookPath(job.id)), job);
    if (!book) throw new WorkError("store");
    const chapter = job.chapters.find((c) => c.ch === part.ch);
    if (!chapter) throw new WorkError("store");
    const paras = book.paragraphs
      .filter((p) => p.n >= part.startN && p.n <= part.endN)
      .map((p) => ({ n: p.n, text: p.text }));
    const inputs = await segmentPart(
      args.meta,
      { ch: chapter.ch, title: chapter.title, start_n: part.startN, end_n: part.endN },
      paras,
      partUsage,
    );
    const scenes = inputs.map((s, k) => ({ ...s, id: `w-${key}-${k}`, ch: part.ch }));
    const texts = scenes.map((s) =>
      paras
        .filter((p) => p.n >= s.start_n && p.n <= s.end_n)
        .map((p) => p.text)
        .join("\n"),
    );
    const emotions = await classifyPart(
      scenes,
      texts,
      { bookTitle: job.title, chapterTitle: chapter.title },
      { meta: args.meta, jev: args.jev },
      partUsage,
    );
    // Classify keeps going per scene on errors; past the deadline those
    // misses are the clock, not the book, so retry instead of saving them.
    if (args.signal?.aborted) throw new Error("upload step deadline");
    const stored: StoredPart = {
      part: key,
      ch: part.ch,
      scenes: scenes.map((s, i) => ({
        start_n: s.start_n,
        end_n: s.end_n,
        title: s.title,
        summary: s.summary,
        characters: s.characters,
        ch: s.ch,
        ...(emotions[i] as SceneEmotion),
      })),
      usage: partUsage,
    };
    await args.store.saveJson(path, JSON.stringify(stored));
    saved = true;
    return await markDoneAndMaybeFinalize(args, job, key);
  } catch (e) {
    if (e instanceof UploadFailure) throw e;
    const kind = args.signal?.aborted ? "transient" : upstreamKind(e);
    // Our key is out of credit: stop without burning the part's tries, so
    // the book resumes once credit is back.
    if (kind === "credits" && job.path === "free") {
      await deferPart(args, job, key, saved ? emptyUsage() : partUsage, false);
      throw new UploadFailure("daily_budget_reached");
    }
    let failing = job;
    if (kind === "transient") {
      const deferred = await deferPart(args, job, key, saved ? emptyUsage() : partUsage, true);
      if (deferred.retry) throw new UploadRetry();
      failing = deferred.job;
    }
    await failUploadJob(args.kv, args.store, failing, partUsage);
    throw new UploadFailure("unavailable");
  } finally {
    try {
      await args.kv.releaseIfToken(lock, token);
    } catch {
      // The TTL frees a lock the route kill left behind.
    }
  }
}
