// Track similarity and ranking. Pure: no env, no fetch, no audio.
import { EMOTIONS } from "./types";
import type { EmotionId, Vector8 } from "./types";
import { buildFeatures } from "./cluster";
import type {
  MusicConfig,
  MusicWeights,
  SceneSignal,
  Similarity,
  Track,
} from "./music-types";

// Renormalize the 8 entries to sum 1. Extra keys (such as a Jev
// "unknown" entry) are ignored. An all-zero vector stays all zero.
export function normalize8(vector: Record<string, number>): number[] {
  const values = EMOTIONS.map((id: EmotionId) => {
    const v = vector[id];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  });
  const sum = values.reduce((a, b) => a + b, 0);
  if (sum <= 0) return values.map(() => 0);
  return values.map((v) => v / sum);
}

// Bhattacharyya affinity over the renormalized shapes, plus separate
// intensity and tempo terms. Fair to blended scenes, unlike cosine.
export function bhattacharyyaSimilarity(
  scene: SceneSignal,
  track: Track,
  weights: MusicWeights = MUSIC_CONFIG.weights,
): number {
  const s = normalize8(scene.vector);
  const t = normalize8(track.vector);
  let affinity = 0;
  for (let i = 0; i < s.length; i++) {
    affinity += Math.sqrt((s[i] ?? 0) * (t[i] ?? 0));
  }
  return (
    weights.emotion * affinity +
    weights.intensity * (1 - Math.abs(scene.intensity - track.intensity)) +
    weights.tempo * (1 - Math.abs(scene.tempo - track.tempo))
  );
}

// Cosine over buildFeatures output (vector plus weighted intensity and
// tempo). Kept as an alternative; it favors peaky scenes.
export function cosineSimilarity(scene: SceneSignal, track: Track): number {
  const a = buildFeatures(scene);
  const b = buildFeatures(track);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export const MUSIC_CONFIG: MusicConfig = {
  similarity: bhattacharyyaSimilarity,
  weights: { emotion: 0.7, intensity: 0.15, tempo: 0.15 },
  // Same-scene re-check hold (ticks after a scene is already active).
  dwellSec: 8,
  // How long a new scene must stay under the reading line before its
  // soundtrack can take over. Short enough that a 3-paragraph combat
  // beat (Oz Lion Ambush) still wins; long enough that a fast scroll
  // only settles on the last scene.
  sceneEntryDwellSec: 1,
  // Within one scene, do not reshuffle for this long. Scene promotions
  // bypass it; a strong mood change (new dominant emotion) also skips
  // the entry dwell so combat/suspense cuts land while the scene is in view.
  minTrackSec: 4,
  // Equal-power crossfade length used by the player for every switch.
  crossfadeSec: 1.75,
  // Admits near ties into the random-mode draw without letting clearly
  // worse matches in.
  randomTolerance: 0.05,
};

export function resolveConfig(override?: Partial<MusicConfig>): MusicConfig {
  if (!override) return MUSIC_CONFIG;
  return {
    ...MUSIC_CONFIG,
    ...override,
    weights: override.weights ?? MUSIC_CONFIG.weights,
  };
}

export function scoreTrack(
  scene: SceneSignal,
  track: Track,
  override?: Partial<MusicConfig>,
): number {
  const config = resolveConfig(override);
  return config.similarity(scene, track, config.weights);
}

// One id tie-break for every ranking. Lower id wins, so ranking is stable.
export function compareTrackId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface RankedTrack {
  track: Track;
  score: number;
}

// One ranking core: each track scored once, best first, ties to lower id.
export function rankScored(
  scene: SceneSignal,
  tracks: Track[],
  override?: Partial<MusicConfig>,
): RankedTrack[] {
  const config = resolveConfig(override);
  return tracks
    .map((track) => ({ track, score: config.similarity(scene, track, config.weights) }))
    .sort((a, b) => b.score - a.score || compareTrackId(a.track, b.track));
}

// Dominant emotion of a scene: argmax of the renormalized vector, with
// ties broken by EMOTIONS order.
export function dominantEmotion(scene: SceneSignal): EmotionId {
  const norm = normalize8(scene.vector);
  let best: EmotionId = EMOTIONS[0] as EmotionId;
  let bestValue = -Infinity;
  EMOTIONS.forEach((id: EmotionId, i: number) => {
    const value = norm[i] ?? 0;
    if (value > bestValue) {
      bestValue = value;
      best = id;
    }
  });
  return best;
}
