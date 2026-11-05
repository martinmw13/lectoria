// Music session: the single policy owner behind the reader. Pure and
// React-free: no timers, no Date.now, no Math.random, no storage. The
// reader builds the context (clock, rng, scene signals) and bridges the
// view to React state. The player stays the mechanism that performs
// crossfades; this module decides them.
import { MUSIC_CONFIG, dominantEmotion, nextTrack, resolveInitialSelection } from "./music";
import type {
  MusicManifest,
  MusicSelection,
  PersistedMusicPrefs,
  Rng,
  SceneSignal,
} from "./music";
import {
  enterPlaylist,
  exitPlaylist,
  initScheduler,
  noteTrackEnded,
  observeScene,
  requestManualTrack,
  requestNext,
  switchStyle,
  tickScheduler,
} from "./music-schedule";
import type { ScheduleDecision, SchedulerState } from "./music-schedule";
import { currentMode, findChopinPlaylist, musicModes, nextMode } from "./music-modes";
import type { MusicModeId } from "./music-modes";
export { findChopinPlaylist } from "./music-modes";
import { popHistory, pushHistory } from "./music-history";

export interface MusicSession {
  scheduler: SchedulerState;
  history: string[];
  selection: MusicSelection;
  fadeSec: number;
  replayNonce: number;
  view: SessionView;
}

export interface SessionView {
  currentId: string | null;
  fadeSec: number;
  replayNonce: number;
  canPrev: boolean;
  canSkip: boolean;
  playlistOn: boolean;
  style: string | null;
}

export interface SessionContext {
  manifest: MusicManifest;
  signalOf: (sceneId: string) => SceneSignal | null;
  routeSceneId: string | null;
  nowSec: number;
  rng: Rng;
  // The last track that started playing, kept out of the first-track
  // draw when other candidates exist. Absent means no exclusion.
  excludeTrackId?: string | null;
}

export type MusicIntent =
  | { type: "sceneEntered"; sceneId: string }
  | { type: "tick" }
  | { type: "skip" }
  | { type: "previous" }
  | { type: "styleChanged"; style: string }
  | { type: "trackEnded"; trackId: string }
  | { type: "playlistToggled" }
  | { type: "modeAdvanced"; to?: MusicModeId };

// Route entries use the short dwell; the draw and the holds are unchanged.
const ENTRY_DWELL = { dwellSec: MUSIC_CONFIG.sceneEntryDwellSec };

export function startSession(
  manifest: MusicManifest,
  prefs: PersistedMusicPrefs | null,
  rng: Rng = () => 0,
): MusicSession {
  const fields = {
    scheduler: initScheduler(),
    history: [] as string[],
    selection: resolveInitialSelection(manifest, prefs),
    fadeSec: 0,
    replayNonce: 0,
  };
  // A stored Chopin mode starts in the playlist at once (fade 0, like the
  // first scene entry), at a random index; without the playlist the
  // stored style stands.
  if (prefs?.playlist === true) {
    const playlist = findChopinPlaylist(manifest);
    if (playlist) {
      const decision = enterPlaylist(
        fields.scheduler,
        manifest,
        playlist.id,
        0,
        undefined,
        rng,
        prefs.lastTrackId ?? null,
      );
      const entered = foldSwitch(fields, decision, false);
      return { ...entered, view: buildView(entered, manifest, null, entered.selection) };
    }
  }
  return {
    ...fields,
    view: buildView(fields, manifest, null, fields.selection),
  };
}

function sameScheduler(a: SchedulerState, b: SchedulerState): boolean {
  return (
    a.currentId === b.currentId &&
    a.currentStartedSec === b.currentStartedSec &&
    a.activeSceneId === b.activeSceneId &&
    a.pendingSceneId === b.pendingSceneId &&
    a.pendingSinceSec === b.pendingSinceSec &&
    a.overrideId === b.overrideId &&
    a.overrideSceneId === b.overrideSceneId &&
    (a.playlist === null || b.playlist === null
      ? a.playlist === b.playlist
      : a.playlist.id === b.playlist.id && a.playlist.index === b.playlist.index)
  );
}

function viewEqual(a: SessionView, b: SessionView): boolean {
  return (
    a.currentId === b.currentId &&
    a.fadeSec === b.fadeSec &&
    a.replayNonce === b.replayNonce &&
    a.canPrev === b.canPrev &&
    a.canSkip === b.canSkip &&
    a.playlistOn === b.playlistOn &&
    a.style === b.style
  );
}

