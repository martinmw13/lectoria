import "server-only";
import { createHash } from "node:crypto";
import type { KV } from "@/core/types";
import type { Chapter, Paragraph } from "@/core/types";
import { cleanDeterministic, cleanSections, type Judge } from "@/core/clean";
import { canonicalLines } from "@/core/gutenberg";
import { paragraphId } from "@/core/ids";
import {
  BYOK_BOOK_MAX_WORDS,
  FREE_BOOK_MAX_WORDS,
  FRIEND_UPLOAD_RESERVE_MICRO,
  UPLOAD_MAX_CHAPTERS,
  UPLOAD_DAILY_SPEND_CAP_MICRO,
  UPLOAD_RESERVE_MICRO,
  countChapterWords,
  newUploadId,
  splitChapterParts,
  uploadBookPath,
  uploadDailySpendKey,
  uploadReserveMicro,
  type UploadCreateBody,
} from "@/core/uploads";
import {
  BOOK_QUOTA_TTL_SEC,
  BYOK_UPLOADS_PER_PERSON,
  FREE_BOOKS_PER_PERSON,
  FRIEND_BOOKS_PER_PERSON,
  refundDualQuota,
  takeDualQuota,
} from "@/server/guard/quota";
import { reserveSpend } from "@/server/guard/spend";
import type { SpendReservation } from "@/server/guard/spend";
import { createCleanJudge } from "../../pipeline/clean-judge";
import type { MetaClient } from "../../pipeline/meta";
import type { UploadStore } from "./blob";
import { emptyUsage, saveUploadJob, UploadFailure, type UploadJob } from "./state";

export interface UploadBook {
  id: string;
  title: string;
  author: string;
  chapters: Chapter[];
  paragraphs: Paragraph[];
  textVersion: string;
}

// Same ordinals and hash input as the Gutenberg path, without the
// Gutenberg source block: uploads are reader books, not shelf books.
export function buildUploadBook(
  id: string,
  title: string,
  author: string | null,
  drafts: { title: string; paragraphs: string[] }[],
): UploadBook {
  const chapters: Chapter[] = [];
  const paragraphs: Paragraph[] = [];
  let n = 0;
  drafts.forEach((draft, index) => {
    const ch = index + 1;
    const start_n = n + 1;
    draft.paragraphs.forEach((text, k) => {
      n += 1;
      paragraphs.push({ id: paragraphId(ch, k + 1), ch, n, text });
    });
    chapters.push({ ch, title: draft.title, start_n, end_n: n });
  });
  const textVersion = `sha256:${createHash("sha256").update(canonicalLines(paragraphs)).digest("hex")}`;
  // The reader prints the author, so a missing one becomes Unknown here.
  return { id, title, author: author ?? "Unknown", chapters, paragraphs, textVersion };
}

export interface CreateArgs {
  kv: KV;
  store: UploadStore;
  meta: MetaClient;
  body: UploadCreateBody;
  path: "free" | "byok";
  anonId: string;
  day: string;
  quotaKeys: { ip: string; anon: string } | null;
  spendCapMicro: number;
  judgeBudgetMs?: number;
  // True when a valid friend code was accepted for this create: the
  // free path uses the friend limit on the same quota keys.
  friendAccepted?: boolean;
}

// Total wall clock the cleaning judge may take inside the create request.
// The per-call timeout still applies beneath; retries that outlast this
// just lose, and the book keeps its deterministic chapters.
export const CLEAN_JUDGE_BUDGET_MS = 25_000;

