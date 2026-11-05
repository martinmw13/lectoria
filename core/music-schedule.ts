// Pure music scheduler. The reader calls it with explicit nowSec values,
// so dwell and the min-track hold are testable without timers.
import {
  MUSIC_CONFIG,
  bestRanked,
  candidatesFor,
  nextTrack,
  requestStyleChange,
  resolveConfig,
  selectScheduled,
  shuffleSameEmotion,
} from "./music";
import type {
  MusicConfig,
  MusicManifest,
  MusicSelection,
  Rng,
  SceneSignal,
  SelectEnv,
} from "./music";

export interface SchedulerState {
  currentId: string | null;
  currentStartedSec: number;
  activeSceneId: string | null;
  pendingSceneId: string | null;
  pendingSinceSec: number;
  overrideId: string | null;
  overrideSceneId: string | null;
  playlist: { id: string; index: number } | null;
}

export interface ScheduleDecision {
  state: SchedulerState;
  switchToId: string | null;
  crossfadeSec: number;
}

export function initScheduler(): SchedulerState {
  return {
    currentId: null,
    currentStartedSec: 0,
    activeSceneId: null,
    pendingSceneId: null,
    pendingSinceSec: 0,
    overrideId: null,
    overrideSceneId: null,
    playlist: null,
  };
}

function noChange(state: SchedulerState): ScheduleDecision {
  return { state, switchToId: null, crossfadeSec: 0 };
}

// Scheduled select: the one draw from the selection module keeps the
// current track when it is eligible, so rescans do not churn. Dwell is
// handled by promotion; the draw itself holds the min-track pick.
function evaluateSwitch(
  state: SchedulerState,
  signal: SceneSignal | null,
  manifest: MusicManifest,
  nowSec: number,
  config: MusicConfig,
  env: SelectEnv,
): ScheduleDecision {
  if (signal === null) return noChange(state);
  if (state.playlist !== null) return noChange(state);
  const styleTracks = candidatesFor(env.selection, manifest);
  if (styleTracks.length === 0) return noChange(state);
  const pick = selectScheduled({
    cands: styleTracks,
    scene: signal,
    currentId: state.currentId,
    currentStartedSec: state.currentStartedSec,
    nowSec,
    rng: env.rng,
    override: config,
    excludeId: env.excludeTrackId ?? null,
  });
  if (!pick || pick.id === state.currentId) return noChange(state);
  return {
    state: { ...state, currentId: pick.id, currentStartedSec: nowSec },
    switchToId: pick.id,
    crossfadeSec: state.currentId === null ? 0 : config.crossfadeSec,
  };
}

function promote(
  state: SchedulerState,
  sceneId: string,
  signal: SceneSignal | null,
  manifest: MusicManifest,
  nowSec: number,
  config: MusicConfig,
  env: SelectEnv,
): ScheduleDecision {
  const settled: SchedulerState = {
    ...state,
    activeSceneId: sceneId,
    pendingSceneId: null,
    pendingSinceSec: 0,
    overrideId: null,
    overrideSceneId: null,
  };
  // A scene change is allowed to cut a track that has not yet hit
  // minTrackSec. That hold only applies when tick re-checks the same
  // active scene; without this bypass, a fresh track could sit for the
  // full min-track window after every scene entry and never adapt.
  const decision = evaluateSwitch(
    settled,
    signal,
    manifest,
    nowSec,
    { ...config, minTrackSec: 0 },
    env,
  );
  return { ...decision, state: { ...decision.state, activeSceneId: sceneId } };
}

// The reading position entered a scene. It becomes pending and the dwell
// clock restarts, so fast scrolling keeps only the newest scene. After
// the pending scene holds for dwellSec it becomes active. The first
// track ever plays at once, with no dwell.
export function observeScene(
  state: SchedulerState,
  sceneId: string,
  signal: SceneSignal | null,
  manifest: MusicManifest,
  nowSec: number,
  env: SelectEnv,
  override?: Partial<MusicConfig>,
): ScheduleDecision {
  const config = resolveConfig(override ?? MUSIC_CONFIG);
  if (state.currentId === null) {
    return promote(state, sceneId, signal, manifest, nowSec, config, env);
  }
  if (sceneId === state.activeSceneId) {
    return noChange({ ...state, pendingSceneId: null, pendingSinceSec: 0 });
  }
  if (sceneId !== state.pendingSceneId) {
    const pending = { ...state, pendingSceneId: sceneId, pendingSinceSec: nowSec };
    // dwellSec 0 (strong mood change / chapter jump): promote on the
    // same observe so a short combat scene is not scrolled past first.
    if (config.dwellSec <= 0) {
      return promote(pending, sceneId, signal, manifest, nowSec, config, env);
    }
    return noChange(pending);
  }
  if (nowSec - state.pendingSinceSec < config.dwellSec) return noChange(state);
  return promote(state, sceneId, signal, manifest, nowSec, config, env);
}

