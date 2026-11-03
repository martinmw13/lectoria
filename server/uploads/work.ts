import "server-only";
import { EMOTIONS } from "@/core/types";
import type { Chapter, EmotionId, Scene, SceneEmotion, SceneInput } from "@/core/types";
import { renormalize8 } from "@/core/emotion";
import { validateSceneCoverage } from "@/core/scenes";
import { runPool } from "../../pipeline/http";
import { classifyScene } from "../../pipeline/classify";
import type { ClassifyMetaUsage } from "../../pipeline/classify";
import { SCENE_SCHEMA, chapterPrompt, parseScenes } from "../../pipeline/segment";
import type { JevClient } from "../../pipeline/jev";
import type { MetaClient } from "../../pipeline/meta";
import type { UploadUsage } from "./state";

export { usageCostMicro, usageCostUsd } from "./state";

// Per-call ceilings inside the step budget. The pipeline's own retry
// policy still applies beneath each timeout; a storm that outlasts it
// leaves the job working, and the client re-drives the step idempotently.
export const META_CALL_TIMEOUT_MS = 20_000;
export const JEV_CALL_TIMEOUT_MS = 12_000;

// Step routes run up to 120 s; the step deadline aborts in-flight calls
// 10 s before that, so a slow part ends as a clean retry, not a kill.
export const UPLOAD_STEP_DEADLINE_MS = 110_000;

export function fetchWithTimeout(fetchFn: typeof fetch, ms: number, outer?: AbortSignal): typeof fetch {
  return (url, init) => {
    const timeout = AbortSignal.timeout(ms);
    return fetchFn(url, { ...init, signal: outer ? AbortSignal.any([timeout, outer]) : timeout });
  };
}

export class WorkError extends Error {
  constructor(public kind: "segment" | "store") {
    super(`upload ${kind} failed`);
    this.name = "WorkError";
  }
}

function clampSceneText(scene: SceneInput): SceneInput {
  return {
    start_n: scene.start_n,
    end_n: scene.end_n,
    title: scene.title.slice(0, 200),
    summary: scene.summary.slice(0, 2000),
    characters: scene.characters.slice(0, 12).map((c) => c.slice(0, 120)),
  };
}

// One part segments like an Oz chapter: same prompt, same schema, one
// retry with the coverage problems pasted back. Throws WorkError when the
// output is still invalid, which fails the job with a refund.
export async function segmentPart(
  meta: MetaClient,
  chapter: Pick<Chapter, "ch" | "title" | "start_n" | "end_n">,
  paras: { n: number; text: string }[],
  usage: UploadUsage,
): Promise<SceneInput[]> {
  const full = chapter as Chapter;
  let problems: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await meta.completeJson({
      system: "You split book chapters into scenes for a music soundtrack. Answer with JSON only.",
      user: chapterPrompt(full, paras, problems),
      schemaName: "chapter_scenes",
      schema: SCENE_SCHEMA as unknown as Record<string, unknown>,
    });
    usage.metaRequests += 1;
    usage.metaPrompt += result.promptTokens;
    usage.metaCached += result.cachedTokens;
    usage.metaCompletion += result.completionTokens;
    let inputs: SceneInput[];
    try {
      inputs = parseScenes(result.data).map(clampSceneText);
    } catch (e) {
      problems = (e as Error).message;
      continue;
    }
    const found = validateSceneCoverage(full, inputs);
    if (found.length === 0) return inputs;
    problems = found.map((p) => p.message).join("\n");
  }
  throw new WorkError("segment");
}

// Contributor-only emotion for BYOK and for the free path without a Jev
// key. Mirrors the override prompt, plus the intensity/tempo questions Jev
// would have answered. Only the 8 ids; a bad vector fails the scene.
const DIRECT_SCHEMA = {
  type: "object",
  properties: {
    vector: {
      type: "object",
      properties: Object.fromEntries(EMOTIONS.map((id) => [id, { type: "number" }])),
      required: [...EMOTIONS],
      additionalProperties: false,
    },
    intensity: { type: "number" },
    tempo: { type: "number" },
    reason: { type: "string" },
  },
  required: ["vector", "intensity", "tempo", "reason"],
  additionalProperties: false,
};

function clamp01(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

export async function classifySceneDirect(
  meta: MetaClient,
  scene: Pick<Scene, "title">,
  text: string,
  usage: UploadUsage,
): Promise<SceneEmotion> {
  try {
    const result = await meta.completeJson({
      system: "You score soundtrack mood as a probability mix over 8 feelings. Answer with JSON only.",
      user:
        `Scene "${scene.title}": ${text}\n` +
        "Give a probability mix over the 8 feelings only (calma, alegria, tristeza, suspenso, " +
        "misterio, aventura, combate, asombro), plus intensity (0 calm to 1 intense) and tempo " +
        "(0 still to 1 urgent), plus one short sentence for reason.",
      schemaName: "emotion_direct",
      schema: DIRECT_SCHEMA,
    });
    usage.metaRequests += 1;
    usage.metaPrompt += result.promptTokens;
    usage.metaCached += result.cachedTokens;
    usage.metaCompletion += result.completionTokens;
    const parsed = result.data as {
      vector?: Partial<Record<EmotionId, number>>;
      intensity?: unknown;
      tempo?: unknown;
      reason?: unknown;
    };
    const vector = renormalize8(parsed.vector ?? {});
    const intensity = clamp01(parsed.intensity);
    const tempo = clamp01(parsed.tempo);
    if (vector === null || intensity === null || tempo === null) {
      return { jev: null, muse_override: null, final: null, error: "direct vector invalid" };
    }
    const override = { vector, reason: String(parsed.reason ?? "").slice(0, 300), model: meta.model };
    return { jev: null, muse_override: override, final: { vector, intensity, tempo }, error: null };
  } catch {
    return { jev: null, muse_override: null, final: null, error: "direct classify failed" };
  }
}

// Every scene gets an emotion; per-scene failures record the error and
// keep final null like Oz, so one bad scene never fails the book.
export async function classifyPart(
  scenes: (SceneInput & Pick<Scene, "id" | "ch">)[],
  texts: string[],
  ctx: { bookTitle: string; chapterTitle: string },
  deps: { meta: MetaClient; jev: JevClient | null },
  usage: UploadUsage,
): Promise<SceneEmotion[]> {
  const metaUsage: ClassifyMetaUsage = {
    model: deps.meta.model,
    requests: 0,
    promptTokens: 0,
    cachedTokens: 0,
    completionTokens: 0,
    costUsd: 0,
  };
  const out = await runPool(scenes, 4, async (scene, index) => {
    const text = texts[index] ?? "";
    if (deps.jev === null) return classifySceneDirect(deps.meta, scene, text, usage);
    const emotion = await classifyScene(scene as Scene, text, ctx.bookTitle, ctx.chapterTitle, deps as { jev: JevClient; meta: MetaClient }, metaUsage);
    if (emotion.jev) {
      usage.jevInput += emotion.jev.input_tokens;
      usage.jevOutput += emotion.jev.output_tokens;
      usage.jevRequests += 1;
    }
    return emotion;
  });
  usage.metaRequests += metaUsage.requests;
  usage.metaPrompt += metaUsage.promptTokens;
  usage.metaCached += metaUsage.cachedTokens;
  usage.metaCompletion += metaUsage.completionTokens;
  return out;
}

