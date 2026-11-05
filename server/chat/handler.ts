import "server-only";
import {
  BYOK_HEADER,
  CHAT_BYOK_DAILY_LIMIT,
  CHAT_DAILY_LIMIT,
  CHAT_MAX_ANSWER_CHARS,
  CHAT_MAX_BODY_BYTES,
  CHAT_MESSAGES,
  HTTP_STATUS,
  bookTextUpTo,
  buildChatSystemPrompt,
  chatQuotaKeys,
  encodeSse,
  estimateCostMicro,
  parseChatRequest,
  usageCostMicro,
} from "@/core/chat";
import type { ChatErrorBody, ChatErrorCode, ChatRequest } from "@/core/chat";
import { answerCacheKey, isCommonQuestion, normalizeQuestion } from "@/core/chat-cache";
import type { KV } from "@/core/types";
import { isUploadId } from "@/core/uploads";
import { isKnownBookId, loadBook, loadBookData } from "@/server/books";
import type { BookPayload } from "@/server/books";
import {
  issueAnonId,
  parseAnonCookie,
  serializeAnonCookie,
  verifyAnonCookie,
} from "@/server/guard/anon";
import { readBodyCapped } from "@/server/guard/body";
import { checkHuman } from "@/server/guard/human";
import { createRestKV } from "@/server/guard/kv";
import { CHAT_QUOTA_TTL_SEC, refundDualQuota, takeDualQuota } from "@/server/guard/quota";
import { clientIp, hashIp, ipBucket, rejectsCrossSite, utcDay } from "@/server/guard/request";
import { reserveSpend } from "@/server/guard/spend";
import type { SpendReservation } from "@/server/guard/spend";
import { createKvAnswerCache, selectAnswerCache } from "./answer-cache";
import type { AnswerCache } from "./answer-cache";
import { readChatEnv } from "./env";
import type { ChatEnv } from "./env";
import { createChatStreamer } from "./stream";
import type { ChatStreamChunk, ChatStreamer, UpstreamMessage } from "./stream";

export interface ChatHandlerDeps {
  env?: ChatEnv;
  kv?: KV;
  createStreamer?: (args: { apiKey: string; fetchFn: typeof fetch }) => ChatStreamer;
  fetchFn?: typeof fetch;
  now?: Date;
  loadBook?: (bookId: string) => Promise<BookPayload>;
  answerCache?: AnswerCache;
}

// Expected failures (bad input, over limit, missing env, spent budget)
// warn; only a truly unexpected crash (upstream or ours) errors. Names
// only, never request text, keys, or error values.
function fail(
  code: ChatErrorCode,
  ch: number | "?",
  cookies: string[],
  unexpected = false,
  book: string | "?" = "?",
): Response {
  if (unexpected) console.error(`chat ${code} book=${book} ch=${ch}`);
  else console.warn(`chat ${code} book=${book} ch=${ch}`);
  const headers = new Headers();
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return Response.json(
    { status: "error", code, message: CHAT_MESSAGES[code] } satisfies ChatErrorBody,
    { status: HTTP_STATUS[code], headers },
  );
}

function isAsciiPrintable(text: string): boolean {
  return /^[\x20-\x7E]+$/.test(text);
}

