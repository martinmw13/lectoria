import { BYOK_HEADER } from "@/core/chat";
import { MSG_FAILED, MSG_HUMAN, MSG_RETRY } from "@/core/images";
import type { ImageErrorCode, ImageResponse } from "@/core/images";
import { getReaderKey } from "../leer/reader-key";

const POLL_MS = 3000;
const POLL_MAX = 40;

async function postImage(body: unknown): Promise<ImageResponse> {
  // Uploads finished with the reader's own Meta key send it along, so
  // pictures bill that key; without it the server uses ours. The key
  // lives in module memory only and never reaches shelf-book requests.
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

export function isQuotaCode(code: ImageErrorCode): boolean {
  return code === "quota" || code === "budget" || code === "daily_budget";
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
      throw new ImageRequestError(res.code, res.message);
    }
    left -= 1;
    if (left <= 0) throw new Error(MSG_RETRY);
    await new Promise((done) => setTimeout(done, POLL_MS));
  }
}
