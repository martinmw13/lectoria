import { describe, expect, it } from "vitest";
import { CHOPIN_PLAYLIST_ID, MUSIC_CONFIG } from "./music";
import type { MusicManifest, SceneSignal, Track } from "./music";
import type { Vector8 } from "./types";
import { EMOTIONS } from "./types";
import { dispatch, startSession } from "./music-session";
import type { SessionContext } from "./music-session";

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

const manifest: MusicManifest = {
  version: 3,
  styles: [
    { id: "orchestral", name: "Orquesta" },
    { id: "piano", name: "Piano" },
  ],
  soundtracks: [
    { id: "orch", name: "Orch", style: "orchestral" },
    { id: "piano-s", name: "Piano S", style: "piano" },
    { id: "chop-s", name: "Chopin S", style: "orchestral" },
  ],
  playlists: [{ id: CHOPIN_PLAYLIST_ID, label: "Just play Chopin", trackIds: ["chop-1", "chop-2"] }],
  tracks: [
    track("o-calm-a", "calma", "orch", "orchestral"),
    track("o-calm-b", "calma", "orch", "orchestral", false, 0.52),
    track("o-calm-c", "calma", "orch", "orchestral", false, 0.9, 0.9),
    track("o-sad", "tristeza", "orch", "orchestral"),
    track("o-fight", "combate", "orch", "orchestral"),
    track("o-suspense", "suspenso", "orch", "orchestral"),
    track("p-calm", "calma", "piano-s", "piano"),
    track("chop-1", "calma", "chop-s", "orchestral", true),
    track("chop-2", "tristeza", "chop-s", "orchestral", true),
  ],
};

const signals: Record<string, SceneSignal> = {
  s1: signal("calma"),
  s2: signal("tristeza"),
  // Oz ch6 demo: forest suspense then Lion Ambush combat.
  c6s1: signal("suspenso", 0.325, 0.27),
  c6s2: signal("combate", 0.695, 0.94),
};

function ctx(routeSceneId: string | null, nowSec: number, over?: Partial<SessionContext>): SessionContext {
  return {
    manifest,
    signalOf: (id) => signals[id] ?? null,
    routeSceneId,
    nowSec,
    rng: () => 0,
    ...over,
  };
}

function entered(route = "s1", at = 0) {
  return dispatch(startSession(manifest, null), { type: "sceneEntered", sceneId: route }, ctx(route, at));
}

describe("startSession", () => {
  it("starts silent with no history and the default style", () => {
    const session = startSession(manifest, null);
    expect(session.view.currentId).toBeNull();
    expect(session.view.fadeSec).toBe(0);
    expect(session.view.replayNonce).toBe(0);
    expect(session.view.canPrev).toBe(false);
    expect(session.view.canSkip).toBe(true);
    expect(session.view.playlistOn).toBe(false);
    expect(session.view.style).toBe("orchestral");
  });

  it("a stored style with tracks wins", () => {
    const session = startSession(manifest, { style: "piano", volume: null, muted: false, playlist: false });
    expect(session.view.style).toBe("piano");
  });

  it("a stored Chopin mode starts in the playlist with the stored style", () => {
    const session = startSession(manifest, {
      style: "piano",
      volume: null,
      muted: false,
      playlist: true,
    });
    expect(session.view.playlistOn).toBe(true);
    expect(session.view.currentId).toBe("chop-1");
    expect(session.view.fadeSec).toBe(0);
    expect(session.view.style).toBe("piano");
  });

  it("a stored Chopin mode without the playlist falls back to the style", () => {
    const bare: MusicManifest = { ...manifest, playlists: [] };
    const session = startSession(bare, {
      style: "piano",
      volume: null,
      muted: false,
      playlist: true,
    });
    expect(session.view.playlistOn).toBe(false);
    expect(session.view.currentId).toBeNull();
    expect(session.view.style).toBe("piano");
  });
});

