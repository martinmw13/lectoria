// Shared fakes for the upload route tests: scripted Meta/Jev clients, an
// in-memory Blob store, and small request builders. No network anywhere.
import { createMemoryKV } from "@/core/images";
import type { KV } from "@/core/types";
import type { RawSection } from "@/core/clean-types";
import type { JevClient, JevResult } from "../../pipeline/jev";
import type { MetaClient, MetaUsage } from "../../pipeline/meta";
import type { UploadEnv } from "./env";

export { createMemoryKV };
export type { KV };
export { memoryStore, type MemoryStore } from "./memory";

export function testEnv(over: Partial<UploadEnv> = {}): UploadEnv {
  return {
    upstashUrl: "https://upstash.test",
    upstashToken: "upstash-token",
    uploadsToken: "uploads-token",
    metaKey: "owner-meta-key",
    sessionSecret: "session-secret-for-tests-only",
    ipSalt: "ip-salt-for-tests",
    spendCapMicro: 10_000_000,
    ...over,
  };
}

export interface MetaCall {
  system: string;
  user: string;
  schemaName: string;
}

const USAGE = { promptTokens: 1000, cachedTokens: 100, completionTokens: 100 };

export function scriptedMeta(
  respond: (call: MetaCall) => unknown,
  usage: { promptTokens: number; cachedTokens: number; completionTokens: number } = USAGE,
): MetaClient & { calls: MetaCall[] } {
  const calls: MetaCall[] = [];
  return {
    calls,
    model: "muse-spark-1.3-contributor",
    async completeJson(input: { system: string; user: string; schemaName: string; schema: Record<string, unknown> }): Promise<MetaUsage> {
      const call = { system: input.system, user: input.user, schemaName: input.schemaName };
      calls.push(call);
      return { data: respond(call), ...usage };
    },
  };
}

const CALM_VECTOR = {
  calma: 0.8,
  alegria: 0.05,
  tristeza: 0,
  suspenso: 0.05,
  misterio: 0,
  aventura: 0.05,
  combate: 0,
  asombro: 0.05,
};

// Answers judge, segment, override, and direct calls well enough for the
// happy path: one scene per part, calm everywhere.
export function helpfulMeta(): MetaClient & { calls: MetaCall[] } {
  return scriptedMeta((call) => {
    if (call.schemaName === "clean_judge") return { sections: [], headCut: 0, tailCut: 0 };
    if (call.schemaName === "chapter_scenes") {
      const m = /first start_n is (\d+), last end_n is (\d+)/.exec(call.user);
      const start = Number(m?.[1] ?? 1);
      const end = Number(m?.[2] ?? start);
      return {
        scenes: [{ start_n: start, end_n: end, title: "A scene", summary: "Things happen.", characters: ["Jo"] }],
      };
    }
    if (call.schemaName === "emotion_override") return { vector: CALM_VECTOR, reason: "Calm." };
    return { vector: CALM_VECTOR, intensity: 0.3, tempo: 0.2, reason: "Calm." };
  });
}

export function scriptedJev(over: Partial<JevResult> = {}): JevClient & { calls: number } {
  const client = {
    calls: 0,
    model: "jev-1.14.0",
    async classify(): Promise<JevResult> {
      client.calls += 1;
      return {
        vector: { ...CALM_VECTOR, unknown: 0 },
        choice: "calma",
        confidence: 0.95,
        intensity: 0.3,
        intensity_confidence: 0.9,
        tempo: 0.2,
        tempo_confidence: 0.9,
        model: "jev-1.14.0",
        input_tokens: 500,
        output_tokens: 50,
        ...over,
      } as JevResult;
    },
  };
  return client;
}

const WORDS = ["maple", "river", "quiet", "lantern", "meadow", "sparrow", "thunder", "window", "garden", "harbor"];

export function section(id: string, label: string, paras: number, wordsPerPara: number): RawSection {
  const blocks = [];
  for (let p = 0; p < paras; p++) {
    const words = [];
    for (let w = 0; w < wordsPerPara; w++) words.push(WORDS[(p + w) % WORDS.length]);
    blocks.push({ text: words.join(" "), heading: false });
  }
  return { id, href: `${id}.xhtml`, linear: true, types: [], docTitle: null, navLabel: label, blocks };
}

export function tinyBook(): { title: string; sections: RawSection[] } {
  return { title: "Tiny", sections: [section("s1", "One", 3, 45), section("s2", "Two", 3, 45)] };
}

export function postRequest(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// Merges every Set-Cookie pair into one Cookie header for the next call.
export function cookiesFrom(res: Response, prev = ""): string {
  const found = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const pairs = found.map((c) => c.split(";")[0] as string);
  const jar = new Map<string, string>();
  for (const part of [...prev.split(";"), ...pairs]) {
    const eq = part.indexOf("=");
    if (eq > 0) jar.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

export function turnstileFetch(ok: boolean): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ success: ok }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
}
