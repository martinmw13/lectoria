import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { KV } from "@/core/types";
import { UPLOAD_TTL_DAYS, isUploadId } from "@/core/uploads";
import { createImageCleanupStore, type ImageCleanupStore } from "@/server/images/blob";
import { usable } from "@/server/guard/env";
import { createRestKV } from "@/server/guard/kv";
import { createUploadStore, type UploadStore } from "./blob";
import { failUploadJob, loadUploadJob, uploadRefundKey } from "./state";

// Jobs still working past this hold a reserve for work that will never
// land; the daily cron settles them to their recorded usage and fails them.
export const UPLOAD_STALE_MS = 6 * 3600 * 1000;

// Settles stale working jobs discovered through their blobs, plus failed
// jobs still missing the refund marker (a fail that died mid-save under
// the old order). Exactly once per job via the settle guard, so a retry
// never double-adjusts. Done jobs are never touched.
async function reconcileStaleJobs(kv: KV, store: UploadStore, paths: string[], nowMs: number): Promise<number> {
  const ids = new Set<string>();
  for (const path of paths) {
    const id = path.split("/")[1];
    if (id && isUploadId(id)) ids.add(id);
  }
  let reconciled = 0;
  for (const id of ids) {
    let job;
    try {
      job = await loadUploadJob(kv, id);
    } catch {
      continue;
    }
    if (!job || job.status === "done") continue;
    if (job.status === "working") {
      if (job.reservedMicro <= 0) continue;
      if (nowMs - job.createdAt <= UPLOAD_STALE_MS) continue;
    } else {
      let settled: string | null;
      try {
        settled = await kv.get(uploadRefundKey(id));
      } catch {
        continue;
      }
      if (settled) continue;
    }
    await failUploadJob(kv, store, job);
    reconciled += 1;
  }
  return reconciled;
}

// Deletes upload blobs older than the TTL and settles stale working jobs
// plus unmarked failed jobs to their recorded usage. Job state in Redis
// expires on its own; only Blob needs sweeping. Upload pictures live in
// the public image store under images/u-... and sweep with the same TTL.
// One failure never stops the rest.
export async function cleanupUploads(
  store: UploadStore,
  nowMs: number = Date.now(),
  deps: { kv?: KV; imageStore?: ImageCleanupStore } = {},
): Promise<{ deleted: number; reconciled: number }> {
  const cutoff = nowMs - UPLOAD_TTL_DAYS * 24 * 3600 * 1000;
  const blobs = await store.listAll("uploads/");
  let deleted = 0;
  for (const blob of blobs) {
    if (blob.uploadedAt >= cutoff) continue;
    try {
      await store.remove(blob.pathname);
      deleted += 1;
    } catch {
      // The next daily run retries.
    }
  }
  if (deps.imageStore) {
    let images: { pathname: string; uploadedAt: number }[];
    try {
      images = await deps.imageStore.listAll("images/u-");
    } catch {
      images = [];
    }
    for (const blob of images) {
      const id = blob.pathname.split("/")[1];
      if (!id || !isUploadId(id)) continue;
      if (blob.uploadedAt >= cutoff) continue;
      try {
        await deps.imageStore.remove(blob.pathname);
        deleted += 1;
      } catch {
        // The next daily run retries.
      }
    }
  }
  const reconciled = deps.kv ? await reconcileStaleJobs(deps.kv, store, blobs.map((b) => b.pathname), nowMs) : 0;
  return { deleted, reconciled };
}

function matchesBearer(auth: string, secret: string): boolean {
  const expected = `Bearer ${secret}`;
  if (auth.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(auth), Buffer.from(expected));
}

// Vercel cron calls this daily with CRON_SECRET as the Bearer [REDACTED] Any
// auth failure answers 404 so the route stays hidden.
export async function handleCleanup(
  req: Request,
  deps: { store?: UploadStore; secret?: string; token?: string; kv?: KV; imageStore?: ImageCleanupStore } = {},
): Promise<Response> {
  const secret = deps.secret ?? usable(process.env.CRON_SECRET);
  if (!secret || !matchesBearer(req.headers.get("authorization") ?? "", secret)) {
    return Response.json({ status: "error", code: "not_found" }, { status: 404 });
  }
  // Same private store as the routes; never the public image store.
  const token = deps.token ?? usable(process.env.UPLOADS_BLOB_READ_WRITE_TOKEN);
  if (!deps.store && !token) {
    console.warn("upload cleanup unavailable");
    return Response.json({ status: "error", code: "unavailable" }, { status: 503 });
  }
  let kv = deps.kv;
  if (!kv) {
    const url = usable(process.env.UPSTASH_REDIS_REST_URL) ?? usable(process.env.KV_REST_API_URL);
    const kvToken = usable(process.env.UPSTASH_REDIS_REST_TOKEN) ?? usable(process.env.KV_REST_API_TOKEN);
    if (url?.startsWith("https://") && kvToken) kv = createRestKV(url, kvToken);
    // Without Redis the cron still sweeps blobs and skips the reconcile.
  }
  try {
    // Upload pictures sweep from the default image store, never the
    // private uploads token.
    const out = await cleanupUploads(deps.store ?? createUploadStore(token as string), Date.now(), {
      ...(kv ? { kv } : {}),
      imageStore: deps.imageStore ?? createImageCleanupStore(),
    });
    return Response.json({ status: "ok", deleted: out.deleted });
  } catch {
    console.error("upload cleanup failed");
    return Response.json({ status: "error", code: "unavailable" }, { status: 503 });
  }
}
