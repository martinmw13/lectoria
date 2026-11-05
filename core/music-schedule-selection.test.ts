import { describe, expect, it } from "vitest";
import { MUSIC_CONFIG, nextTrack } from "./music";
import type { MusicManifest, MusicSelection, SceneSignal, SelectEnv, Track } from "./music";
import type { Vector8 } from "./types";
import { EMOTIONS } from "./types";
import {
  initScheduler,
  noteTrackEnded,
  observeScene,
  requestManualTrack,
  requestNext,
  switchStyle,
  tickScheduler,
} from "./music-schedule";
import { popHistory, pushHistory } from "./music-history";

function vec(top: string): Vector8 {
  const v = Object.fromEntries(EMOTIONS.map((id) => [id, 0.01])) as Record<string, number>;
  v[top] = 0.93;
  return v as Vector8;
}

function signal(top: string, intensity = 0.5, tempo = 0.5): SceneSignal {
  return { vector: vec(top), intensity, tempo };
}

function track(
  id: string,
  top: string,
  soundtrack: string,
  style: string,
  intensity = 0.5,
  tempo = 0.5,
): Track {
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
    soundtrack,
    style,
  };
}

const manifest: MusicManifest = {
  version: 3,
  styles: [
    { id: "orchestral", name: "Orquesta" },
    { id: "piano", name: "Piano" },
  ],
  soundtracks: [
    { id: "orch-a", name: "A", style: "orchestral" },
    { id: "orch-b", name: "B", style: "orchestral" },
    { id: "piano-a", name: "P", style: "piano" },
  ],
  playlists: [],
  tracks: [
    track("a-calma", "calma", "orch-a", "orchestral"),
    track("a-calm2", "calma", "orch-a", "orchestral", 0.52),
    track("a-triste", "tristeza", "orch-a", "orchestral"),
    track("a-far", "calma", "orch-a", "orchestral", 0.9, 0.9),
    track("b-calma", "calma", "orch-b", "orchestral"),
    track("b-alegre", "alegria", "orch-b", "orchestral"),
    track("p-calma", "calma", "piano-a", "piano"),
    track("p-mist", "misterio", "piano-a", "piano"),
  ],
};

function envFor(selection: MusicSelection, rng: () => number = () => 0): SelectEnv {
  return { selection, rng };
}

const orch = envFor({ style: "orchestral" });
const orchSeeded = (rng: () => number = () => 0) => envFor({ style: "orchestral" }, rng);

describe("scheduled select", () => {
  it("plays the best same-style match for the scene at once", () => {
    const d = observeScene(initScheduler(), "s1", signal("calma"), manifest, 0, orch);
    expect(d.switchToId).toBe("a-calma");
  });

  it("switches to the best same-style match for a new emotion", () => {
    let d = observeScene(initScheduler(), "s1", signal("calma"), manifest, 0, orch);
    expect(d.switchToId).toBe("a-calma");
    d = observeScene(d.state, "s2", signal("tristeza"), manifest, 50, orch);
    const settled = tickScheduler(d.state, signal("tristeza"), manifest, 71, orch);
    expect(settled.state.activeSceneId).toBe("s2");
    expect(settled.switchToId).toBe("a-triste");
  });

  it("ranges across soundtracks for a missing emotion", () => {
    let d = observeScene(initScheduler(), "s1", signal("alegria"), manifest, 0, orch);
    expect(d.switchToId).toBe("b-alegre");
    d = observeScene(d.state, "s2", signal("tristeza"), manifest, 50, orch);
    const settled = tickScheduler(d.state, signal("tristeza"), manifest, 71, orch);
    expect(settled.switchToId).toBe("a-triste");
  });

  function playing(id: string, started: number) {
    return {
      ...initScheduler(),
      currentId: id,
      currentStartedSec: started,
      activeSceneId: "s1",
    };
  }

  it("keeps the current track when it is itself eligible", () => {
    const d = tickScheduler(playing("a-calma", 0), signal("calma"), manifest, 100, orchSeeded());
    expect(d.switchToId).toBeNull();
  });

  it("keeps a same-emotion current track however far its score", () => {
    const d = tickScheduler(playing("a-far", 0), signal("calma"), manifest, 100, orchSeeded());
    expect(d.switchToId).toBeNull();
  });

  it("draws another eligible track once min-track time has passed", () => {
    const d = tickScheduler(playing("a-triste", 0), signal("calma"), manifest, 100, orchSeeded());
    expect(d.switchToId).toBe("a-calma");
    expect(d.crossfadeSec).toBe(MUSIC_CONFIG.crossfadeSec);
  });

  it("holds the current pick until min-track time passes", () => {
    const d = tickScheduler(playing("a-triste", 0), signal("calma"), manifest, MUSIC_CONFIG.minTrackSec - 1, orchSeeded());
    expect(d.switchToId).toBeNull();
  });

  it("draws once per tick, discarding the hold pick but skipping a kept track", () => {
    const counting = () => {
      let calls = 0;
      return { rng: () => (calls++, 0), calls: () => calls };
    };
    const draw = counting();
    const d = tickScheduler(playing("a-triste", 0), signal("calma"), manifest, 100, orchSeeded(draw.rng));
    expect(d.switchToId).toBe("a-calma");
    expect(draw.calls()).toBe(1);
    const held = counting();
    const h = tickScheduler(playing("a-triste", 0), signal("calma"), manifest, MUSIC_CONFIG.minTrackSec - 1, orchSeeded(held.rng));
    expect(h.switchToId).toBeNull();
    expect(held.calls()).toBe(1);
    const kept = counting();
    const k = tickScheduler(playing("a-calma", 0), signal("calma"), manifest, 100, orchSeeded(kept.rng));
    expect(k.switchToId).toBeNull();
    expect(kept.calls()).toBe(0);
  });

  it("is deterministic under a seeded rng", () => {
    const run = () =>
      tickScheduler(playing("a-far", 0), signal("calma"), manifest, 100, orchSeeded(() => 0.99));
    expect(run().switchToId).toBe(run().switchToId);
    expect(run().switchToId).not.toBe("a-far");
  });

  it("never leaves the style", () => {
    let d = observeScene(initScheduler(), "s1", signal("calma"), manifest, 0, orchSeeded());
    for (const [scene, top, at] of [
      ["s2", "tristeza", 30],
      ["s3", "alegria", 80],
      ["s4", "misterio", 130],
    ] as const) {
      d = observeScene(d.state, scene, signal(top), manifest, at, orchSeeded());
      d = tickScheduler(d.state, signal(top), manifest, at + 21, orchSeeded());
      if (d.switchToId !== null) {
        const picked = manifest.tracks.find((t) => t.id === d.switchToId);
        expect(picked?.style).toBe("orchestral");
      }
    }
  });
});