describe("scene entry and tick", () => {
  it("the first scene entry plays at once with fade 0", () => {
    const session = entered();
    expect(session.view.currentId).toBe("o-calm-a");
    expect(session.view.fadeSec).toBe(0);
    expect(session.view.canPrev).toBe(true);
  });

  it("a strong mood change switches on the same scene entry (no entry dwell)", () => {
    // calma → tristeza: different dominant emotion, like suspenso → combate
    // on Oz Lion Ambush. A short scene must not wait out the entry dwell.
    const first = entered("s1", 0);
    expect(first.view.currentId).toBe("o-calm-a");
    const next = dispatch(first, { type: "sceneEntered", sceneId: "s2" }, ctx("s2", 50));
    expect(next.view.currentId).toBe("o-sad");
    expect(next.view.fadeSec).toBe(MUSIC_CONFIG.crossfadeSec);
  });

  it("Oz Lion Ambush: suspenso → combate switches at once", () => {
    const forest = dispatch(
      startSession(manifest, null),
      { type: "sceneEntered", sceneId: "c6s1" },
      ctx("c6s1", 0),
    );
    expect(forest.view.currentId).toBe("o-suspense");
    const ambush = dispatch(forest, { type: "sceneEntered", sceneId: "c6s2" }, ctx("c6s2", 2));
    expect(ambush.view.currentId).toBe("o-fight");
    expect(ambush.view.fadeSec).toBe(MUSIC_CONFIG.crossfadeSec);
  });

  it("a same-emotion scene still waits the entry dwell", () => {
    const first = entered("s1", 0);
    expect(first.view.currentId).toBe("o-calm-a");
    // Another calm scene: keep current through the short dwell.
    signals.s3 = signal("calma", 0.6, 0.6);
    const pending = dispatch(first, { type: "sceneEntered", sceneId: "s3" }, ctx("s3", 50));
    expect(pending.view.currentId).toBe("o-calm-a");
    const early = dispatch(pending, { type: "tick" }, ctx("s3", 50.5));
    expect(early.view.currentId).toBe("o-calm-a");
    const late = dispatch(pending, { type: "tick" }, ctx("s3", 51.1));
    expect(late.scheduler.activeSceneId).toBe("s3");
  });

  it("a settled tick returns the identical session object", () => {
    const session = entered();
    expect(dispatch(session, { type: "tick" }, ctx("s1", 100))).toBe(session);
  });

  it("tick without a route scene changes nothing", () => {
    const session = entered();
    expect(dispatch(session, { type: "tick" }, ctx(null, 100))).toBe(session);
  });
});

describe("skip and previous", () => {
  it("skip holds until the next scene change", () => {
    const first = entered("s1", 0);
    const skipped = dispatch(first, { type: "skip" }, ctx("s1", 5));
    expect(skipped.view.currentId).toBe("o-calm-b");
    expect(skipped.view.fadeSec).toBe(MUSIC_CONFIG.crossfadeSec);
    expect(dispatch(skipped, { type: "tick" }, ctx("s1", 100))).toBe(skipped);
    const pending = dispatch(skipped, { type: "sceneEntered", sceneId: "s2" }, ctx("s2", 110));
    const settled = dispatch(pending, { type: "tick" }, ctx("s2", 116));
    expect(settled.view.currentId).toBe("o-sad");
  });

  it("previous walks back without re-pushing, then restarts", () => {
    let session = entered("s1", 0);
    const a = session.view.currentId as string;
    session = dispatch(session, { type: "skip" }, ctx("s1", 5));
    const b = session.view.currentId as string;
    expect(b).not.toBe(a);
    session = dispatch(session, { type: "skip" }, ctx("s1", 6));
    const c = session.view.currentId as string;
    expect(c).not.toBe(b);
    session = dispatch(session, { type: "previous" }, ctx("s1", 7));
    expect(session.view.currentId).toBe(b);
    session = dispatch(session, { type: "previous" }, ctx("s1", 8));
    expect(session.view.currentId).toBe(a);
    const nonce = session.view.replayNonce;
    session = dispatch(session, { type: "previous" }, ctx("s1", 9));
    expect(session.view.currentId).toBe(a);
    expect(session.view.replayNonce).toBe(nonce + 1);
  });

  it("trackEnded fades to another track and is undoable", () => {
    let session = entered("s1", 0);
    const a = session.view.currentId as string;
    session = dispatch(session, { type: "trackEnded", trackId: a }, ctx("s1", 10));
    expect(session.view.currentId).not.toBe(a);
    expect(session.view.fadeSec).toBe(MUSIC_CONFIG.crossfadeSec);
    session = dispatch(session, { type: "previous" }, ctx("s1", 11));
    expect(session.view.currentId).toBe(a);
  });
});

