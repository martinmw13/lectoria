import "server-only";
import { randomUUID } from "node:crypto";
import {
  DAILY_IMAGE_LIMIT,
  MSG_CREDITS_OUT,
  MSG_FAILED,
  MSG_HUMAN,
  MSG_QUOTA,
  QUOTA_TTL_SEC,
  LOCK_TTL_SEC,
  buildCaption,
  imageCostMicro,
  imageKey,
  indexKeyFor,
  lockKeyFor,
  quotaKeys,
} from "@/core/images";
import type { ImageGenerator, ImageRequest, ImageResponse, ImageStore, StyleBook } from "@/core/images";
import type { KV } from "@/core/types";
import { addRange, parseRanges, pickReusable, rangeListKeyFor } from "@/core/image-ranges";
import type { ParaRange } from "@/core/image-ranges";
import type { ImageEnv } from "./env";
import { errorTag } from "./errors";
import { buildFinalPrompt } from "./final-prompt";
import { checkHuman } from "@/server/guard/human";
import type { HumanCheckInput } from "@/server/guard/human";
import { refundDualQuota, takeDualQuota } from "@/server/guard/quota";
import { hashIp, ipBucket } from "@/server/guard/request";
import { reserveSpend } from "@/server/guard/spend";
import type { SpendReservation } from "@/server/guard/spend";

export interface ImageContent {
  passageText: string;
  sceneTitle: string;
  sceneClip: string;
  // Chapter pages only: the panel descriptions, built server-side from
  // the chapter's scene summaries. sceneTitle carries the chapter title.
  chapterPanels?: { description: string }[];
  // Optional bookmap reference block, placed by the prompt builders.
  // Empty or absent leaves the prompt byte-identical to the no-bookmap build.
  reference?: string;
  // Trusted book identity for the style line. Absent means Oz.
  book?: StyleBook;
}

export interface OrchestrateDeps {
  kv: KV;
  store: ImageStore;
  generate: ImageGenerator;
  env: ImageEnv;
  content: ImageContent;
  ip: string;
  anonId: string;
  day: string;
  token?: string;
  // Scene holding the selection start; "" skips range reuse.
  sceneId: string;
  // Human gate, checked once on the cache-miss path after the lock.
  // Absent in tests that do not cover the check.
  human?: HumanCheckInput;
  // The reader's own key pays: quota still applies, our spend does not.
  byok?: boolean;
  // Receives the issued human cookie, if any; the handler sets it.
  humanOut?: { setCookie?: string };
}

