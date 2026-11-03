import "server-only";
import { normalizeWord } from "@/core/dictionary";

// Kindle-style dictionary: a same-origin proxy to the free, keyless
// dictionaryapi.dev (the CSP keeps connect-src 'self'). English only.
// Upstream text is third-party data: trimmed, clamped, rendered as text.

export interface Sense {
  pos: string;
  defs: { text: string; example?: string }[];
}

export interface Definition {
  word: string;
  phonetic?: string;
  senses: Sense[];
}

const UPSTREAM = "https://api.dictionaryapi.dev/api/v2/entries/en/";
const TIMEOUT_MS = 4000;
const MAX_SENSES = 3;
const MAX_DEFS = 2;
const MAX_CHARS = 300;
const CACHE_MAX = 500;

// shortcut: per-instance memory cache, the CDN caches hits across instances.
const cache = new Map<string, Definition | null>();

function clamp(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_CHARS) : "";
}

// Upstream shape: [{ word, phonetic, meanings: [{ partOfSpeech, definitions: [{ definition, example }] }] }].
export function parseEntries(word: string, data: unknown): Definition | null {
  if (!Array.isArray(data)) return null;
  const senses: Sense[] = [];
  let phonetic = "";
  for (const entry of data) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as { phonetic?: unknown; meanings?: unknown };
    phonetic ||= clamp(e.phonetic);
    if (!Array.isArray(e.meanings)) continue;
    for (const m of e.meanings) {
      if (senses.length >= MAX_SENSES || !m || typeof m !== "object") break;
      const meaning = m as { partOfSpeech?: unknown; definitions?: unknown };
      const defs = (Array.isArray(meaning.definitions) ? meaning.definitions : [])
        .map((d: unknown) => {
          const def = (d ?? {}) as { definition?: unknown; example?: unknown };
          const text = clamp(def.definition);
          const example = clamp(def.example);
          return example ? { text, example } : { text };
        })
        .filter((d) => d.text !== "")
        .slice(0, MAX_DEFS);
      if (defs.length > 0) senses.push({ pos: clamp(meaning.partOfSpeech), defs });
    }
  }
  if (senses.length === 0) return null;
  return phonetic ? { word, phonetic, senses } : { word, senses };
}

function remember(word: string, value: Definition | null) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(word, value);
}

function coded(code: string, status: number, cacheable = false): Response {
  return Response.json(
    { code },
    { status, headers: { "Cache-Control": cacheable ? "public, max-age=86400, s-maxage=604800" : "no-store" } },
  );
}

export async function handleDefineGet(req: Request, fetcher: typeof fetch = fetch): Promise<Response> {
  if (req.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") return coded("forbidden", 403);
  const word = normalizeWord(new URL(req.url).searchParams.get("word") ?? "");
  if (!word) return coded("bad_word", 400);
  let found = cache.get(word);
  if (found === undefined) {
    try {
      const res = await fetcher(UPSTREAM + encodeURIComponent(word), {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Accept: "application/json" },
      });
      if (res.status === 404) found = null;
      else if (!res.ok) throw new Error(`upstream ${res.status}`);
      else found = parseEntries(word, await res.json());
      remember(word, found);
    } catch {
      console.error("define failed");
      return coded("unavailable", 503);
    }
  }
  if (found === null) return coded("not_found", 404, true);
  return Response.json(found, { headers: { "Cache-Control": "public, max-age=86400, s-maxage=604800" } });
}

export function clearDictionaryCache() {
  cache.clear();
}