// Order: body cap and shape, env, Turnstile, anonymous cookie, per-person
// quota, global caps, upstream. A question that produced no token refunds
// its quota and spend reserves; mid-stream failures do not.
export async function handleChatPost(req: Request, deps: ChatHandlerDeps = {}): Promise<Response> {
  const cookies: string[] = [];

  if (rejectsCrossSite(req.headers, req.url)) return fail("bad_request", "?", cookies);

  const capped = await readBodyCapped(req, CHAT_MAX_BODY_BYTES);
  if (!capped.ok) return fail(capped.reason === "too_large" ? "too_large" : "bad_request", "?", cookies);

  let body: ChatRequest;
  try {
    body = parseChatRequest(JSON.parse(capped.text));
  } catch {
    return fail("bad_request", "?", cookies);
  }
  if (!isKnownBookId(body.bookId) && !isUploadId(body.bookId))
    return fail("bad_request", "?", cookies, false, body.bookId);

  let env = deps.env;
  if (!env) {
    try {
      env = readChatEnv();
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      const prefix = "missing chat env:";
      console.warn(`chat env missing: ${message.startsWith(prefix) ? message.slice(prefix.length).trim() : ""}`);
      return fail("unavailable", "?", cookies, false, body.bookId);
    }
  }

  const fetchFn = deps.fetchFn ?? fetch;
  const ip = clientIp(req.headers);
  const human = await checkHuman({
    cookieHeader: req.headers.get("cookie"),
    token: body.turnstileToken,
    ip,
    turnstileSecret: env.turnstileSecret,
    turnstileSiteKey: env.turnstileSiteKey,
    sessionSecret: env.sessionSecret,
    fetchFn,
  });
  if (!human.ok) return fail("human", "?", cookies, false, body.bookId);
  if (human.setCookie) cookies.push(human.setCookie);

  let anonId = verifyAnonCookie(parseAnonCookie(req.headers.get("cookie")), env.sessionSecret);
  if (!anonId) {
    const issued = issueAnonId(env.sessionSecret);
    anonId = issued.id;
    cookies.push(serializeAnonCookie(issued.value));
  }

  const rawByok = req.headers.get(BYOK_HEADER);
  let byokKey: string | null = null;
  if (rawByok !== null) {
    const trimmed = rawByok.trim();
    if (trimmed.length < 8 || trimmed.length > 400 || !isAsciiPrintable(trimmed)) {
      return fail("bad_request", "?", cookies, false, body.bookId);
    }
    byokKey = trimmed;
  }
  const byok = byokKey !== null;
  const limit = byok ? CHAT_BYOK_DAILY_LIMIT : CHAT_DAILY_LIMIT;

  const kv = deps.kv ?? createRestKV(env.upstashUrl, env.upstashToken);
  const day = utcDay(deps.now ?? new Date());
  const keys = chatQuotaKeys({
    day,
    ipHash: hashIp(ipBucket(ip, anonId), env.ipSalt),
    anonId,
    byok,
  });

  let quotaTaken = false;
  let reservation: SpendReservation | null = null;
  // Each reserve is refunded at most once: flags clear only after the
  // write lands, like the images orchestrate path.
  const refundQuotaOnce = async (): Promise<void> => {
    if (quotaTaken) {
      await refundDualQuota(kv, keys);
      quotaTaken = false;
    }
  };
  const releaseSpendOnce = async (): Promise<void> => {
    await reservation?.release();
    reservation = null;
  };
  const refundAll = async (): Promise<void> => {
    await releaseSpendOnce();
    await refundQuotaOnce();
  };
  try {
    const taken = await takeDualQuota(kv, keys, { limit, ttlSec: CHAT_QUOTA_TTL_SEC });
    if (!taken.ok) return fail("quota", "?", cookies, false, body.bookId);
    quotaTaken = true;
    const remaining = limit - Math.max(taken.ipCount, taken.anonCount);

    // Shelf books keep loadBookData (known but unready books still chat);
    // finished uploads load through the loader pictures use. A missing,
    // unfinished, or expired upload answers 400, with the quota given back.
    let book: BookPayload["book"];
    let scenes: BookPayload["scenes"];
    try {
      ({ book, scenes } = isUploadId(body.bookId)
        ? await (deps.loadBook ?? loadBook)(body.bookId)
        : await loadBookData(body.bookId));
    } catch {
      if (!isUploadId(body.bookId)) throw new Error("chat book load failed");
      await refundAll();
      return fail("bad_request", "?", cookies, false, body.bookId);
    }
    const maxN = book.paragraphs.reduce((m, p) => Math.max(m, p.n), 0);
    const clampedN = Math.min(body.upToN, maxN);
    const chapter =
      book.chapters.find((c) => clampedN >= c.start_n && clampedN <= c.end_n) ??
      book.chapters[book.chapters.length - 1];
    if (!chapter) return fail("unavailable", "?", cookies, false, body.bookId);

    // Shared-answer cache, only for a first recap-type question about a
    // shelf book, owner key, no spoilers. BYOK and uploads never touch it.
    // The answer is drawn from the text before the reader's scene, so
    // everyone in that scene may see it and no one sees past where they are.
    const question = body.messages[0]?.content ?? "";
    const normalized = normalizeQuestion(question);
    const scene = scenes.find((sc) => clampedN >= sc.start_n && clampedN <= sc.end_n);
    const cacheable =
      !byok &&
      !isUploadId(body.bookId) &&
      !body.spoilers &&
      body.messages.length === 1 &&
      scene !== undefined &&
      scene.start_n > 1 &&
      isCommonQuestion(normalized);
    const textUpTo = cacheable && scene ? scene.start_n - 1 : body.upToN;
    const system = buildChatSystemPrompt({
      title: book.title,
      author: book.author,
      chapterNumber: chapter.ch,
      chapterTitle: chapter.title,
      spoilers: body.spoilers,
      bookText: bookTextUpTo(book.paragraphs, book.chapters, textUpTo, body.spoilers),
    });
    const answerCache: AnswerCache | null = cacheable
      ? (deps.answerCache ?? (deps.kv ? createKvAnswerCache(kv) : selectAnswerCache(kv)))
      : null;
    const cacheKey =
      answerCache && scene
        ? answerCacheKey({
            bookId: body.bookId,
            textVersion: book.textVersion,
            sceneId: scene.id,
            normalizedQuestion: normalized,
            systemPrompt: system,
          })
        : null;
    if (answerCache && cacheKey) {
      const hit = await answerCache.get(cacheKey);
      if (hit !== null) {
        console.info(`chat cache hit book=${body.bookId} ch=${chapter.ch}`);
        const headers = new Headers({ "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
        for (const cookie of cookies) headers.append("Set-Cookie", cookie);
        return new Response(encodeSse("delta", { text: hit }) + encodeSse("done", { remaining }), { headers });
      }
    }
    const messages: UpstreamMessage[] = [{ role: "system", content: system }, ...body.messages];

    // A Redis failure between reserves must give back what was taken.
    try {
      if (!byok) {
        const spent = await reserveSpend(kv, {
          amountMicro: estimateCostMicro(messages.reduce((sum, m) => sum + m.content.length, 0)),
          day,
          spendCapMicro: env.spendCapMicro,
          dailySpendCapMicro: env.dailySpendCapMicro,
        });
        if (!spent.ok) {
          await refundAll();
          return fail("byok_required", chapter.ch, cookies, false, body.bookId);
        }
        reservation = spent.reservation;
      }
    } catch {
      await refundAll().catch(() => undefined);
      return fail("unavailable", chapter.ch, cookies, true, body.bookId);
    }

    const createStreamer = deps.createStreamer ?? createChatStreamer;
    const streamer = createStreamer({ apiKey: byokKey ?? env.metaKey, fetchFn });
    const iter = streamer.stream({ messages, signal: req.signal })[Symbol.asyncIterator]();

    let headText: string | null = null;
    let usage: { promptTokens: number; cachedTokens: number; completionTokens: number } | null = null;
    try {
      let current = await iter.next();
      for (;;) {
        if (current.done) break;
        const chunk: ChatStreamChunk = current.value;
        if (chunk.type === "usage") {
          usage = chunk;
          current = await iter.next();
        } else {
          headText = chunk.text;
          break;
        }
      }
    } catch (e) {
      // Stream errors carry only a status number or a timeout word.
      const reason = e instanceof Error && e.message.startsWith("chat upstream") ? e.message : "chat upstream error";
      console.warn(reason);
      await refundAll();
      return fail("unavailable", chapter.ch, cookies, true, body.bookId);
    }
    if (headText === null) {
      console.warn("chat upstream empty answer");
      await refundAll();
      return fail("unavailable", chapter.ch, cookies, true, body.bookId);
    }
    const firstText: string = headText;

    const headers = new Headers({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    });
    for (const cookie of cookies) headers.append("Set-Cookie", cookie);

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: string, data: unknown): void => {
          try {
            controller.enqueue(encoder.encode(encodeSse(event, data)));
          } catch {
            // Client went away mid-write.
          }
        };
        const close = (): void => {
          try {
            controller.close();
          } catch {
            // Already closed.
          }
        };
        let sent = 0;
        let answer = "";
        let usageState = usage;
        const pushText = (text: string): void => {
          const room = CHAT_MAX_ANSWER_CHARS - sent;
          if (room <= 0) return;
          const slice = text.slice(0, room);
          sent += slice.length;
          answer += slice;
          send("delta", { text: slice });
        };
        try {
          pushText(firstText);
          for (;;) {
            let next: IteratorResult<ChatStreamChunk>;
            try {
              next = await iter.next();
            } catch {
              if (!req.signal.aborted) {
                send("error", { code: "unavailable", message: CHAT_MESSAGES.unavailable });
              }
              close();
              return;
            }
            if (next.done) break;
            if (next.value.type === "usage") usageState = next.value;
            else pushText(next.value.text);
          }
        } catch {
          if (!req.signal.aborted) {
            send("error", { code: "unavailable", message: CHAT_MESSAGES.unavailable });
          }
          close();
          return;
        }
        if (!byok && reservation) {
          // No usage block: keep the whole reserve rather than refund a real answer.
          const diff = usageState ? usageCostMicro(usageState) - reservation.amountMicro : 0;
          await reservation.adjust(diff);
        }
        if (answerCache && cacheKey && answer.trim().length > 0 && !req.signal.aborted) {
          await answerCache.set(cacheKey, answer);
        }
        send("done", byok ? {} : { remaining });
        close();
      },
      cancel() {
        void iter.return?.(undefined);
      },
    });
    return new Response(stream, { headers });
  } catch {
    await refundAll().catch(() => undefined);
    return fail("unavailable", "?", cookies, true, body.bookId);
  }
}