// One pass, no skipped steps: KV hit -> lock -> human -> Blob backfill ->
// quota -> budget -> generate -> store -> index -> release. Every failure
// after the reserve refunds quota, budget, and the daily counter and
// releases the lock.
export async function orchestrate(
  req: ImageRequest,
  deps: OrchestrateDeps,
): Promise<ImageResponse> {
  const key = imageKey(req);
  const indexKey = indexKeyFor(key);
  const lockKey = lockKeyFor(key);

  // Passage range reuse: an overlapping cached selection serves this one.
  // Scene requests and unknown scenes skip all of it.
  let want: ParaRange | null = null;
  let rangesAt = "";
  let rangeList: ParaRange[] = [];
  if (req.kind === "passage" && deps.sceneId !== "") {
    want = { start: req.n, end: req.endN ?? req.n };
    rangesAt = rangeListKeyFor(req, deps.sceneId);
    rangeList = parseRanges(await deps.kv.get(rangesAt));
  }
  // shortcut: GET+SET can drop a concurrent append, which only costs a future reuse; upgrade to a Redis list if that matters.
  const recordRange = async (): Promise<void> => {
    const self = want;
    if (!self || rangeList.some((r) => r.start === self.start && r.end === self.end)) return;
    try {
      await deps.kv.set(rangesAt, JSON.stringify(addRange(rangeList, self)));
    } catch {
      console.error("image range index failed");
    }
  };

  const indexed = await deps.kv.get(indexKey);
  if (indexed) {
    // Pictures cached before range reuse join the list on their next hit.
    await recordRange();
    return { status: "ready", url: indexed, cached: true, caption: captionFor(req, deps.content) };
  }

  // Reusable range resolved now for the free KV hit; its Blob fallback
  // runs after the human check so probes cannot burn Blob list().
  let bestPath = "";
  let bestIndex = "";
  if (req.kind === "passage" && want) {
    const self = want;
    const best = pickReusable(
      rangeList.filter((r) => r.start !== self.start || r.end !== self.end),
      self,
    );
    if (best) {
      bestPath = imageKey({ ...req, n: best.start, endN: best.end });
      bestIndex = indexKeyFor(bestPath);
      const hit = await deps.kv.get(bestIndex);
      if (hit) {
        return { status: "ready", url: hit, cached: true, caption: captionFor(req, deps.content) };
      }
    }
  }

  const token = deps.token ?? randomUUID();
  if (!(await deps.kv.setNxEx(lockKey, token, LOCK_TTL_SEC))) return { status: "pending" };

  // Best-effort unlock: a release failure must never turn into a client 500.
  const release = async (): Promise<void> => {
    try {
      await deps.kv.releaseIfToken(lockKey, token);
    } catch {
      // Lock expires on its own; nothing to do.
    }
  };

  const keys = quotaKeys({
    day: deps.day,
    ipHash: hashIp(ipBucket(deps.ip, deps.anonId), deps.env.ipSalt),
    anonId: deps.anonId,
  });
  let quotaTaken = false;
  let reservation: SpendReservation | null = null;
  // Best-effort refunds that clear their flag only after the write lands,
  // so the outer catch refunds each reserve exactly once.
  const refundQuotaOnce = async (): Promise<void> => {
    if (quotaTaken) {
      await refundDualQuota(deps.kv, keys);
      quotaTaken = false;
    }
  };
  const releaseSpendOnce = async (): Promise<void> => {
    await reservation?.release();
    reservation = null;
  };

  try {
    if (deps.human) {
      const human = await checkHuman(deps.human);
      if (!human.ok) {
        await release();
        return { status: "error", code: "human", message: MSG_HUMAN };
      }
      if (human.setCookie && deps.humanOut) deps.humanOut.setCookie = human.setCookie;
    }

    // Blob backfill after the human gate, before quota: a hit here takes
    // nothing and releases the lock.
    if (bestPath !== "") {
      const hit = await deps.store.findUrl(bestPath);
      if (hit) {
        try {
          await deps.kv.set(bestIndex, hit);
        } catch {
          console.error("image index failed");
        }
        await release();
        return { status: "ready", url: hit, cached: true, caption: captionFor(req, deps.content) };
      }
    }
    const existing = await deps.store.findUrl(key);
    if (existing) {
      try {
        await deps.kv.set(indexKey, existing);
      } catch {
        console.error("image index failed");
      }
      await recordRange();
      await release();
      return { status: "ready", url: existing, cached: true, caption: captionFor(req, deps.content) };
    }

    const quota = await takeDualQuota(deps.kv, keys, {
      limit: DAILY_IMAGE_LIMIT,
      ttlSec: QUOTA_TTL_SEC,
    });
    if (!quota.ok) {
      await release();
      return { status: "error", code: "quota", message: MSG_QUOTA };
    }
    quotaTaken = true;

    // Both caps apply only to requests paid with our key; the reader's
    // own key skips them while the per-person quota above still applies.
    if (!deps.byok) {
      const spent = await reserveSpend(deps.kv, {
        amountMicro: imageCostMicro(),
        day: deps.day,
        spendCapMicro: deps.env.spendCapMicro,
        dailySpendCapMicro: deps.env.dailySpendCapMicro,
      });
      if (!spent.ok) {
        await releaseSpendOnce();
        await refundQuotaOnce();
        await release();
        return spent.which === "total"
          ? { status: "error", code: "budget", message: MSG_CREDITS_OUT }
          : { status: "error", code: "daily_budget", message: MSG_CREDITS_OUT };
      }
      reservation = spent.reservation;
    }

    let bytes: Uint8Array;
    try {
      bytes = await deps.generate.generate(
        buildFinalPrompt({
          kind: req.kind,
          passageText: deps.content.passageText,
          sceneTitle: deps.content.sceneTitle,
          sceneClip: deps.content.sceneClip,
          chapterPanels: deps.content.chapterPanels,
          style: req.style,
          book: deps.content.book,
          reference: deps.content.reference,
        }),
      );
    } catch (e) {
      await releaseSpendOnce();
      await refundQuotaOnce();
      await release();
      console.error(`image generate failed: ${errorTag(e)}`);
      return { status: "error", code: "unavailable", message: MSG_FAILED };
    }

    try {
      const url = await deps.store.save(key, bytes);
      try {
        await deps.kv.set(indexKey, url);
      } catch {
        console.error("image index failed");
        await recordRange();
        await release();
        return { status: "ready", url, cached: false, caption: captionFor(req, deps.content) };
      }
      await recordRange();
      await release();
      return { status: "ready", url, cached: false, caption: captionFor(req, deps.content) };
    } catch (e) {
      // A lost save race leaves the winner's file behind; backfill from it.
      const raced = await deps.store.findUrl(key);
      if (raced) {
        try {
          await deps.kv.set(indexKey, raced);
        } catch {
          console.error("image index failed");
        }
        await recordRange();
        await release();
        return { status: "ready", url: raced, cached: true, caption: captionFor(req, deps.content) };
      }
      await releaseSpendOnce();
      await refundQuotaOnce();
      await release();
      console.error(`image store failed: ${errorTag(e)}`);
      return { status: "error", code: "unavailable", message: MSG_FAILED };
    }
  } catch (e) {
    await releaseSpendOnce();
    await refundQuotaOnce();
    await release();
    console.error(`image request failed: ${errorTag(e)}`);
    return { status: "error", code: "unavailable", message: MSG_FAILED };
  }
}

function captionFor(req: ImageRequest, content: ImageContent): string {
  return buildCaption({
    kind: req.kind,
    sceneTitle: content.sceneTitle,
    passageText: content.passageText,
  });
}