describe("requestNext", () => {
  it("cycles same-emotion tracks across soundtracks", () => {
    let d = observeScene(initScheduler(), "s1", signal("calma"), manifest, 0, orch);
    expect(d.switchToId).toBe("a-calma");
    d = requestNext(d.state, signal("calma"), manifest, 5, orch);
    expect(d.switchToId).toBe("b-calma");
  });

  it("Next offers nothing outside the style", () => {
    expect(nextTrack(signal("calma"), manifest, "p-calma", undefined, orch.selection)?.style).toBe(
      "orchestral",
    );
  });
});

describe("requestManualTrack", () => {
  it("switches at once to the named track and holds it like a Next", () => {
    let d = observeScene(initScheduler(), "s1", signal("calma"), manifest, 0, orch);
    d = requestManualTrack(d.state, manifest, "b-calma", 5, orch.selection);
    expect(d.switchToId).toBe("b-calma");
    expect(d.state.currentId).toBe("b-calma");
    expect(d.state.overrideId).toBe("b-calma");
    expect(d.crossfadeSec).toBe(MUSIC_CONFIG.crossfadeSec);
    const held = tickScheduler(d.state, signal("calma"), manifest, 50, orch);
    expect(held.switchToId).toBeNull();
  });

  it("changes nothing for an unknown id", () => {
    const d = observeScene(initScheduler(), "s1", signal("calma"), manifest, 0, orch);
    const kept = requestManualTrack(d.state, manifest, "gone", 5, orch.selection);
    expect(kept.switchToId).toBeNull();
    expect(kept.state).toBe(d.state);
  });

  it("rejects a playlist-only id in emotion mode", () => {
    const ghost: Track = { ...track("ghost", "calma", "orch-a", "orchestral"), playlistOnly: true };
    const withGhost: MusicManifest = { ...manifest, tracks: [...manifest.tracks, ghost] };
    const d = observeScene(initScheduler(), "s1", signal("calma"), withGhost, 0, orch);
    const kept = requestManualTrack(d.state, withGhost, "ghost", 5, orch.selection);
    expect(kept.switchToId).toBeNull();
    expect(kept.state).toBe(d.state);
  });
});

describe("history stack", () => {
  it("pushes the outgoing id, pops it back, caps at the limit", () => {
    let hist = pushHistory([], null);
    expect(hist).toEqual([]);
    hist = pushHistory(hist, "a");
    hist = pushHistory(hist, "b");
    expect(popHistory(hist)).toEqual({ hist: ["a"], id: "b" });
    expect(popHistory([])).toBeNull();
    let big: string[] = [];
    for (let i = 0; i < 60; i++) big = pushHistory(big, `t${i}`);
    expect(big).toHaveLength(50);
    expect(big[49]).toBe("t59");
  });
});

describe("noteTrackEnded", () => {
  it("never crosses styles", () => {
    let d = observeScene(initScheduler(), "s1", signal("calma"), manifest, 0, orch);
    d = noteTrackEnded(d.state, signal("calma"), manifest, d.switchToId as string, 200, orch);
    const picked = manifest.tracks.find((t) => t.id === d.switchToId);
    expect(picked?.style).toBe("orchestral");
  });
});

describe("switchStyle", () => {
  it("switches at once with the normal crossfade and sets the override", () => {
    const d = observeScene(initScheduler(), "s1", signal("calma"), manifest, 0, orch);
    expect(d.switchToId).toBe("a-calma");
    const changed = switchStyle(d.state, signal("calma"), manifest, 1, "piano");
    expect(changed.switchToId).toBe("p-calma");
    expect(changed.crossfadeSec).toBe(MUSIC_CONFIG.crossfadeSec);
    expect(changed.state.overrideId).toBe("p-calma");
  });

  it("later scenes stay in the new style", () => {
    let d = observeScene(initScheduler(), "s1", signal("calma"), manifest, 0, orch);
    d = switchStyle(d.state, signal("calma"), manifest, 1, "piano");
    const piano = envFor({ style: "piano" });
    const next = observeScene(d.state, "s2", signal("misterio"), manifest, 50, piano);
    const settled = tickScheduler(next.state, signal("misterio"), manifest, 71, piano);
    expect(settled.switchToId).toBe("p-mist");
  });

  it("returns null with the state unchanged when the style has no tracks", () => {
    const d = observeScene(initScheduler(), "s1", signal("calma"), manifest, 0, orch);
    const changed = switchStyle(d.state, signal("calma"), manifest, 50, "koto");
    expect(changed.switchToId).toBeNull();
  });
});