describe("style change", () => {
  it("switches, updates the view style, and ignores repeats", () => {
    let session = entered("s1", 0);
    session = dispatch(session, { type: "styleChanged", style: "piano" }, ctx("s1", 5));
    expect(session.view.currentId).toBe("p-calm");
    expect(session.view.style).toBe("piano");
    expect(dispatch(session, { type: "styleChanged", style: "piano" }, ctx("s1", 6))).toBe(session);
  });

  it("is ignored in playlist mode and without a route scene", () => {
    let session = entered("s1", 0);
    session = dispatch(session, { type: "playlistToggled" }, ctx("s1", 5));
    expect(dispatch(session, { type: "styleChanged", style: "piano" }, ctx("s1", 6))).toBe(session);
    const plain = entered();
    expect(dispatch(plain, { type: "styleChanged", style: "piano" }, ctx(null, 6))).toBe(plain);
  });

  it("a style with no tracks changes nothing", () => {
    const session = entered();
    expect(dispatch(session, { type: "styleChanged", style: "koto" }, ctx("s1", 5))).toBe(session);
  });
});

describe("playlist mode", () => {
  it("toggles to the first Chopin track, advances, wraps, and exits", () => {
    let session = entered("s1", 0);
    session = dispatch(session, { type: "playlistToggled" }, ctx("s1", 5));
    expect(session.view.currentId).toBe("chop-1");
    expect(session.view.playlistOn).toBe(true);
    session = dispatch(session, { type: "skip" }, ctx("s1", 6));
    expect(session.view.currentId).toBe("chop-2");
    session = dispatch(session, { type: "skip" }, ctx("s1", 7));
    expect(session.view.currentId).toBe("chop-1");
    session = dispatch(session, { type: "playlistToggled" }, ctx("s1", 8));
    expect(session.view.playlistOn).toBe(false);
    expect(session.view.currentId).toBe("o-calm-a");
  });

  it("previous in playlist mode restarts instead of walking history", () => {
    let session = entered("s1", 0);
    session = dispatch(session, { type: "playlistToggled" }, ctx("s1", 5));
    const nonce = session.view.replayNonce;
    session = dispatch(session, { type: "previous" }, ctx("s1", 6));
    expect(session.view.currentId).toBe("chop-1");
    expect(session.view.replayNonce).toBe(nonce + 1);
  });

  it("a one-track playlist re-cues with a nonce bump on skip and end", () => {
    const solo: MusicManifest = {
      ...manifest,
      playlists: [{ id: CHOPIN_PLAYLIST_ID, label: "Solo", trackIds: ["chop-1"] }],
    };
    const at = (route: string | null, nowSec: number): SessionContext => ({
      manifest: solo,
      signalOf: (id) => signals[id] ?? null,
      routeSceneId: route,
      nowSec,
      rng: () => 0,
    });
    let session = dispatch(startSession(solo, null), { type: "sceneEntered", sceneId: "s1" }, at("s1", 0));
    session = dispatch(session, { type: "playlistToggled" }, at("s1", 5));
    expect(session.view.currentId).toBe("chop-1");
    expect(session.view.canSkip).toBe(false);
    session = dispatch(session, { type: "skip" }, at("s1", 6));
    expect(session.view.currentId).toBe("chop-1");
    expect(session.view.replayNonce).toBe(1);
    session = dispatch(session, { type: "trackEnded", trackId: "chop-1" }, at("s1", 7));
    expect(session.view.currentId).toBe("chop-1");
    expect(session.view.replayNonce).toBe(2);
  });
});

