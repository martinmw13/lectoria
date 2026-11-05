import { describe, expect, it } from "vitest";
import { MUSIC_CONFIG, rankScored, scoreTrack } from "./music";
import type { SceneSignal, Track } from "./music";
import type { Vector8 } from "./types";
import { EMOTIONS } from "./types";
import type { MusicManifest, SelectEnv } from "./music";
import {
  initScheduler,
  noteTrackEnded,
  observeScene,
  requestNext,
  tickScheduler,
} from "./music-schedule";

const env: SelectEnv = {
  selection: { style: "orchestral" },
  rng: () => 0,
};

function vec(top: string): Vector8 {
  const v = Object.fromEntries(EMOTIONS.map((id) => [id, 0.01])) as Record<string, number>;
  v[top] = 0.93;
  return v as Vector8;
}

function signal(top: string, intensity = 0.5, tempo = 0.5): SceneSignal {
  return { vector: vec(top), intensity, tempo };
}

function track(id: string, top: string, intensity = 0.5, tempo = 0.5): Track {
  return {
    id,
    src: `/music/${id}.mp3`,
    title: id,
    emotion: top as Track["emotion"],
    vector: vec(top),
    intensity,
    tempo,
    durationSec: 120,
    startSec: 0,
    gainDb: 0,
    loop: true,
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
    track("sad-a", "tristeza", 0.5, 0.5),
    track("sad-b", "tristeza", 0.6, 0.5),
    track("sad-c", "tristeza", 0.9, 0.9),
    track("calm", "calma", 0.2, 0.2),
    track("tense", "suspenso", 0.6, 0.6),
  ],
};

function firstActive(top: string, at = 0) {
  return observeScene(initScheduler(), "s1", signal(top), manifest, at, env);
}

// A scene whose best track beats sad-a well past the draw tolerance, so
// the draw switches once minTrackSec passes.
function midSignal(): SceneSignal {
  const mix = (w: number) => {
    const v = Object.fromEntries(
      EMOTIONS.map((id) => [id, vec("tristeza")[id] * (1 - w) + vec("calma")[id] * w]),
    ) as unknown as Vector8;
    return { vector: v, intensity: 0.5, tempo: 0.5 };
  };
  const current = manifest.tracks[0] as Track;
  for (let w = 0; w <= 1; w += 0.005) {
    const s = mix(w);
    const best = rankScored(s, manifest.tracks).map((e) => e.track)[0] as Track;
    const gap = scoreTrack(s, best) - scoreTrack(s, current);
    if (gap >= 0.12) {
      return s;
    }
  }
  throw new Error("no mid-gap scene in fixture");
}

