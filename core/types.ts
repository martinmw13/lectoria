// Shared shapes for the book pipeline. Every type stored in data files
// lives here so core never imports from pipeline.
import type { ImageStyle } from "./image-style";
import { EMOTIONS } from "./emotions.mjs";
export { EMOTIONS };

export type EmotionId = (typeof EMOTIONS)[number];
export type JevEmotionId = EmotionId | "unknown";

export interface Book {
  id: string;
  title: string;
  author: string;
  source: { gutenberg: number; url: string };
  textVersion: string;
  chapters: Chapter[];
  paragraphs: Paragraph[];
}

export interface Chapter {
  ch: number;
  title: string;
  start_n: number;
  end_n: number;
}

export interface Paragraph {
  id: string;
  ch: number;
  n: number;
  text: string;
}

export interface SceneInput {
  start_n: number;
  end_n: number;
  title: string;
  summary: string;
  characters: string[];
}

export interface Scene extends SceneInput {
  id: string;
  ch: number;
}

export type Vector8 = Record<EmotionId, number>;
export type Vector9 = Record<JevEmotionId, number>;

// Jev classification of one scene. A hard failure leaves this null and
// stores no vector, so the scene keeps the previous track.
export interface JevResult {
  vector: Vector9;
  choice: JevEmotionId;
  confidence: number;
  intensity: number;
  intensity_confidence: number;
  tempo: number;
  tempo_confidence: number;
  model: string;
  input_tokens: number;
  output_tokens: number;
}

export interface OverrideResult {
  vector: Vector8;
  reason: string;
  model: string;
}

export interface SceneEmotion {
  jev: JevResult | null;
  muse_override: OverrideResult | null;
  final: { vector: Vector8; intensity: number; tempo: number } | null;
  error: string | null;
}

export type AnalyzedScene = Scene & SceneEmotion;

export const LOW_CONFIDENCE = 0.6;
export const FEATURE_WEIGHTS = { intensity: 0.5, tempo: 0.5 } as const;

// Image API contract. Passage names the start paragraph plus optional
// inclusive endN; scene names the scene id; chapter names the chapter
// number. The cache key holds only the key fields plus PROMPT_VERSION, so
// a repeat tap reuses the stored image.
export type ImageKind = "passage" | "scene" | "chapter";

export interface PassageRequest {
  kind: "passage";
  bookId: string;
  textVersion: string;
  n: number;
  endN?: number;
  style?: ImageStyle;
  // Single-use proof, never part of the cache key.
  turnstileToken?: string;
}

export interface SceneRequest {
  kind: "scene";
  bookId: string;
  textVersion: string;
  sceneId: string;
  style?: ImageStyle;
  // Single-use proof, never part of the cache key.
  turnstileToken?: string;
}

// Minimal store surface the route needs; server modules and tests
// implement it. Lives here so server and core share one shape.
export interface KV {
  get(key: string): Promise<string | null>;
  setNxEx(key: string, value: string, exSec: number): Promise<boolean>;
  set(key: string, value: string): Promise<void>;
  incr(key: string): Promise<number>;
  incrBy(key: string, by: number): Promise<number>;
  decr(key: string): Promise<number>;
  decrBy(key: string, by: number): Promise<number>;
  expire(key: string, sec: number): Promise<void>;
  releaseIfToken(key: string, token: string): Promise<boolean>;
}

export interface ChapterRequest {
  kind: "chapter";
  bookId: string;
  textVersion: string;
  ch: number;
  // Furthest chapter the reader has reached. Client-claimed, so it stops
  // casual spoilers and direct pre-generation of later chapters, not a
  // determined client.
  reachedCh: number;
  style?: ImageStyle;
  // Single-use proof, never part of the cache key.
  turnstileToken?: string;
}

export type ImageRequest = PassageRequest | SceneRequest | ChapterRequest;

export type ImageErrorCode =
  | "quota"
  | "budget"
  | "daily_budget"
  | "human"
  | "unavailable"
  | "bad_request"
  // The reader's own key was refused for pictures (wrong key or no image access).
  | "byok_invalid";

export type ImageResponse =
  | { status: "ready"; url: string; cached: boolean; caption: string }
  | { status: "pending" }
  | { status: "error"; code: ImageErrorCode; message: string };

// v5/c5 are the distinct style prompts: structured STYLE/CONTENT/REMINDER
// prompts for the six approved presets, legacy lines otherwise.
export const PROMPT_VERSION = "v5" as const;

// Chapter pages version their prompt apart from scenes and passages, so a
// prompt change never touches the other keys.
export const CHAPTER_PROMPT_VERSION = "c5" as const;

// shortcut: USD 0.01 per image per the spike, revisit if Meta reprices.
export const IMAGE_COST_MICRO = 10000 as const;

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

// Chat API contract. Server builds context from the book text up to
// positionN (whole book when spoilerMode), prefix first, question last.
export interface ChatRequest {
  bookId: string;
  textVersion: string;
  positionN: number;
  spoilerMode: boolean;
  messages: ChatMessage[];
}