describe("modeAdvanced", () => {
  it("cycles orchestral, piano, and Chopin, then wraps", () => {
    let session = entered("s1", 0);
    session = dispatch(session, { type: "modeAdvanced" }, ctx("s1", 5));
    expect(session.view.currentId).toBe("p-calm");
    expect(session.view.style).toBe("piano");
    session = dispatch(session, { type: "modeAdvanced" }, ctx("s1", 6));
    expect(session.view.currentId).toBe("chop-1");
    expect(session.view.playlistOn).toBe(true);
    session = dispatch(session, { type: "modeAdvanced" }, ctx("s1", 7));
    expect(session.view.currentId).toBe("o-calm-a");
    expect(session.view.playlistOn).toBe(false);
    expect(session.view.style).toBe("orchestral");
  });

  it("leaves the playlist for a style in one switch with one fade", () => {
    let session = entered("s1", 0);
    session = dispatch(session, { type: "modeAdvanced", to: CHOPIN_PLAYLIST_ID }, ctx("s1", 5));
    expect(session.view.currentId).toBe("chop-1");
    session = dispatch(session, { type: "modeAdvanced", to: "orchestral" }, ctx("s1", 6));
    expect(session.view.currentId).toBe("o-calm-a");
    expect(session.view.playlistOn).toBe(false);
    expect(session.view.style).toBe("orchestral");
    expect(session.view.fadeSec).toBe(MUSIC_CONFIG.crossfadeSec);
  });

  it("runs a two-state cycle without a Chopin playlist", () => {
    const bare: MusicManifest = { ...manifest, playlists: [] };
    const at = (route: string | null, nowSec: number): SessionContext => ({
      manifest: bare,
      signalOf: (id) => signals[id] ?? null,
      routeSceneId: route,
      nowSec,
      rng: () => 0,
    });
    let session = dispatch(startSession(bare, null), { type: "sceneEntered", sceneId: "s1" }, at("s1", 0));
    session = dispatch(session, { type: "modeAdvanced" }, at("s1", 5));
    expect(session.view.currentId).toBe("p-calm");
    session = dispatch(session, { type: "modeAdvanced" }, at("s1", 6));
    expect(session.view.currentId).toBe("o-calm-a");
  });

  it("jumps straight to a given mode", () => {
    let session = entered("s1", 0);
    session = dispatch(session, { type: "modeAdvanced", to: CHOPIN_PLAYLIST_ID }, ctx("s1", 5));
    expect(session.view.playlistOn).toBe(true);
    session = dispatch(session, { type: "modeAdvanced", to: "piano" }, ctx("s1", 6));
    expect(session.view.currentId).toBe("p-calm");
    expect(session.view.playlistOn).toBe(false);
  });

  it("pressing Chopin while on Chopin exits to the stored style", () => {
    let session = startSession(manifest, {
      style: "piano",
      volume: null,
      muted: false,
      playlist: true,
    });
    expect(session.view.playlistOn).toBe(true);
    session = dispatch(session, { type: "modeAdvanced", to: CHOPIN_PLAYLIST_ID }, ctx("s1", 5));
    expect(session.view.playlistOn).toBe(false);
    expect(session.selection.style).toBe("piano");
    expect(session.view.style).toBe("piano");
    expect(session.view.currentId).toBe("p-calm");
    expect(session.view.fadeSec).toBe(MUSIC_CONFIG.crossfadeSec);
  });

  it("leaves the playlist for a style even with a null route", () => {
    let session = entered("s1", 0);
    session = dispatch(session, { type: "modeAdvanced", to: CHOPIN_PLAYLIST_ID }, ctx("s1", 5));
    expect(session.view.playlistOn).toBe(true);
    session = dispatch(session, { type: "modeAdvanced", to: "piano" }, ctx(null, 6));
    expect(session.view.playlistOn).toBe(false);
    expect(session.view.style).toBe("piano");
    expect(session.view.currentId).toBe("p-calm");
  });

  it("ignores unknown targets, the current mode, and a missing route", () => {
    const session = entered("s1", 0);
    expect(dispatch(session, { type: "modeAdvanced", to: "koto" }, ctx("s1", 5))).toBe(session);
    expect(dispatch(session, { type: "modeAdvanced", to: "orchestral" }, ctx("s1", 5))).toBe(
      session,
    );
    expect(dispatch(session, { type: "modeAdvanced" }, ctx(null, 5))).toBe(session);
  });
});

describe("single-track manifest", () => {
  it("skip is a no-op and canSkip stays false", () => {
    const solo: MusicManifest = {
      version: 3,
      styles: [{ id: "orchestral", name: "Orquesta" }],
      soundtracks: [{ id: "orch", name: "Orch", style: "orchestral" }],
      playlists: [],
      tracks: [track("only", "calma", "orch", "orchestral")],
    };
    const at = (route: string | null, nowSec: number): SessionContext => ({
      manifest: solo,
      signalOf: (id) => signals[id] ?? null,
      routeSceneId: route,
      nowSec,
      rng: () => 0,
    });
    const session = dispatch(startSession(solo, null), { type: "sceneEntered", sceneId: "s1" }, at("s1", 0));
    expect(session.view.currentId).toBe("only");
    expect(session.view.canSkip).toBe(false);
    expect(session.view.canPrev).toBe(true);
    expect(dispatch(session, { type: "skip" }, at("s1", 5))).toBe(session);
  });
});
