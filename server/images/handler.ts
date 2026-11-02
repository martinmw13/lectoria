import "server-only";
import { BYOK_HEADER } from "@/core/chat";
import { classifyInputOf } from "@/core/fingerprint";
import { isUploadId } from "@/core/uploads";
import { isReadyBookId, loadBook } from "@/server/books";
import type { BookPayload } from "@/server/books";
import {
  ImageStyleError,
  MAX_IMAGE_BODY_BYTES,
  MSG_BAD_REQUEST,
  MSG_STYLE,
  MSG_UNAVAILABLE,
  parseImageRequest,
  validateAgainstBook,
} from "@/core/images";
import { chapterPanels } from "@/core/panels";
import type { ImageGenerator, ImageRequest, ImageResponse, ImageStore } from "@/core/images";
import type { KV } from "@/core/types";
import { issueAnonId, parseAnonCookie, serializeAnonCookie, verifyAnonCookie } from "@/server/guard/anon";
import { readBodyCapped } from "@/server/guard/body";
import { createRestKV } from "@/server/guard/kv";
import { clientIp, rejectsCrossSite, utcDay } from "@/server/guard/request";
import { readImageEnv } from "./env";
import type { ImageEnv } from "./env";
import { errorTag } from "./errors";
import { createBlobStore } from "./blob";
import { chapterReference, getBookmap, passageReference } from "./bookmap-prompt";
import { createMetaClient } from "./meta";
import { orchestrate } from "./orchestrate";
import type { ImageContent } from "./orchestrate";

function toResponse(res: ImageResponse): { json: ImageResponse; status: number } {
  if (res.status === "ready" || res.status === "pending") return { json: res, status: 200 };
  const status =
    res.code === "bad_request" ? 400 : res.code === "quota" ? 429 : res.code === "human" ? 403 : 503;
  return { json: res, status };
}

export interface ImagesHandlerDeps {
  env?: ImageEnv;
  kv?: KV;
  store?: ImageStore;
  generate?: ImageGenerator;
  fetchFn?: typeof fetch;
  loadBook?: (bookId: string) => Promise<BookPayload>;
}

function isAsciiPrintable(text: string): boolean {
  return /^[\x20-\x7E]+$/.test(text);
}

