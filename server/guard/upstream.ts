import "server-only";

// Sorts a Meta upstream failure without reading keys or bodies beyond the
// short excerpt our clients already keep. Statuses come from
// fetchWithRetry (`status`), MetaImageError (`status`), or the chat
// streamer's "chat upstream <status>" message.
export type UpstreamKind = "credits" | "transient" | "fatal";

const CREDIT_MARKERS = /insufficient|credit|billing|balance|payment/i;

function statusOf(e: unknown): number | null {
  if (typeof e !== "object" || e === null) return null;
  const status = (e as { status?: unknown }).status;
  if (typeof status === "number") return status;
  const m = e instanceof Error ? /^chat upstream (\d{3})$/.exec(e.message) : null;
  return m ? Number(m[1]) : null;
}

function textOf(e: unknown): string {
  if (!(e instanceof Error)) return "";
  const detail = (e as { detail?: unknown }).detail;
  return `${e.message} ${typeof detail === "string" ? detail : ""}`;
}

export function upstreamKind(e: unknown): UpstreamKind {
  const status = statusOf(e);
  // Our key out of money or revoked: 402, auth, or a quota-ish 429/400.
  if (status === 401 || status === 402 || status === 403) return "credits";
  if ((status === 429 || status === 400) && CREDIT_MARKERS.test(textOf(e))) return "credits";
  if (status === 429 || (status !== null && status >= 500)) return "transient";
  if (e instanceof Error) {
    if (e.name === "TimeoutError" || e.name === "AbortError" || e.name === "TypeError") return "transient";
    if ((e as { retryable?: unknown }).retryable === true) return "transient";
    if (/^chat upstream .*(timeout|failed)$/.test(e.message)) return "transient";
  }
  return "fatal";
}