describe("observeScene and tickScheduler", () => {
  it("plays the first track at once with no dwell", () => {
    const d = firstActive("tristeza");
    expect(d.switchToId).toBe("sad-a");
    expect(d.crossfadeSec).toBe(0);
    expect(d.state.activeSceneId).toBe("s1");
  });

  it("holds a new scene for dwellSec, then switches with the normal fade", () => {
    const mid = midSignal();
    let d = firstActive("tristeza");
    d = observeScene(d.state, "s2", mid, manifest, 50, env);
    expect(d.switchToId).toBeNull();
    expect(d.state.pendingSceneId).toBe("s2");
    const early = tickScheduler(d.state, mid, manifest, 50 + MUSIC_CONFIG.dwellSec - 1, env);
    expect(early.switchToId).toBeNull();
    const late = tickScheduler(d.state, mid, manifest, 50 + MUSIC_CONFIG.dwellSec + 1, env);
    expect(late.state.activeSceneId).toBe("s2");
    expect(late.switchToId).toBe(rankScored(mid, manifest.tracks).map((e) => e.track)[0]?.id);
    expect(late.crossfadeSec).toBe(MUSIC_CONFIG.crossfadeSec);
  });

  it("holds the current track while the score gap is within tolerance", () => {
    const s = signal("tristeza");
    const gap =
      scoreTrack(s, manifest.tracks[1] as Track) - scoreTrack(s, manifest.tracks[0] as Track);
    expect(gap).toBeLessThan(MUSIC_CONFIG.randomTolerance);
    let d = firstActive("tristeza");
    d = observeScene(d.state, "s2", s, manifest, 100, env);
    const settled = tickScheduler(d.state, s, manifest, 100 + MUSIC_CONFIG.dwellSec + 1, env);
    expect(settled.state.activeSceneId).toBe("s2");
    expect(settled.switchToId).toBeNull();
  });

  it("switches on either side of the draw tolerance boundary", () => {
    // Two tracks apart in intensity only, neither with the scene's
    // emotion, so the tolerance fallback decides (a same-emotion pool
    // shuffles instead). Only the current track's standing changes.
    const two: MusicManifest = {
      version: 3,
      styles: [{ id: "orchestral", name: "Orquesta" }],
      soundtracks: [{ id: "snd", name: "Snd", style: "orchestral" }],
      playlists: [],
      tracks: [track("t0", "calma", 0.5, 0.5), track("t1", "calma", 0.9, 0.5)],
    };
    const at = (intensity: number): SceneSignal => ({ vector: vec("tristeza"), intensity, tempo: 0.5 });
    const gapOf = (intensity: number) => {
      const s = at(intensity);
      const best = rankScored(s, two.tracks).map((e) => e.track)[0] as Track;
      return scoreTrack(s, best) - scoreTrack(s, two.tracks[0] as Track);
    };
    let cross = 1;
    for (let i = 0.5; i <= 1; i += 0.001) {
      if (gapOf(i) >= MUSIC_CONFIG.randomTolerance) {
        cross = i;
        break;
      }
    }
    const wLo = Math.max(0, cross - 0.01);
    const wHi = Math.min(1, cross + 0.01);
    expect(gapOf(wLo)).toBeLessThan(MUSIC_CONFIG.randomTolerance);
    expect(gapOf(wHi)).toBeGreaterThanOrEqual(MUSIC_CONFIG.randomTolerance);
    const run = (intensity: number) => {
      let d = observeScene(initScheduler(), "s1", at(0.5), two, 0, env);
      d = observeScene(d.state, "s2", at(intensity), two, 100, env);
      return tickScheduler(d.state, at(intensity), two, 100 + MUSIC_CONFIG.dwellSec + 1, env);
    };
    expect(run(wLo).switchToId).toBeNull();
    const hi = run(wHi);
    expect(hi.switchToId).toBe("t1");
  });

  it("a scene promotion switches as soon as dwell expires, without waiting for minTrackSec", () => {
    const mid = midSignal();
    // Short dwell override so promotion lands before minTrackSec; a switch
    // then can only mean the hold was bypassed on promote.
    const short = { dwellSec: 1 };
    let d = firstActive("tristeza");
    const entered = 1;
    d = observeScene(d.state, "s2", mid, manifest, entered, env, short);
    const before = entered + 0.5;
    const after = entered + 1.1;
    expect(after).toBeLessThan(MUSIC_CONFIG.minTrackSec);
    const early = tickScheduler(d.state, mid, manifest, before, env, short);
    expect(early.switchToId).toBeNull();
    const late = tickScheduler(d.state, mid, manifest, after, env, short);
    expect(late.state.activeSceneId).toBe("s2");
    expect(late.switchToId).toBe(rankScored(mid, manifest.tracks).map((e) => e.track)[0]?.id);
    expect(late.crossfadeSec).toBe(MUSIC_CONFIG.crossfadeSec);
  });

  it("dwellSec 0 promotes on the first observe (strong mood / chapter jump)", () => {
    const mid = midSignal();
    let d = firstActive("tristeza");
    d = observeScene(d.state, "s2", mid, manifest, 2, env, { dwellSec: 0 });
    expect(d.state.activeSceneId).toBe("s2");
    expect(d.switchToId).toBe(rankScored(mid, manifest.tracks).map((e) => e.track)[0]?.id);
    expect(d.crossfadeSec).toBe(MUSIC_CONFIG.crossfadeSec);
  });

  it("switches to the best match on promotion once dwell ends", () => {
    const s = signal("calma");
    let d = firstActive("tristeza");
    d = observeScene(d.state, "s2", s, manifest, 10, env);
    const early = tickScheduler(d.state, s, manifest, 10 + MUSIC_CONFIG.dwellSec - 0.5, env);
    expect(early.switchToId).toBeNull();
    const settled = tickScheduler(d.state, s, manifest, 10 + MUSIC_CONFIG.dwellSec + 0.5, env);
    expect(settled.switchToId).toBe("calm");
    expect(settled.crossfadeSec).toBe(MUSIC_CONFIG.crossfadeSec);
  });

  it("minTrackSec still holds when tick re-checks the same active scene", () => {
    // Promote into a calm scene (switch happens), then a later tick with a
    // sadder signal must wait out minTrackSec before reshuffling.
    const calm = signal("calma");
    const sad = signal("tristeza");
    let d = firstActive("calma");
    d = observeScene(d.state, "s2", calm, manifest, 10, env);
    d = tickScheduler(d.state, calm, manifest, 10 + MUSIC_CONFIG.dwellSec + 0.5, env);
    expect(d.state.activeSceneId).toBe("s2");
    expect(d.state.currentId).toBe("calm");
    // Force a pending-less re-check with a different emotion: pretend the
    // active scene's signal changed (same id) by ticking with sad.
    const started = d.state.currentStartedSec;
    const early = tickScheduler(
      { ...d.state, pendingSceneId: null },
      sad,
      manifest,
      started + MUSIC_CONFIG.minTrackSec - 1,
      env,
    );
    expect(early.switchToId).toBeNull();
    const late = tickScheduler(
      { ...d.state, pendingSceneId: null },
      sad,
      manifest,
      started + MUSIC_CONFIG.minTrackSec + 1,
      env,
    );
    expect(late.switchToId).toBe("sad-a");
  });

  it("keeps only the newest scene on a fast scroll", () => {
    let d = firstActive("tristeza");
    d = observeScene(d.state, "s2", signal("calma"), manifest, 50, env);
    expect(d.state.pendingSceneId).toBe("s2");
    d = observeScene(d.state, "s3", signal("suspenso"), manifest, 55, env);
    expect(d.state.pendingSceneId).toBe("s3");
    const early = tickScheduler(d.state, signal("suspenso"), manifest, 55 + MUSIC_CONFIG.dwellSec - 1, env);
    expect(early.state.activeSceneId).toBe("s1");
    const late = tickScheduler(d.state, signal("suspenso"), manifest, 55 + MUSIC_CONFIG.dwellSec + 1, env);
    expect(late.state.activeSceneId).toBe("s3");
    expect(late.switchToId).toBe("tense");
  });

  it("returns to the active scene clears a pending scene with no switch", () => {
    let d = firstActive("tristeza");
    d = observeScene(d.state, "s2", signal("calma"), manifest, 50, env);
    d = observeScene(d.state, "s1", signal("tristeza"), manifest, 55, env);
    expect(d.state.pendingSceneId).toBeNull();
    expect(d.switchToId).toBeNull();
  });

  it("a null scene promotes with no switch", () => {
    let d = firstActive("tristeza");
    d = observeScene(d.state, "s2", null, manifest, 100, env);
    const settled = tickScheduler(d.state, null, manifest, 130, env);
    expect(settled.state.activeSceneId).toBe("s2");
    expect(settled.switchToId).toBeNull();
  });
});

