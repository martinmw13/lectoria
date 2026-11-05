import { describe, expect, it } from "vitest";
import { MUSIC_CONFIG, CHOPIN_PLAYLIST_ID } from "./music";
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

function track(id: string, top: string, st: string, style: string, only = false): Track {
  return {
    id, src: `/music/${id}.mp3`, title: id, playlistOnly: only,
    emotion: top as Track["emotion"], vector: vec(top),
    intensity: 0.5, tempo: 0.5, durationSec: 120, startSec: 0,
    gainDb: 0, loop: true, soundtrack: st, style,
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
    track("p-calm", "calma", "piano-s", "piano"),
    track("chop-1", "calma", "chop-s", "orchestral", true),
    track("chop-2", "calma", "chop-s", "orchestral", true),
  ],
};

const signals: Record<string, SceneSignal> = {
  s1: { vector: vec("calma"), intensity: 0.5, tempo: 0.5 },
};

function cx(m: MusicManifest, route: string | null, now: number): SessionContext {
  return { manifest: m, signalOf: (id) => signals[id] ?? null, routeSceneId: route, nowSec: now, rng: () => 0 };
}

function entered(): ReturnType<typeof startSession> {
  return dispatch(startSession(manifest, null), { type: "sceneEntered", sceneId: "s1" }, cx(manifest, "s1", 0));
}

function playlistOn() {
  return dispatch(entered(), { type: "modeAdvanced", to: CHOPIN_PLAYLIST_ID }, cx(manifest, "s1", 5));
}

describe("mode intent drift (pins current behavior)", () => {
  it("route null: styleChanged no-ops but playlistToggled still acts", () => {
    const plain = entered();
    expect(dispatch(plain, { type: "styleChanged", style: "piano" }, cx(manifest, null, 6))).toBe(plain);
    const inPl = dispatch(plain, { type: "playlistToggled" }, cx(manifest, null, 6));
    expect(inPl.view.playlistOn).toBe(true);
    expect(inPl.view.currentId).toBe("chop-1");
    const out = dispatch(inPl, { type: "playlistToggled" }, cx(manifest, null, 7));
    expect(out.view.playlistOn).toBe(false);
    expect(out.view.currentId).toBe("o-calm-a");
  });

  it("route null: modeAdvanced to a style acts only while the playlist is on", () => {
    const plain = entered();
    expect(dispatch(plain, { type: "modeAdvanced", to: "piano" }, cx(manifest, null, 6))).toBe(plain);
    const left = dispatch(playlistOn(), { type: "modeAdvanced", to: "piano" }, cx(manifest, null, 6));
    expect(left.view.playlistOn).toBe(false);
    expect(left.selection).toEqual({ style: "piano" });
    expect(left.view.currentId).toBe("p-calm");
  });

  it("route null: modeAdvanced to Chopin enters off-playlist, exits on-playlist", () => {
    const plain = entered();
    expect(dispatch(plain, { type: "modeAdvanced", to: CHOPIN_PLAYLIST_ID }, cx(manifest, null, 6)).view.playlistOn).toBe(true);
    const out = dispatch(playlistOn(), { type: "modeAdvanced", to: CHOPIN_PLAYLIST_ID }, cx(manifest, null, 6));
    expect(out.view.playlistOn).toBe(false);
    expect(out.selection).toEqual({ style: "orchestral" });
  });

  it("styleChanged on-playlist no-ops; modeAdvanced to a style exits in one switch", () => {
    const on = playlistOn();
    expect(dispatch(on, { type: "styleChanged", style: "piano" }, cx(manifest, "s1", 6))).toBe(on);
    const left = dispatch(on, { type: "modeAdvanced", to: "piano" }, cx(manifest, "s1", 6));
    expect(left.view.playlistOn).toBe(false);
    expect(left.selection).toEqual({ style: "piano" });
    expect(left.view.currentId).toBe("p-calm");
    expect(left.view.fadeSec).toBe(MUSIC_CONFIG.crossfadeSec);
  });

  it("same style and same mode are no-ops", () => {
    const plain = entered();
    expect(dispatch(plain, { type: "styleChanged", style: "orchestral" }, cx(manifest, "s1", 5))).toBe(plain);
    expect(dispatch(plain, { type: "modeAdvanced", to: "orchestral" }, cx(manifest, "s1", 5))).toBe(plain);
  });

  it("unknown or track-less styles change nothing either way", () => {
    const plain = entered();
    expect(dispatch(plain, { type: "styleChanged", style: "koto" }, cx(manifest, "s1", 5))).toBe(plain);
    expect(dispatch(plain, { type: "modeAdvanced", to: "koto" }, cx(manifest, "s1", 5))).toBe(plain);
    const empty: MusicManifest = { ...manifest, styles: [...manifest.styles, { id: "koto", name: "Koto" }] };
    const sess = dispatch(startSession(empty, null), { type: "sceneEntered", sceneId: "s1" }, cx(empty, "s1", 0));
    expect(dispatch(sess, { type: "styleChanged", style: "koto" }, cx(empty, "s1", 5))).toBe(sess);
    expect(dispatch(sess, { type: "modeAdvanced", to: "koto" }, cx(empty, "s1", 5))).toBe(sess);
  });

  it("Chopin on Chopin matches playlistToggled exiting", () => {
    const base = startSession(manifest, { style: "piano", volume: null, muted: false, playlist: true });
    const viaToggle = dispatch(base, { type: "playlistToggled" }, cx(manifest, "s1", 5));
    const viaMode = dispatch(base, { type: "modeAdvanced", to: CHOPIN_PLAYLIST_ID }, cx(manifest, "s1", 5));
    expect(viaMode.view).toEqual(viaToggle.view);
    expect(viaMode.selection).toEqual(viaToggle.selection);
    expect(viaMode.view.fadeSec).toBe(MUSIC_CONFIG.crossfadeSec);
  });

  it("entering matches between playlistToggled and modeAdvanced", () => {
    const plain = entered();
    const viaToggle = dispatch(plain, { type: "playlistToggled" }, cx(manifest, "s1", 5));
    const viaMode = dispatch(plain, { type: "modeAdvanced", to: CHOPIN_PLAYLIST_ID }, cx(manifest, "s1", 5));
    expect(viaMode.view).toEqual(viaToggle.view);
    expect(viaMode.scheduler).toEqual(viaToggle.scheduler);
  });

  it("without Chopin, toggling no-ops and modes cycle two states", () => {
    const bare: MusicManifest = { ...manifest, playlists: [] };
    const sess = dispatch(startSession(bare, null), { type: "sceneEntered", sceneId: "s1" }, cx(bare, "s1", 0));
    expect(dispatch(sess, { type: "playlistToggled" }, cx(bare, "s1", 5))).toBe(sess);
    const toPiano = dispatch(sess, { type: "modeAdvanced" }, cx(bare, "s1", 5));
    expect(toPiano.view.style).toBe("piano");
    expect(dispatch(toPiano, { type: "modeAdvanced" }, cx(bare, "s1", 6)).view.style).toBe("orchestral");
  });
});
