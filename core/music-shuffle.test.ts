// Shuffle among same-emotion tracks: when several tracks share the
// scene's emotion, the pick is random among them (mocked rng), never the
// track that just played, and the normal crossfade still applies.
import { describe, expect, it } from "vitest";
import { MUSIC_CONFIG, shuffleSameEmotion } from "./music";
import type { MusicManifest, SceneSignal, SelectEnv, Track } from "./music";
import type { Vector8 } from "./types";
import { EMOTIONS } from "./types";
import { initScheduler, noteTrackEnded, tickScheduler } from "./music-schedule";

function vec(top: string): Vector8 {
  const v = Object.fromEntries(EMOTIONS.map((id) => [id, 0.01])) as Record<string, number>;
  v[top] = 0.93;
  return v as Vector8;
}

const scene = (top: string): SceneSignal => ({ vector: vec(top), intensity: 0.5, tempo: 0.5 });

function track(id: string, top: string, intensity = 0.5): Track {
  return {
    id,
    src: `/music/${id}.mp3`,
    title: id,
    emotion: top as Track["emotion"],
    vector: vec(top),
    intensity,
    tempo: 0.5,
    durationSec: 120,
    startSec: 0,
    gainDb: 0,
    loop: false,
    soundtrack: "snd",
    style: "orchestral",
  };
}

const manifest: MusicManifest = {
  version: 3,
  styles: [{ id: "orchestral", name: "Orquesta" }],
  soundtracks: [{ id: "snd", name: "Snd", style: "orchestral" }],
  playlists: [],
  tracks: [
    track("calm-1", "calma"),
    track("calm-2", "calma", 0.6),
    track("calm-3", "calma", 0.95),
    track("sad-1", "tristeza"),
    track("joy-1", "alegria"),
  ],
};

// A scripted rng: returns the given values in order, then repeats the last.
function scripted(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] as number;
}

const env = (rng: () => number): SelectEnv => ({ selection: { style: "orchestral" }, rng });

function playing(id: string, started = 0) {
  return { ...initScheduler(), currentId: id, currentStartedSec: started, activeSceneId: "s1" };
}

describe("shuffleSameEmotion", () => {
  it("reaches every same-emotion track except the one that just played", () => {
    const seen = new Set<string>();
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const t = shuffleSameEmotion(scene("calma"), manifest.tracks, () => r, "calm-1");
      expect(t?.emotion).toBe("calma");
      expect(t?.id).not.toBe("calm-1");
      seen.add(t!.id);
    }
    expect([...seen].sort()).toEqual(["calm-2", "calm-3"]);
  });

  it("is null when no other track has the emotion, or with no scene", () => {
    expect(shuffleSameEmotion(scene("tristeza"), manifest.tracks, () => 0, "sad-1")).toBeNull();
    expect(shuffleSameEmotion(null, manifest.tracks, () => 0, null)).toBeNull();
  });

  it("does not depend on manifest order", () => {
    const reversed = [...manifest.tracks].reverse();
    const a = shuffleSameEmotion(scene("calma"), manifest.tracks, () => 0.5, null);
    const b = shuffleSameEmotion(scene("calma"), reversed, () => 0.5, null);
    expect(a?.id).toBe(b?.id);
  });
});

describe("track ended", () => {
  it("shuffles to another same-emotion track with the normal crossfade", () => {
    const d = noteTrackEnded(playing("calm-1"), scene("calma"), manifest, "calm-1", 130, env(() => 0.99));
    expect(d.switchToId).toBe("calm-3");
    expect(d.crossfadeSec).toBe(MUSIC_CONFIG.crossfadeSec);
  });

  it("never repeats the track that just ended", () => {
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      const d = noteTrackEnded(playing("calm-2"), scene("calma"), manifest, "calm-2", 130, env(() => r));
      expect(d.switchToId).not.toBe("calm-2");
      expect(manifest.tracks.find((t) => t.id === d.switchToId)?.emotion).toBe("calma");
    }
  });

  it("falls back to the best remaining track when the emotion has no other", () => {
    const d = noteTrackEnded(playing("sad-1"), scene("tristeza"), manifest, "sad-1", 130, env(() => 0.99));
    expect(d.switchToId).not.toBeNull();
    expect(d.switchToId).not.toBe("sad-1");
  });
});

describe("scene change", () => {
  it("draws from the whole same-emotion pool, not only the best score", () => {
    const low = tickScheduler(playing("sad-1"), scene("calma"), manifest, 100, env(scripted(0)));
    const high = tickScheduler(playing("sad-1"), scene("calma"), manifest, 100, env(scripted(0.99)));
    expect(low.switchToId).toBe("calm-1");
    expect(high.switchToId).toBe("calm-3");
    expect(high.crossfadeSec).toBe(MUSIC_CONFIG.crossfadeSec);
  });

  it("keeps a same-emotion track playing, with no draw", () => {
    let calls = 0;
    const d = tickScheduler(playing("calm-3"), scene("calma"), manifest, 100, env(() => (calls++, 0)));
    expect(d.switchToId).toBeNull();
    expect(calls).toBe(0);
  });

  it("still holds a switch until min-track time passes", () => {
    // Same active scene re-check: started at 90, tick at 90+minTrack-1 still holds.
    const started = 90;
    const d = tickScheduler(
      playing("sad-1", started),
      scene("calma"),
      manifest,
      started + MUSIC_CONFIG.minTrackSec - 1,
      env(() => 0.5),
    );
    expect(d.switchToId).toBeNull();
  });
});