// Time passed: settle a pending scene whose dwell has expired, or
// re-check the active scene (a hold from minTrackSec may have expired).
// The reader passes the pending signal when one exists, else the active.
export function tickScheduler(
  state: SchedulerState,
  signal: SceneSignal | null,
  manifest: MusicManifest,
  nowSec: number,
  env: SelectEnv,
  override?: Partial<MusicConfig>,
): ScheduleDecision {
  const config = resolveConfig(override ?? MUSIC_CONFIG);
  if (state.currentId === null) return noChange(state);
  if (state.pendingSceneId !== null) {
    if (nowSec - state.pendingSinceSec < config.dwellSec) return noChange(state);
    return promote(state, state.pendingSceneId, signal, manifest, nowSec, config, env);
  }
  // A skip override holds until the next scene change; promotion clears it.
  if (state.overrideId !== null) return noChange(state);
  if (state.activeSceneId === null) return noChange(state);
  return evaluateSwitch(state, signal, manifest, nowSec, config, env);
}

// Reader skip: the same-emotion Next rule, applied at once with the
// normal crossfade. The choice holds until the next scene change.
export function requestNext(
  state: SchedulerState,
  signal: SceneSignal | null,
  manifest: MusicManifest,
  nowSec: number,
  env: SelectEnv,
  override?: Partial<MusicConfig>,
): ScheduleDecision {
  const config = resolveConfig(override ?? MUSIC_CONFIG);
  if (state.playlist !== null) return advancePlaylist(state, manifest, nowSec, config);
  const next = nextTrack(signal, manifest, state.currentId, config, env.selection);
  if (!next) return noChange(state);
  return {
    state: {
      ...state,
      currentId: next.id,
      currentStartedSec: nowSec,
      overrideId: next.id,
      overrideSceneId: state.activeSceneId,
    },
    switchToId: next.id,
    crossfadeSec: config.crossfadeSec,
  };
}

// Manual pick from Previous: the track holds like a Next until the next
// scene change. Only tracks in the candidatesFor scope play, so a
// playlist-only id changes nothing. Unknown ids change nothing.
export function requestManualTrack(
  state: SchedulerState,
  manifest: MusicManifest,
  trackId: string,
  nowSec: number,
  selection?: MusicSelection | null,
  override?: Partial<MusicConfig>,
): ScheduleDecision {
  const config = resolveConfig(override ?? MUSIC_CONFIG);
  if (state.playlist !== null) return noChange(state);
  const scope = candidatesFor(selection ?? { style: null }, manifest);
  const picked = scope.find((t) => t.id === trackId) ?? null;
  if (!picked) return noChange(state);
  return {
    state: {
      ...state,
      currentId: picked.id,
      currentStartedSec: nowSec,
      overrideId: picked.id,
      overrideSceneId: state.activeSceneId,
    },
    switchToId: picked.id,
    crossfadeSec: config.crossfadeSec,
  };
}

// A non-looping track ended: fade into a random other track with the
// scene's emotion, or, when there is none, the best remaining track;
// never the one that just ended. Never crosses styles.
export function noteTrackEnded(
  state: SchedulerState,
  signal: SceneSignal | null,
  manifest: MusicManifest,
  endedId: string,
  nowSec: number,
  env: SelectEnv,
  override?: Partial<MusicConfig>,
): ScheduleDecision {
  const config = resolveConfig(override ?? MUSIC_CONFIG);
  if (state.playlist !== null) return advancePlaylist(state, manifest, nowSec, config);
  const styleTracks = candidatesFor(env.selection, manifest);
  if (styleTracks.length === 0) return noChange(state);
  const best =
    shuffleSameEmotion(signal, styleTracks, env.rng, endedId) ??
    bestRanked(signal, styleTracks, endedId, config);
  if (!best) return noChange(state);
  return {
    state: {
      ...state,
      currentId: best.id,
      currentStartedSec: nowSec,
      overrideId: null,
      overrideSceneId: null,
    },
    switchToId: best.id,
    crossfadeSec: config.crossfadeSec,
  };
}

// Fixed playlist mode (the Chopin easter egg). Playlist order lives here
// because it reuses SchedulerState and the crossfade config.
function playlistById(manifest: MusicManifest, id: string) {
  return manifest.playlists.find((p) => p.id === id) ?? null;
}