function judgeWithBudget(judge: Judge, ms: number): Judge {
  return async (input) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    });
    try {
      return await Promise.race([judge(input), expired]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
}

// Parts estimate for sizing the hold: the judge runs after the reserve,
// so count from the deterministic preview with the same splitter.
function estimatePartCount(chapters: { paragraphs: string[] }[]): number {
  let n = 0;
  const pseudo = chapters.map((chapter, index) => {
    const start = n + 1;
    n += chapter.paragraphs.length;
    return { ch: index + 1, start_n: start, end_n: n };
  });
  return splitChapterParts(pseudo).length;
}

// Validate on the cleaned text first so user errors never take quota;
// the judge runs after the spend reserve, and its failure just keeps the
// deterministic chapters. Any throw after the quota or reserve refunds
// everything. Spend is free-only, but both paths take a per-person quota.
export async function createUpload(args: CreateArgs): Promise<{ id: string; chapters: number; parts: number }> {
  const preview = cleanDeterministic(args.body.title, args.body.sections);
  if (preview.chapters.length === 0 || preview.chapters.length > UPLOAD_MAX_CHAPTERS) {
    throw new UploadFailure("bad_request");
  }
  // friendAccepted was re-validated in the handler; the client hint is never trusted.
  const limit = args.path === "free" && !args.friendAccepted ? FREE_BOOK_MAX_WORDS : BYOK_BOOK_MAX_WORDS;
  const previewWords = countChapterWords(preview.chapters);
  if (previewWords > limit) throw new UploadFailure("too_long");

  let quotaTaken = false;
  let reservation: SpendReservation | null = null;
  let reservedMicro = 0;
  try {
    if (args.quotaKeys) {
      const taken = await takeDualQuota(args.kv, args.quotaKeys, {
        limit:
          args.path === "free"
            ? args.friendAccepted
              ? FRIEND_BOOKS_PER_PERSON
              : FREE_BOOKS_PER_PERSON
            : BYOK_UPLOADS_PER_PERSON,
        ttlSec: BOOK_QUOTA_TTL_SEC,
      });
      if (!taken.ok) throw new UploadFailure("daily_books_reached");
      quotaTaken = true;
      if (args.path === "free") {
        reservedMicro = uploadReserveMicro(
          estimatePartCount(preview.chapters),
          previewWords,
          args.friendAccepted ? FRIEND_UPLOAD_RESERVE_MICRO : UPLOAD_RESERVE_MICRO,
        );
        const spent = await reserveSpend(args.kv, {
          amountMicro: reservedMicro,
          day: args.day,
          spendCapMicro: args.spendCapMicro,
          dailySpendCapMicro: UPLOAD_DAILY_SPEND_CAP_MICRO,
          dailyKey: uploadDailySpendKey(args.day),
        });
        if (!spent.ok) throw new UploadFailure("daily_budget_reached");
        reservation = spent.reservation;
      }
    }

    const usage = emptyUsage();
    const judge = judgeWithBudget(createCleanJudge(args.meta), args.judgeBudgetMs ?? CLEAN_JUDGE_BUDGET_MS);
    const cleaned = await cleanSections(args.body.title, args.body.sections, judge);
    const llm = cleaned.report.llm;
    if (llm && llm.model !== "unknown") {
      usage.metaRequests += 1;
      usage.metaPrompt += llm.promptTokens;
      usage.metaCached += llm.cachedTokens;
      usage.metaCompletion += llm.completionTokens;
    }
    if (cleaned.chapters.length === 0) throw new UploadFailure("bad_request");

    const id = newUploadId();
    const book = buildUploadBook(id, args.body.title, args.body.author, cleaned.chapters);
    const parts = splitChapterParts(book.chapters);
    const job: UploadJob = {
      v: 1,
      id,
      path: args.path,
      anonId: args.path === "free" ? args.anonId : null,
      day: args.day,
      createdAt: Date.now(),
      title: book.title,
      author: book.author,
      textVersion: book.textVersion,
      chapters: book.chapters.map((c) => ({ ch: c.ch, title: c.title, start_n: c.start_n, end_n: c.end_n })),
      parts,
      doneParts: [],
      status: "working",
      usage,
      reservedMicro,
      quotaIp: args.quotaKeys ? args.quotaKeys.ip : null,
      quotaAnon: args.quotaKeys ? args.quotaKeys.anon : null,
      costMicro: null,
    };
    await args.store.saveJson(uploadBookPath(id), JSON.stringify(book));
    await saveUploadJob(args.kv, job);
    return { id, chapters: book.chapters.length, parts: parts.length };
  } catch (e) {
    // Both refunds are best effort and never throw, so the original error
    // always survives. A Blob orphan here ages out via the cleanup cron.
    await reservation?.release();
    if (quotaTaken && args.quotaKeys) await refundDualQuota(args.kv, args.quotaKeys);
    if (e instanceof UploadFailure) throw e;
    throw new UploadFailure("unavailable");
  }
}
