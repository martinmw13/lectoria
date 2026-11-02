// Client driver for POST /api/uploads plus the step loop. The key and
// the human token arrive as arguments and stay in memory; nothing here
// touches storage, logs, or the URL.
import { BYOK_HEADER } from "@/core/chat";
import type { RawSection } from "@/core/clean-types";
import { isUploadId, UPLOAD_MESSAGES, type UploadErrorCode } from "@/core/uploads";

export type FlowCode = UploadErrorCode | "network";

export const STEP_RETRIES = 3;
const BACKOFF_MS = [500, 1000, 2000];

export interface FlowProgress {
  jobId: string;
  done: number;
  total: number;
  chapters: number;
}

export interface DriveOpts {
  title: string;
  author: string | null;
  sections: RawSection[];
  key: string | null;
  token: string | null;
  friendCode?: string | null;
  jobId: string | null;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  onProgress?: (progress: FlowProgress) => void;
  onFriendAccepted?: (accepted: boolean) => void;
}

export class UploadFlowError extends Error {
  code: FlowCode;
  jobId: string | null;
  constructor(code: FlowCode, jobId: string | null) {
    super(code);
    this.name = "UploadFlowError";
    this.code = code;
    this.jobId = jobId;
  }
}

function isCode(value: unknown): value is UploadErrorCode {
  return typeof value === "string" && value in UPLOAD_MESSAGES;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("aborted"));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function headersFor(key: string | null): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(key ? { [BYOK_HEADER]: key } : {}),
  };
}

interface StepOutcome {
  done: boolean;
  progress: FlowProgress;
}

// One step attempt: coded errors surface at once (the UI maps them to
// the BYOK step or a retry note); only network failures and uncoded
// 5xx responses come back as retryable.
async function attemptStep(
  opts: DriveOpts,
  jobId: string,
  token: string | null,
  chapters: number,
): Promise<StepOutcome> {
  const fetchFn = opts.fetchFn ?? fetch;
  let res: Response;
  try {
    res = await fetchFn(`/api/uploads/${jobId}/step`, {
      method: "POST",
      headers: headersFor(opts.key),
      body: JSON.stringify(token ? { turnstileToken: token } : {}),
      signal: opts.signal,
    });
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    throw new UploadFlowError("network", jobId);
  }
  const json = await readJson(res);
  const body = (typeof json === "object" && json !== null ? json : {}) as Record<string, unknown>;
  if (body.status === "error" && isCode(body.code)) {
    throw new UploadFlowError(body.code, jobId);
  }
  if (res.status >= 500) throw new UploadFlowError("network", jobId);
  if ((body.status === "working" || body.status === "done") && isCount(body.done) && isCount(body.total)) {
    const progress = { jobId, done: body.done, total: body.total, chapters };
    return { done: body.status === "done", progress };
  }
  if (body.status === "error") throw new UploadFlowError("bad_request", jobId);
  throw new UploadFlowError("unavailable", jobId);
}

// Drives create (once: every attempt can take quota) then steps until
// done. Resuming reuses the job id, so progress continues from the
// server's done/total. Steps retry network failures and uncoded 5xx.
export async function driveUpload(opts: DriveOpts): Promise<{ id: string; chapters: number }> {
  const fetchFn = opts.fetchFn ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => defaultSleep(ms, opts.signal));
  let token = opts.token;
  let jobId = opts.jobId;
  let chapters = 0;
  if (!jobId) {
    let res: Response;
    try {
      res = await fetchFn("/api/uploads", {
        method: "POST",
        headers: headersFor(opts.key),
        body: JSON.stringify({
          title: opts.title,
          author: opts.author,
          sections: opts.sections,
          ...(token ? { turnstileToken: token } : {}),
          ...(opts.friendCode ? { friendCode: opts.friendCode } : {}),
        }),
        signal: opts.signal,
      });
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      throw new UploadFlowError("network", null);
    }
    token = null; // Single use: later steps ride the human cookie. secret-scan:allow (not a secret)
    const json = await readJson(res);
    const body = (typeof json === "object" && json !== null ? json : {}) as Record<string, unknown>;
    if (body.status === "error" && isCode(body.code)) throw new UploadFlowError(body.code, null);
    if (
      body.status !== "created" ||
      !isUploadId(body.id) ||
      !isCount(body.chapters) ||
      !isCount(body.parts)
    ) {
      throw new UploadFlowError("unavailable", null);
    }
    jobId = body.id;
    chapters = body.chapters;
    // Only an exact true counts; the code itself never leaves this boolean.
    opts.onFriendAccepted?.(body.friendAccepted === true);
    opts.onProgress?.({ jobId, done: 0, total: body.parts, chapters });
  }
  for (;;) {
    let attempt = 0;
    for (;;) {
      try {
        const outcome = await attemptStep(opts, jobId, token, chapters);
        token = null;
        opts.onProgress?.(outcome.progress);
        if (outcome.done) return { id: jobId, chapters };
        break;
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        // Only the retryable shape loops; coded errors fail at once.
        const retryable = err instanceof UploadFlowError && err.code === "network";
        if (!retryable || attempt >= STEP_RETRIES) throw err;
        await sleep(BACKOFF_MS[attempt] ?? 2000);
        attempt += 1;
      }
    }
  }
}