// Enter playlist mode: switch at once to a random playlist track, with
// no dwell and no min-track rule. Scene changes stay tracked but never
// switch. The draw skips the excluded id when others exist; the index
// stored is into trackIds, so Next keeps order and wraps as before.
export function enterPlaylist(
  state: SchedulerState,
  manifest: MusicManifest,
  playlistId: string,
  nowSec: number,
  override?: Partial<MusicConfig>,
  rng: Rng = () => 0,
  excludeId?: string | null,
): ScheduleDecision {
  const config = resolveConfig(override ?? MUSIC_CONFIG);
  const playlist = playlistById(manifest, playlistId);
  if (!playlist || playlist.trackIds.length === 0) return noChange(state);
  const ids =
    excludeId !== null &&
    excludeId !== undefined &&
    playlist.trackIds.length > 1
      ? (playlist.trackIds.filter((id) => id !== excludeId) as string[])
      : playlist.trackIds;
  const list = ids.length > 0 ? ids : playlist.trackIds;
  const pickedId = list[Math.floor(rng() * list.length) % list.length] as string;
  const first = manifest.tracks.find((t) => t.id === pickedId) ?? null;
  if (!first) return noChange(state);
  return {
    state: {
      ...state,
      currentId: first.id,
      currentStartedSec: nowSec,
      overrideId: null,
      overrideSceneId: null,
      playlist: { id: playlist.id, index: playlist.trackIds.indexOf(first.id) },
    },
    switchToId: first.id,
    crossfadeSec: state.currentId === null ? 0 : config.crossfadeSec,
  };
}

// Next playlist track in trackIds order, wrapping last to first. Used by
// both the end-of-track path and the Next button while the playlist is on.
function advancePlaylist(
  state: SchedulerState,
  manifest: MusicManifest,
  nowSec: number,
  config: MusicConfig,
): ScheduleDecision {
  if (state.playlist === null) return noChange(state);
  const playlist = playlistById(manifest, state.playlist.id);
  if (!playlist || playlist.trackIds.length === 0) return noChange(state);
  // A one-track playlist wraps onto the same id. That still returns a
  // switch so the ended element re-cues instead of going quiet.
  const nextIndex = (state.playlist.index + 1) % playlist.trackIds.length;
  const nextId = playlist.trackIds[nextIndex];
  if (nextId === undefined) return noChange(state);
  const next = manifest.tracks.find((t) => t.id === nextId) ?? null;
  if (!next) return noChange(state);
  return {
    state: {
      ...state,
      currentId: next.id,
      currentStartedSec: nowSec,
      overrideId: null,
      overrideSceneId: null,
      playlist: { id: playlist.id, index: nextIndex },
    },
    switchToId: next.id,
    crossfadeSec: state.currentId === null ? 0 : config.crossfadeSec,
  };
}

// Leave playlist mode: clear the playlist state and switch at once to the
// best match for the current scene under the restored selection.
export function exitPlaylist(
  state: SchedulerState,
  signal: SceneSignal | null,
  manifest: MusicManifest,
  nowSec: number,
  env: SelectEnv,
  override?: Partial<MusicConfig>,
): ScheduleDecision {
  if (state.playlist === null) return noChange(state);
  const config = resolveConfig(override ?? MUSIC_CONFIG);
  const styleTracks = candidatesFor(env.selection, manifest);
  const cleared: SchedulerState = {
    ...state,
    overrideId: null,
    overrideSceneId: null,
    playlist: null,
  };
  const best = bestRanked(signal, styleTracks, null, config);
  if (!best) return { ...noChange(cleared), state: cleared };
  return {
    state: { ...cleared, currentId: best.id, currentStartedSec: nowSec },
    switchToId: best.id,
    crossfadeSec: state.currentId === null ? 0 : config.crossfadeSec,
  };
}

// Style change from user action: switches at once with the normal
// crossfade, no dwell and no min-track rule, and sets the override like
// Next.
export function switchStyle(
  state: SchedulerState,
  signal: SceneSignal | null,
  manifest: MusicManifest,
  nowSec: number,
  style: string,
  override?: Partial<MusicConfig>,
): ScheduleDecision {
  // modeAdvanced reaches here only when no playlist plays; the guard keeps a stray call a no-op.
  if (state.playlist !== null) return noChange(state);
  const config = resolveConfig(override ?? MUSIC_CONFIG);
  const picked = requestStyleChange(manifest, style, signal, config);
  if (!picked) return noChange(state);
  return {
    state: {
      ...state,
      currentId: picked.track.id,
      currentStartedSec: nowSec,
      overrideId: picked.track.id,
      overrideSceneId: state.activeSceneId,
    },
    switchToId: picked.track.id,
    crossfadeSec: config.crossfadeSec,
  };
}

export { MUSIC_CONFIG };