describe("requestNext", () => {
  it("holds the override on the same scene past minTrackSec, even with a wide gap", () => {
    let d = firstActive("tristeza");
    d = requestNext(d.state, signal("tristeza"), manifest, 5, env);
    expect(d.state.overrideId).toBe("sad-b");
    const calm = signal("calma");
    const best = rankScored(calm, manifest.tracks).map((e) => e.track)[0] as Track;
    const gap =
      scoreTrack(calm, best) - scoreTrack(calm, manifest.tracks[1] as Track);
    expect(gap).toBeGreaterThanOrEqual(MUSIC_CONFIG.randomTolerance);
    const held = tickScheduler(d.state, calm, manifest, 5 + MUSIC_CONFIG.minTrackSec + 10, env);
    expect(held.switchToId).toBeNull();
    expect(held.state.currentId).toBe("sad-b");
    expect(held.state.overrideId).toBe("sad-b");
  });

  it("holds the override against a mid gap past minTrackSec", () => {
    const mid = midSignal();
    const best = rankScored(mid, manifest.tracks).map((e) => e.track)[0] as Track;
    expect(
      scoreTrack(mid, best) - scoreTrack(mid, manifest.tracks[1] as Track),
    ).toBeGreaterThanOrEqual(MUSIC_CONFIG.randomTolerance);
    let d = firstActive("tristeza");
    d = requestNext(d.state, signal("tristeza"), manifest, 5, env);
    const held = tickScheduler(d.state, mid, manifest, 5 + MUSIC_CONFIG.minTrackSec + 5, env);
    expect(held.switchToId).toBeNull();
    expect(held.state.currentId).toBe("sad-b");
    expect(held.state.overrideId).toBe("sad-b");
  });

  it("resumes normal rules after a new scene is promoted", () => {
    let d = firstActive("tristeza");
    d = requestNext(d.state, signal("tristeza"), manifest, 5, env);
    d = observeScene(d.state, "s2", signal("calma"), manifest, 50, env);
    const settled = tickScheduler(d.state, signal("calma"), manifest, 50 + MUSIC_CONFIG.dwellSec + 1, env);
    expect(settled.state.overrideId).toBeNull();
    expect(settled.switchToId).toBe("calm");
  });

  it("holds the override until the scene changes, then clears it", () => {
    let d = firstActive("tristeza");
    d = requestNext(d.state, signal("tristeza"), manifest, 5, env);
    expect(d.switchToId).toBe("sad-b");
    expect(d.crossfadeSec).toBe(MUSIC_CONFIG.crossfadeSec);
    expect(d.state.overrideId).toBe("sad-b");
    // Same scene again: override still stands, current unchanged.
    expect(d.state.currentId).toBe("sad-b");
    d = observeScene(d.state, "s2", signal("tristeza"), manifest, 40, env);
    const settled = tickScheduler(d.state, signal("tristeza"), manifest, 61, env);
    expect(settled.state.overrideId).toBeNull();
    // The override track was the base: sad-b still holds a near scene.
    expect(settled.state.currentId).toBe("sad-b");
    expect(settled.switchToId).toBeNull();
  });
});

describe("noteTrackEnded", () => {
  it("fades into the best remaining track excluding the ended one", () => {
    let d = firstActive("tristeza");
    d = noteTrackEnded(d.state, signal("tristeza"), manifest, "sad-a", 200, env);
    expect(d.switchToId).toBe("sad-b");
    expect(d.crossfadeSec).toBe(MUSIC_CONFIG.crossfadeSec);
  });

  it("clears the skip override", () => {
    let d = firstActive("tristeza");
    d = requestNext(d.state, signal("tristeza"), manifest, 5, env);
    expect(d.state.overrideId).toBe("sad-b");
    d = noteTrackEnded(d.state, signal("tristeza"), manifest, "sad-b", 200, env);
    expect(d.state.overrideId).toBeNull();
    expect(d.state.overrideSceneId).toBeNull();
    expect(d.switchToId).toBe("sad-a");
  });
});
