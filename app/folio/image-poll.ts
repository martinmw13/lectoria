import { BYOK_HEADER } from "@/core/chat";
import { MSG_FAILED, MSG_HUMAN, MSG_RETRY } from "@/core/images";
import type { ImageErrorCode, ImageResponse } from "@/core/images";
import { getReaderKey, setSessionKey } from "../leer/reader-key";

const POLL_MS = 3000;
const POLL_MAX = 40;

async function postImage(body: unknown): Promise<ImageResponse> {
  // The reader's own Meta key (an upload's, or one typed in this tab)
  // rides along in a header, so pictures bill that key and skip the free
  // daily quota; without it the server uses ours. Memory only, never in
  // the body, the URL, storage, or logs.
  const bookId = (body as { bookId?: unknown }).bookId;
  const key = typeof bookId === "string" ? getReaderKey(bookId) : null;
  // One generating request runs up to the 120 s server budget, so this
  // outlasts it; a timeout surfaces as the friendly retry state below.
  const res = await fetch("/api/images", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { [BYOK_HEADER]: key } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(130_000),
  });
  return (await res.json()) as ImageResponse;
}

// Shared by the chapter page hook: one poll loop for every picture kind.
// Thrown when the API needs a human proof; the caller surfaces the
// widget once instead of polling through the failure.
export class HumanNeeded extends Error {
  constructor() {
    super(MSG_HUMAN);
    this.name = "HumanNeeded";
  }
}

// Carries the API error code past poll, so quota and budget failures can
// hide their retry button. The message stays the server's friendly copy.
export class ImageRequestError extends Error {
  code: ImageErrorCode;
  constructor(code: ImageErrorCode, message: string) {
    super(message);
    this.name = "ImageRequestError";
    this.code = code;
  }
}

// These hide Retry and offer the reader's own key instead; a refused key
// (byok_invalid) offers to enter another one.
export function isQuotaCode(code: ImageErrorCode): boolean {
  return code === "quota" || code === "budget" || code === "daily_budget" || code === "byok_invalid";
}

export async function poll(
  body: Record<string, unknown>,
  token?: string,
): Promise<{ url: string; caption: string }> {
  let left = POLL_MAX;
  let first = true;
  for (;;) {
    let res: ImageResponse;
    try {
      // The token rides the first post only; later polls reuse the cookie.
      const payload = first && token ? { ...body, turnstileToken: token } : body;
      first = false;
      res = await postImage(payload);
    } catch {
      throw new Error(MSG_FAILED);
    }
    if (res.status === "ready") return { url: res.url, caption: res.caption };
    if (res.status === "error") {
      if (res.code === "human") throw new HumanNeeded();
      // A refused tab key is dropped, so the next try asks for another.
      if (res.code === "byok_invalid") setSessionKey(null);
      throw new ImageRequestError(res.code, res.message);
    }
    left -= 1;
    if (left <= 0) throw new Error(MSG_RETRY);
    await new Promise((done) => setTimeout(done, POLL_MS));
  }
}