function buildView(
  fields: Omit<MusicSession, "view">,
  manifest: MusicManifest,
  routeSignal: SceneSignal | null,
  selection: MusicSelection,
): SessionView {
  const currentId = fields.scheduler.currentId;
  const playlistOn = fields.scheduler.playlist !== null;
  const canSkip = playlistOn
    ? (findChopinPlaylist(manifest)?.trackIds.length ?? 0) > 1
    : manifest.tracks.length > 1 &&
      nextTrack(routeSignal, manifest, currentId, undefined, selection) !== null;
  return {
    currentId,
    fadeSec: fields.fadeSec,
    replayNonce: fields.replayNonce,
    canPrev: currentId !== null,
    canSkip,
    playlistOn,
    style: selection.style,
  };
}

function routeSignalOf(ctx: SessionContext): SceneSignal | null {
  return ctx.routeSceneId !== null ? ctx.signalOf(ctx.routeSceneId) : null;
}

// Rebuild the session after a handler ran, reusing the session and the
// view objects when nothing changed so the reader's 1 s tick rerenders
// nothing.
function settle(session: MusicSession, fields: Omit<MusicSession, "view">, ctx: SessionContext): MusicSession {
  const view = buildView(fields, ctx.manifest, routeSignalOf(ctx), fields.selection);
  if (
    sameScheduler(session.scheduler, fields.scheduler) &&
    session.history === fields.history &&
    session.selection === fields.selection &&
    session.fadeSec === fields.fadeSec &&
    session.replayNonce === fields.replayNonce &&
    viewEqual(session.view, view)
  ) {
    return session;
  }
  return { ...fields, view: viewEqual(session.view, view) ? session.view : view };
}

// Fold a scheduler decision into the session: fade on every switch, a
// replay nonce bump on a same-id wrap, and the outgoing id banked for
// Previous on every automatic switch. Previous passes push false so it
// never re-banks.
function foldSwitch(
  base: Omit<MusicSession, "view">,
  decision: ScheduleDecision,
  push: boolean,
): Omit<MusicSession, "view"> {
  const prevId = base.scheduler.currentId;
  if (decision.switchToId === null) return { ...base, scheduler: decision.state };
  if (decision.switchToId === prevId) {
    return {
      ...base,
      scheduler: decision.state,
      fadeSec: decision.crossfadeSec,
      replayNonce: base.replayNonce + 1,
    };
  }
  return {
    ...base,
    scheduler: decision.state,
    history: push && prevId !== null ? pushHistory(base.history, prevId) : base.history,
    fadeSec: decision.crossfadeSec,
  };
}

function baseOf(session: MusicSession): Omit<MusicSession, "view"> {
  return {
    scheduler: session.scheduler,
    history: session.history,
    selection: session.selection,
    fadeSec: session.fadeSec,
    replayNonce: session.replayNonce,
  };
}

function selectEnv(session: MusicSession, ctx: SessionContext) {
  return {
    selection: session.selection,
    rng: ctx.rng,
    excludeTrackId: ctx.excludeTrackId ?? null,
  };
}

// One transition path for every music mode intent. The target says where
// to go: a style (switch under it), the playlist (enter it), or out of
// the playlist (exit under the stored selection for null, or under the
// target selection for a style). The transition owns the signal, the
// scheduler decision, the fold, the selection update and the settle;
// each intent only maps to a target, plus its own guards that differ by
// design (route-null and same-value checks live with the intent).
type ModeTarget =
  | { kind: "style"; style: string }
  | { kind: "enterPlaylist"; playlistId: string }
  | { kind: "exitPlaylist"; style: string | null };

function transition(session: MusicSession, ctx: SessionContext, to: ModeTarget): MusicSession {
  const signal = ctx.routeSceneId !== null ? ctx.signalOf(ctx.routeSceneId) : null;
  if (to.kind === "enterPlaylist") {
    const decision = enterPlaylist(
      session.scheduler,
      ctx.manifest,
      to.playlistId,
      ctx.nowSec,
      undefined,
      ctx.rng,
      ctx.excludeTrackId ?? null,
    );
    return settle(session, foldSwitch(baseOf(session), decision, true), ctx);
  }
  if (to.kind === "exitPlaylist") {
    const decision = exitPlaylist(
      session.scheduler,
      signal,
      ctx.manifest,
      ctx.nowSec,
      to.style === null ? selectEnv(session, ctx) : { selection: { style: to.style }, rng: ctx.rng },
    );
    const fields = foldSwitch(baseOf(session), decision, true);
    return settle(session, to.style === null ? fields : { ...fields, selection: { style: to.style } }, ctx);
  }
  const decision = switchStyle(session.scheduler, signal, ctx.manifest, ctx.nowSec, to.style);
  if (decision.switchToId === null) return session;
  const fields = foldSwitch(baseOf(session), decision, true);
  return settle(session, { ...fields, selection: { style: to.style } }, ctx);
}