export async function handleImagesPost(req: Request, deps: ImagesHandlerDeps = {}): Promise<Response> {
  if (rejectsCrossSite(req.headers, req.url)) {
    return Response.json(
      { status: "error", code: "bad_request", message: MSG_BAD_REQUEST } satisfies ImageResponse,
      { status: 400 },
    );
  }

  const capped = await readBodyCapped(req, MAX_IMAGE_BODY_BYTES);
  if (!capped.ok) {
    return Response.json(
      { status: "error", code: "bad_request", message: MSG_BAD_REQUEST } satisfies ImageResponse,
      { status: capped.reason === "too_large" ? 413 : 400 },
    );
  }

  let parsed: ImageRequest;
  try {
    parsed = parseImageRequest(JSON.parse(capped.text));
  } catch (e) {
    if (e instanceof ImageStyleError) {
      return Response.json(
        { status: "error", code: "bad_request", message: MSG_STYLE } satisfies ImageResponse,
        { status: 400 },
      );
    }
    return Response.json(
      { status: "error", code: "bad_request", message: MSG_BAD_REQUEST } satisfies ImageResponse,
      { status: 400 },
    );
  }

  // Pictures and chapter panels serve every ready shelf book plus
  // finished uploads. Unknown or not-ready ids stop here, before env,
  // quota, or spend are touched.
  if (!isReadyBookId(parsed.bookId) && !isUploadId(parsed.bookId)) {
    return Response.json(
      { status: "error", code: "bad_request", message: MSG_BAD_REQUEST } satisfies ImageResponse,
      { status: 400 },
    );
  }

  let env = deps.env;
  if (!env) {
    try {
      env = readImageEnv();
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      const prefix = "missing image env:";
      const names = message.startsWith(prefix) ? message.slice(prefix.length).trim() : "";
      console.warn(`image env missing: ${names}`);
      return Response.json(
        { status: "error", code: "unavailable", message: MSG_UNAVAILABLE } satisfies ImageResponse,
        { status: 503 },
      );
    }
  }

  // The reader's own key pays for this picture; without it ours does
  // and the spend reserve applies. Trimmed and shaped like the chat
  // route's key, never logged or echoed.
  const rawByok = req.headers.get(BYOK_HEADER);
  let byokKey: string | null = null;
  if (rawByok !== null) {
    const trimmed = rawByok.trim();
    if (trimmed.length < 8 || trimmed.length > 400 || !isAsciiPrintable(trimmed)) {
      return Response.json(
        { status: "error", code: "bad_request", message: MSG_BAD_REQUEST } satisfies ImageResponse,
        { status: 400 },
      );
    }
    byokKey = trimmed;
  }

  try {
    let book: BookPayload["book"];
    let scenes: BookPayload["scenes"];
    try {
      // Missing, unfinished, or expired uploads answer 400 like unknown
      // ids, never a 404 throw or a 503.
      ({ book, scenes } = await (deps.loadBook ?? loadBook)(parsed.bookId));
    } catch {
      return Response.json(
        { status: "error", code: "bad_request", message: MSG_BAD_REQUEST } satisfies ImageResponse,
        { status: 400 },
      );
    }
    try {
      validateAgainstBook(
        parsed,
        {
          id: book.id,
          textVersion: book.textVersion,
          paragraphNs: new Set(book.paragraphs.map((p) => p.n)),
          sceneIds: new Set(scenes.map((s) => s.id)),
          chapters: new Set(book.chapters.map((c) => c.ch)),
        },
      );
    } catch {
      return Response.json(
        { status: "error", code: "bad_request", message: MSG_BAD_REQUEST } satisfies ImageResponse,
        { status: 400 },
      );
    }

    const byN = new Map(book.paragraphs.map((p) => [p.n, p.text]));
    const req0 = parsed;
    const sceneOf =
      req0.kind === "chapter"
        ? undefined
        : scenes.find((s) =>
            req0.kind === "passage" ? req0.n >= s.start_n && req0.n <= s.end_n : s.id === req0.sceneId,
          );
    // A selection never leaves its starting scene; a lone paragraph
    // keeps the bare pN key.
    if (parsed.kind === "passage" && parsed.endN !== undefined) {
      const end = Math.min(parsed.endN, sceneOf?.end_n ?? parsed.endN);
      const { endN: _dropped, ...single } = parsed;
      parsed = end <= parsed.n ? single : { ...parsed, endN: end };
    }
    const passageTexts: string[] = [];
    if (parsed.kind === "passage") {
      for (let n = parsed.n; n <= (parsed.endN ?? parsed.n); n++) passageTexts.push(byN.get(n) ?? "");
    }
    const sceneParas = sceneOf
      ? book.paragraphs.filter((p) => p.n >= sceneOf.start_n && p.n <= sceneOf.end_n)
      : [];
    // Chapter content comes from the frozen book: the chapter title plus
    // the panel groups over that chapter's scenes. The client sends the
    // chapter number only, so no client text reaches the prompt.
    const chapterNo = parsed.kind === "chapter" ? parsed.ch : null;
    const content: ImageContent =
      chapterNo !== null
        ? {
            passageText: "",
            sceneTitle: book.chapters.find((c) => c.ch === chapterNo)?.title ?? "",
            sceneClip: "",
            chapterPanels: chapterPanels(scenes.filter((s) => s.ch === chapterNo)),
          }
        : {
            passageText: parsed.kind === "passage" ? passageTexts.join(" ") : "",
            sceneTitle: sceneOf?.title ?? "",
            sceneClip: sceneParas.map((p) => p.text).join(" "),
          };

    // Bookmap reference details for the prompt (delimited block).
    // A missing bookmap yields "" and the prompt stays as it was.
    const bookmap = getBookmap(book.id, book.textVersion, classifyInputOf(scenes, book.textVersion));
    let reference = "";
    if (parsed.kind === "passage") {
      const start = parsed.n;
      const end = parsed.endN ?? parsed.n;
      reference = passageReference({
        bookmap,
        sceneIds: scenes.filter((s) => s.start_n <= end && s.end_n >= start).map((s) => s.id),
        selectedText: passageTexts.join(" "),
        ch: sceneOf?.ch ?? 0,
      });
    } else if (parsed.kind === "scene" && sceneOf) {
      reference = passageReference({
        bookmap,
        sceneIds: [sceneOf.id],
        selectedText: content.sceneClip,
        ch: sceneOf.ch,
      });
    } else if (parsed.kind === "chapter" && chapterNo !== null) {
      reference = chapterReference({
        bookmap,
        sceneIds: scenes.filter((s) => s.ch === chapterNo).map((s) => s.id),
        ch: chapterNo,
      });
    }

    const cookieValue = parseAnonCookie(req.headers.get("cookie"));
    let anonId = cookieValue ? verifyAnonCookie(cookieValue, env.sessionSecret) : null;
    let setCookie: string | null = null;
    if (!anonId) {
      const issued = issueAnonId(env.sessionSecret);
      anonId = issued.id;
      setCookie = serializeAnonCookie(issued.value);
    }

    const ip = clientIp(req.headers);
    const humanOut: { setCookie?: string } = {};
    const res = await orchestrate(parsed, {
      kv: deps.kv ?? createRestKV(env.upstashUrl, env.upstashToken),
      store: deps.store ?? createBlobStore(),
      generate: deps.generate ?? createMetaClient(byokKey ?? env.metaKey),
      env,
      byok: byokKey !== null,
      content: {
        ...content,
        reference,
        book: { id: book.id, title: book.title, author: book.author },
      },
      ip,
      anonId,
      day: utcDay(),
      sceneId: sceneOf?.id ?? "",
      // On the miss path only; cache hits return before this is read.
      human: {
        cookieHeader: req.headers.get("cookie"),
        token: parsed.turnstileToken,
        ip,
        turnstileSecret: env.turnstileSecret,
        turnstileSiteKey: env.turnstileSiteKey,
        sessionSecret: env.sessionSecret,
        fetchFn: deps.fetchFn,
      },
      humanOut,
    });

    const { json, status } = toResponse(res);
    const headers = new Headers();
    if (setCookie) headers.append("Set-Cookie", setCookie);
    if (humanOut.setCookie) headers.append("Set-Cookie", humanOut.setCookie);
    return Response.json(json, { status, headers });
  } catch (e) {
    console.error(`image request failed: ${errorTag(e)}`);
    return Response.json(
      { status: "error", code: "unavailable", message: MSG_UNAVAILABLE } satisfies ImageResponse,
      { status: 503 },
    );
  }
}
