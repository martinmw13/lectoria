import { describe, expect, it } from "vitest";
import { MUSIC_CONFIG,
  candidatesFor,
  CHOPIN_PLAYLIST_ID,
  nextTrack,
  parseManifest,
  requestStyleChange,
  styleHasTracks,
} from "./music";
import type { MusicManifest, MusicSelection, SceneSignal, SelectEnv, Track } from "./music";
import type { Vector8 } from "./types";
import { EMOTIONS } from "./types";
import {
  enterPlaylist,
  exitPlaylist,
  initScheduler,
  noteTrackEnded,
  observeScene,
  requestNext,
  switchStyle,
  tickScheduler,
} from "./music-schedule";

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
  only = false,
  intensity = 0.5,
  tempo = 0.5,
): Track {
  return {
    id,
    src: `/music/${id}.mp3`,
    title: id,
    playlistOnly: only,
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

// The Chopin tracks are perfect emotion matches, so any leak into emotion
// selection would surface as a Chopin pick instead of an audible one.
const manifest: MusicManifest = {
  version: 3,
  styles: [{ id: "orchestral", name: "Orquesta" }],
  soundtracks: [
    { id: "orch-a", name: "A", style: "orchestral" },
    { id: "orch-b", name: "B", style: "orchestral" },
    { id: "chopin", name: "Chopin", style: "orchestral" },
  ],
  playlists: [
    { id: CHOPIN_PLAYLIST_ID, label: "Just play Chopin", trackIds: ["chop-1", "chop-2", "chop-3", "chop-4"] },
  ],
  tracks: [
    track("a-calma", "calma", "orch-a", "orchestral"),
    track("a-triste-far", "tristeza", "orch-a", "orchestral", false, 0.9, 0.9),
    track("b-calma", "calma", "orch-b", "orchestral"),
    track("b-alegre", "alegria", "orch-b", "orchestral"),
    track("chop-1", "calma", "chopin", "orchestral", true),
    track("chop-2", "alegria", "chopin", "orchestral", true),
    track("chop-3", "tristeza", "chopin", "orchestral", true),
    track("chop-4", "asombro", "chopin", "orchestral", true),
  ],
};

const orch: MusicSelection = { style: "orchestral" };
const envA: SelectEnv = { selection: orch, rng: () => 0 };
const envB: SelectEnv = { selection: orch, rng: () => 0 };

function entered() {
  const d = enterPlaylist(initScheduler(), manifest, CHOPIN_PLAYLIST_ID, 0);
  return d.state;
}

describe("playlist parse", () => {
  function rawTrack(id: string, extra: Record<string, unknown> = {}) {
    return {
      id,
      src: `/music/${id}.mp3`,
      title: id,
      emotion: "calma",
      vector: Object.fromEntries(EMOTIONS.map((e) => [e, e === "calma" ? 0.93 : 0.01])),
      intensity: 0.5,
      tempo: 0.5,
      durationSec: 120,
      soundtrack: "orch-a",
      style: "orchestral",
      ...extra,
    };
  }

  function rawManifest(playlists?: unknown) {
    const m: Record<string, unknown> = {
      version: 3,
      styles: [{ id: "orchestral", name: "Orquesta" }],
      soundtracks: [{ id: "orch-a", name: "A", style: "orchestral" }],
      tracks: [rawTrack("a-calma"), rawTrack("b1", { playlistOnly: true })],
    };
    if (playlists !== undefined) m.playlists = playlists;
    return m;
  }

  const goodPlaylist = () => [
    { id: CHOPIN_PLAYLIST_ID, label: "Just play Chopin", trackIds: ["b1"] },
  ];

  it("parses a missing playlists key as an empty list", () => {
    expect(parseManifest(rawManifest()).playlists).toEqual([]);
  });

  it("parses a good playlist entry", () => {
    expect(parseManifest(rawManifest(goodPlaylist())).playlists).toEqual(goodPlaylist());
  });

  it("rejects duplicate playlist ids", () => {
    const two = [goodPlaylist()[0], goodPlaylist()[0]];
    expect(() => parseManifest(rawManifest(two))).toThrow(/duplicate playlist id/);
  });

  it("rejects an empty label", () => {
    expect(() =>
      parseManifest(rawManifest([{ id: "p", label: "", trackIds: ["b1"] }])),
    ).toThrow(/playlist p label/);
  });

  it("rejects trackIds that name no track, naming the playlist and the id", () => {
    expect(() =>
      parseManifest(
        rawManifest([{ id: CHOPIN_PLAYLIST_ID, label: "Just play Chopin", trackIds: ["no-such"] }]),
      ),
    ).toThrow(/just-play-chopin.*no-such/);
  });

  it("gives a v2 migration an empty playlist list and a false playlistOnly", () => {
    const parsed = parseManifest({
      version: 2,
      tracks: [
        {
          id: "t1",
          src: "/music/t1.mp3",
          title: "One",
          emotion: "calma",
          vector: Object.fromEntries(EMOTIONS.map((id) => [id, 0.125])),
          intensity: 0.2,
          tempo: 0.3,
          durationSec: 120,
        },
      ],
    });
    expect(parsed.playlists).toEqual([]);
    expect(parsed.tracks[0]?.playlistOnly).toBe(false);
  });

  it("rejects a non-boolean playlistOnly", () => {
    expect(() => parseManifest(rawManifest())).not.toThrow();
    const bad = rawManifest();
    (bad.tracks as Record<string, unknown>[])[0]!.playlistOnly = "yes";
    expect(() => parseManifest(bad)).toThrow(/playlistOnly must be a boolean/);
  });
});

describe("playlistOnly exclusion", () => {
  it("keeps playlist tracks out of the candidate set", () => {
    const ids = candidatesFor(orch, manifest).map((t) => t.id);
    expect(ids).toEqual(["a-calma", "a-triste-far", "b-calma", "b-alegre"]);
  });

  it("scheduled select skips a perfect-match playlist track", () => {
    let d = observeScene(initScheduler(), "s1", signal("calma"), manifest, 0, envB);
    expect(d.switchToId).toBe("a-calma");
    d = observeScene(d.state, "s2", signal("tristeza"), manifest, 50, envB);
    const settled = tickScheduler(d.state, signal("tristeza"), manifest, 71, envB);
    expect(settled.switchToId).toBe("a-triste-far");
  });

  it("Next skips a perfect-match playlist track", () => {
    expect(nextTrack(signal("tristeza"), manifest, "b-calma", undefined, orch)?.id).toBe(
      "a-triste-far",
    );
  });

  it("style switching never lands on a playlist track", () => {
    const picked = requestStyleChange(manifest, "orchestral", signal("tristeza"));
    expect(picked?.track.id).toBe("a-triste-far");
  });

  it("a style with only playlist tracks has no tracks", () => {
    expect(styleHasTracks(manifest, "orchestral")).toBe(true);
    const solo: MusicManifest = {
      version: 3,
      styles: [{ id: "solo", name: "Solo" }],
      soundtracks: [{ id: "s", name: "S", style: "solo" }],
      playlists: [],
      tracks: [track("only", "calma", "s", "solo", true)],
    };
    expect(styleHasTracks(solo, "solo")).toBe(false);
  });
});

describe("playlist mode", () => {
  it("enters at once on the first playlist track", () => {
    const playing = {
      ...initScheduler(),
      currentId: "a-calma",
      currentStartedSec: 0,
      activeSceneId: "s1",
    };
    const d = enterPlaylist(playing, manifest, CHOPIN_PLAYLIST_ID, 10);
    expect(d.switchToId).toBe("chop-1");
    expect(d.crossfadeSec).toBe(MUSIC_CONFIG.crossfadeSec);
    expect(d.state.currentStartedSec).toBe(10);
    expect(d.state.playlist).toEqual({ id: CHOPIN_PLAYLIST_ID, index: 0 });
  });

  it("plays straight through and wraps from last to first", () => {
    let state = entered();
    for (const want of ["chop-2", "chop-3", "chop-4", "chop-1"]) {
      const d = noteTrackEnded(state, signal("calma"), manifest, state.currentId as string, 10, envA);
      expect(d.switchToId).toBe(want);
      expect(d.crossfadeSec).toBe(MUSIC_CONFIG.crossfadeSec);
      state = d.state;
    }
    expect(state.playlist).toEqual({ id: CHOPIN_PLAYLIST_ID, index: 0 });
  });

  it("re-cues a one-track playlist instead of going quiet", () => {
    const solo: MusicManifest = {
      ...manifest,
      playlists: [{ id: "solo", label: "Solo", trackIds: ["chop-1"] }],
    };
    const state = enterPlaylist(initScheduler(), solo, "solo", 0).state;
    const d = noteTrackEnded(state, signal("calma"), solo, "chop-1", 130, envA);
    expect(d.switchToId).toBe("chop-1");
    expect(d.crossfadeSec).toBe(MUSIC_CONFIG.crossfadeSec);
    expect(d.state.playlist).toEqual({ id: "solo", index: 0 });
  });

  it("ignores scene changes while on", () => {
    const state = entered();
    const d = observeScene(state, "s2", signal("tristeza"), manifest, 50, envA);
    expect(d.switchToId).toBeNull();
    const settled = tickScheduler(d.state, signal("tristeza"), manifest, 71, envA);
    expect(settled.switchToId).toBeNull();
    expect(settled.state.currentId).toBe("chop-1");
    expect(settled.state.activeSceneId).toBe("s2");
  });

  it("advances the playlist on Next with the same wrap", () => {
    const state = entered();
    const d = requestNext(state, signal("calma"), manifest, 10, envA);
    expect(d.switchToId).toBe("chop-2");
    const last = { ...d.state, playlist: { id: CHOPIN_PLAYLIST_ID, index: 3 }, currentId: "chop-4" };
    expect(requestNext(last, signal("calma"), manifest, 20, envA).switchToId).toBe("chop-1");
  });

  it("ignores style changes while on, keeping the playlist index", () => {
    const state = entered();
    const d = switchStyle(state, signal("calma"), manifest, 10, "orchestral");
    expect(d.switchToId).toBeNull();
    expect(d.state.playlist).toEqual({ id: CHOPIN_PLAYLIST_ID, index: 0 });
    expect(d.state.currentId).toBe("chop-1");
  });

  it("exits at once to the best match under the restored selection", () => {
    const state = entered();
    const d = exitPlaylist(state, signal("calma"), manifest, 100, envA);
    expect(d.switchToId).toBe("a-calma");
    expect(d.crossfadeSec).toBe(MUSIC_CONFIG.crossfadeSec);
    expect(d.state.playlist).toBeNull();
    const pending = observeScene(d.state, "s2", signal("tristeza"), manifest, 150, envA);
    const resumed = tickScheduler(pending.state, signal("tristeza"), manifest, 171, envA);
    expect(resumed.switchToId).toBe("a-triste-far");
  });
});