export function dispatch(session: MusicSession, intent: MusicIntent, ctx: SessionContext): MusicSession {
  switch (intent.type) {
    case "sceneEntered": {
      const signal = ctx.signalOf(intent.sceneId);
      // A new dominant emotion (suspense → combat on Lion Ambush) skips
      // the entry dwell so a short scene still gets its track before the
      // reader scrolls past. Same-emotion lands keep the short dwell so
      // a fast scroll does not flap.
      const current = ctx.manifest.tracks.find((t) => t.id === session.scheduler.currentId);
      const strongMood =
        signal !== null &&
        current !== undefined &&
        dominantEmotion(signal) !== current.emotion;
      const decision = observeScene(
        session.scheduler,
        intent.sceneId,
        signal,
        ctx.manifest,
        ctx.nowSec,
        selectEnv(session, ctx),
        strongMood ? { dwellSec: 0 } : ENTRY_DWELL,
      );
      return settle(session, foldSwitch(baseOf(session), decision, true), ctx);
    }
    case "tick": {
      if (ctx.routeSceneId === null) return session;
      const sceneId = session.scheduler.pendingSceneId ?? ctx.routeSceneId;
      const decision = tickScheduler(
        session.scheduler,
        ctx.signalOf(sceneId),
        ctx.manifest,
        ctx.nowSec,
        selectEnv(session, ctx),
        ENTRY_DWELL,
      );
      return settle(session, foldSwitch(baseOf(session), decision, true), ctx);
    }
    case "skip": {
      if (ctx.routeSceneId === null) return session;
      const decision = requestNext(
        session.scheduler,
        ctx.signalOf(ctx.routeSceneId),
        ctx.manifest,
        ctx.nowSec,
        selectEnv(session, ctx),
      );
      return settle(session, foldSwitch(baseOf(session), decision, true), ctx);
    }
    case "previous": {
      if (session.scheduler.playlist !== null) {
        return settle(session, { ...baseOf(session), replayNonce: session.replayNonce + 1 }, ctx);
      }
      const popped = popHistory(session.history);
      if (!popped) {
        return settle(session, { ...baseOf(session), replayNonce: session.replayNonce + 1 }, ctx);
      }
      const base = { ...baseOf(session), history: popped.hist };
      // Audible scope, not style scope: Previous may return to a track
      // from before a style change, as it always could.
      const decision = requestManualTrack(session.scheduler, ctx.manifest, popped.id, ctx.nowSec);
      return settle(session, foldSwitch(base, decision, false), ctx);
    }
    case "styleChanged": {
      if (ctx.routeSceneId === null) return session;
      if (session.scheduler.playlist !== null) return session;
      if (intent.style === session.selection.style) return session;
      return transition(session, ctx, { kind: "style", style: intent.style });
    }
    case "trackEnded": {
      if (ctx.routeSceneId === null) return session;
      const decision = noteTrackEnded(
        session.scheduler,
        ctx.signalOf(ctx.routeSceneId),
        ctx.manifest,
        intent.trackId,
        ctx.nowSec,
        selectEnv(session, ctx),
      );
      return settle(session, foldSwitch(baseOf(session), decision, true), ctx);
    }
    case "playlistToggled": {
      const playlist = findChopinPlaylist(ctx.manifest);
      if (!playlist) return session;
      return session.scheduler.playlist !== null
        ? transition(session, ctx, { kind: "exitPlaylist", style: null })
        : transition(session, ctx, { kind: "enterPlaylist", playlistId: playlist.id });
    }
    case "modeAdvanced": {
      const modes = musicModes(ctx.manifest);
      const target = intent.to ?? nextMode(modes, currentMode(session.view));
      if (target === null || !modes.some((m) => m.id === target)) return session;
      const playlist = findChopinPlaylist(ctx.manifest);
      // Chopin pressed while on Chopin exits to the stored selection,
      // exactly like playlistToggled exiting.
      if (playlist !== null && target === playlist.id && session.scheduler.playlist !== null) {
        return transition(session, ctx, { kind: "exitPlaylist", style: null });
      }
      if (target === currentMode(session.view)) return session;
      if (playlist !== null && target === playlist.id) {
        return transition(session, ctx, { kind: "enterPlaylist", playlistId: playlist.id });
      }
      // Leaving the playlist switches straight to the target style: one
      // exit under the target selection, one switch, one crossfade. A
      // sticker press is an explicit choice, so this acts even with a null route.
      if (session.scheduler.playlist !== null) {
        return transition(session, ctx, { kind: "exitPlaylist", style: target });
      }
      if (ctx.routeSceneId === null) return session;
      if (target === session.selection.style) return session;
      return transition(session, ctx, { kind: "style", style: target });
    }
    default: {
      const _exhaustive: never = intent;
      throw new Error(`unknown music intent: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
