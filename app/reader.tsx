"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { isSceneAttr, type SceneAttr } from "@/core/bookmap";
import { canPlayAudio } from "./ambience-engine";
import { choosePlayableSources, currentMode, musicModes, parseManifest } from "@/core/music";
import type { MusicManifest, MusicMode, MusicModeId, SceneSignal, Track } from "@/core/music";
import { hasNarration } from "@/core/book-capabilities";
import { EMOTIONS } from "@/core/types";
import { dispatch, startSession } from "@/core/music-session";
import type { MusicIntent, MusicSession, SessionView } from "@/core/music-session";
import { nextSceneEntry } from "@/core/reader";
import { requestGotoScene, useCurrentSceneId } from "./leer/current-scene";
import { DEFAULT_VOLUME, createMusicPrefsStore } from "./music-prefs";
import { NarrationProvider, useNarration } from "./narration/context";
import { ReadAloud } from "./narration/read-aloud";
import { ReadAloudSoon } from "./narration/read-aloud-soon";
import type { NarrationChapterEntry } from "./narration/types";
import { Player } from "./player";
import { ReaderChat } from "./chat/reader-chat";
import { THEME_KEY, TopLine } from "./folio/chrome";
import { initialTheme } from "./theme";
import { DevPanel } from "./folio/dev-panel";

export interface SlimScene {
  id: string;
  ch: number;
  startN: number;
  endN: number;
  emotion: SceneSignal | null;
}

export interface ChapterJump {
  ch: number;
  title: string;
  firstSceneId: string;
}

const DEV_LABELS: Record<(typeof EMOTIONS)[number], string> = {
  calma: "calm",
  alegria: "joy",
  tristeza: "sadness",
  suspenso: "suspense",
  misterio: "mystery",
  aventura: "adventure",
  combate: "combat",
  asombro: "wonder",
};

// Client container: bridges the music session to React state. It cues
// music on scene entry only, from the scene in view. Params can lag a
// render, so the last observed id is compared before every scene entry.
// Band contents run inside the narration provider so the music duck
// and the read-aloud control share the controller.
function BandPlay({
  narrationOn,
  musicFailed,
  empty,
  track,
  replayNonce,
  fadeSec,
  canPrev,
  onPrev,
  canSkip,
  onSkip,
  volume,
  muted,
  onVolumeChange,
  onMutedChange,
  modes,
  current,
  onAdvance,
  onEnded,
  playlistOn,
}: {
  narrationOn: boolean;
  musicFailed: boolean;
  empty: boolean;
  track: Track | null;
  replayNonce: number;
  fadeSec: number;
  canPrev: boolean;
  onPrev: () => void;
  canSkip: boolean;
  onSkip: () => void;
  volume: number;
  muted: boolean;
  onVolumeChange: (volume: number) => void;
  onMutedChange: (muted: boolean) => void;
  modes: MusicMode[];
  current: MusicModeId | null;
  onAdvance: (to?: MusicModeId) => void;
  onEnded: (trackId: string) => void;
  playlistOn: boolean;
}) {
  const { duck, ambienceDuck } = useNarration();
  return (
    <div className="band-play">
      {narrationOn ? <ReadAloud /> : <ReadAloudSoon />}
      {musicFailed || empty ? (
        <p className="player-note">The music is resting. The book is all yours.</p>
      ) : (
        <Player
          track={track}
          replayNonce={replayNonce}
          fadeSec={fadeSec}
          canPrev={canPrev}
          onPrev={onPrev}
          canSkip={canSkip}
          onSkip={onSkip}
          volume={volume}
          muted={muted}
          onVolumeChange={onVolumeChange}
          onMutedChange={onMutedChange}
          modes={modes}
          current={current}
          onAdvance={onAdvance}
          onEnded={onEnded}
          playlistOn={playlistOn}
          duck={duck}
          ambienceDuck={ambienceDuck}
        />
      )}
    </div>
  );
}

export function Reader({
  bookId,
  scenes,
  chapters,
  bookTitle,
  bookAuthor,
  narration,
  children,
}: {
  bookId: string;
  scenes: SlimScene[];
  chapters: ChapterJump[];
  bookTitle: string;
  bookAuthor: string;
  narration: NarrationChapterEntry[];
  children: React.ReactNode;
}) {
  const routeParams = useParams();
  const param = routeParams?.sceneId;
  // The reading column publishes the scene in view through replaceState
  // and the live store; App Router params may not follow replaceState,
  // so the store wins and the route id is only the first-load fallback.
  const routeSceneId = useCurrentSceneId() ?? (typeof param === "string" ? param : null);
  const [manifest, setManifest] = useState<MusicManifest | null>(null);
  const [view, setView] = useState<SessionView | null>(null);
  const [musicFailed, setMusicFailed] = useState(false);
  // Volume, mute, style, and Chopin mode persist in one prefs object;
  // the player stays a controlled view over them. State starts at the server
  // defaults so hydration matches, then a mount effect applies stored
  // prefs (parsed once) to volume, muted, and style via the prefs store.
  const [volume, setVolume] = useState(DEFAULT_VOLUME);
  const [muted, setMuted] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [devOpen, setDevOpen] = useState(false);
  const [sceneAttr, setSceneAttr] = useState<SceneAttr | null>(null);
  const prefsStoreRef = useRef(createMusicPrefsStore());
  // Ref mirrors so send and persist handlers always read fresh values.
  const volumeRef = useRef(volume);
  // eslint-disable-next-line react-hooks/refs -- latest-value mirror so music handlers read fresh state
  volumeRef.current = volume;
  const mutedRef = useRef(muted);
  // eslint-disable-next-line react-hooks/refs -- latest-value mirror so music handlers read fresh state
  mutedRef.current = muted;
  const byId = useMemo(() => new Map(scenes.map((s) => [s.id, s.emotion])), [scenes]);
  const byIdRef = useRef(byId);
  // eslint-disable-next-line react-hooks/refs -- latest-value mirror so music handlers read fresh state
  byIdRef.current = byId;
  const manifestRef = useRef(manifest);
  // eslint-disable-next-line react-hooks/refs -- latest-value mirror so music handlers read fresh state
  manifestRef.current = manifest;
  const routeRef = useRef(routeSceneId);
  // eslint-disable-next-line react-hooks/refs -- latest-value mirror so music handlers read fresh state
  routeRef.current = routeSceneId;
  const sessionRef = useRef<MusicSession | null>(null);
  const observedRef = useRef<string | null>(null);

  // The one bridge into the session: builds the context (clock, rng,
  // scene signals) and mirrors the view and a style change to state.
  const send = useCallback((intent: MusicIntent) => {
    const session = sessionRef.current;
    const fetched = manifestRef.current;
    if (!session || !fetched) return;
    const prevView = session.view;
    const next = dispatch(session, intent, {
      manifest: fetched,
      signalOf: (sceneId) => byIdRef.current.get(sceneId) ?? null,
      routeSceneId: routeRef.current,
      nowSec: Date.now() / 1000,
      rng: Math.random,
      excludeTrackId: prefsStoreRef.current.load()?.lastTrackId ?? null,
    });
    sessionRef.current = next;
    if (next.view !== prevView) setView(next.view);
    // Remember the last track that started playing so the next session
    // opens on something else. Merge-updates never clobber other fields.
    if (next.view.currentId !== prevView.currentId && next.view.currentId !== null) {
      prefsStoreRef.current.update({ lastTrackId: next.view.currentId });
    }
    if (next.selection !== session.selection || next.view.playlistOn !== prevView.playlistOn) {
      prefsStoreRef.current.update({
        style: next.selection.style,
        playlist: next.view.playlistOn,
      });
    }
  }, []);

  // Stored prefs load once here, after the server-matching first render.
  // Saves happen only on user actions below, so the defaults above never
  // overwrite storage before this runs. The fetch below resolves later and
  // reads the style through the store.
  useEffect(() => {
    const prefs = prefsStoreRef.current.load();
    if (prefs !== null) {
      if (prefs.volume !== null) setVolume(prefs.volume);
      setMuted(prefs.muted);
    }
    try {
      setTheme(initialTheme(window.localStorage.getItem(THEME_KEY)));
    } catch {
      // The inline script already set a theme; keep the default.
    }
    if (new URLSearchParams(window.location.search).has("dev")) setDevOpen(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/music/manifest.json", { signal: AbortSignal.timeout(15_000) })
      .then((res) => {
        if (!res.ok) throw new Error(`manifest ${res.status}`);
        return res.json();
      })
      .then((json: unknown) => {
        if (cancelled) return;
        const parsed = choosePlayableSources(parseManifest(json), canPlayAudio);
        setManifest(parsed);
        const session = startSession(parsed, prefsStoreRef.current.load(), Math.random);
        sessionRef.current = session;
        setView(session.view);
      })
      .catch(() => {
        if (!cancelled) setMusicFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Scene entry: exactly one sceneEntered per scene id, once the manifest
  // lands. The first scene cues at once, so it plays on the first press.
  useEffect(() => {
    const gate = nextSceneEntry({
      observedId: observedRef.current,
      routeId: routeSceneId,
      manifestReady: manifest !== null,
    });
    observedRef.current = gate.nextObservedId;
    if (gate.shouldObserve && routeSceneId) send({ type: "sceneEntered", sceneId: routeSceneId });
  }, [routeSceneId, manifest, send]);

  useEffect(() => {
    // Settle an expired entry dwell, or re-check the scene after a hold.
    const timer = window.setInterval(() => {
      send({ type: "tick" });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [send]);

  // Developer view slice: fetched on demand while the panel is open,
  // so the page never ships all scenes' attrs. Stale requests abort on
  // scene change; any failure hides the section.
  useEffect(() => {
    if (!devOpen || !routeSceneId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- dev panel clears the scene slice when closed
      setSceneAttr(null);
      return;
    }
    const controller = new AbortController();
    setSceneAttr(null);
    fetch(
      `/api/scene-attrs?bookId=${encodeURIComponent(bookId)}&sceneId=${encodeURIComponent(routeSceneId)}`,
      { signal: controller.signal },
    )
      .then((res) => {
        if (!res.ok) throw new Error(`scene attrs ${res.status}`);
        return res.json() as Promise<unknown>;
      })
      .then((json) => {
        if (isSceneAttr(json)) setSceneAttr(json);
      })
      .catch(() => {
        // The panel hides the section on any failure.
      });
    return () => controller.abort();
  }, [devOpen, routeSceneId, bookId]);

  // Developer view: Shift+D outside inputs, Escape closes.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "SELECT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (event.key === "Escape") {
        setDevOpen(false);
        return;
      }
      if (typing) return;
      if (event.shiftKey && (event.key === "D" || event.key === "d")) {
        event.preventDefault();
        setDevOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function skip() {
    send({ type: "skip" });
  }

  // Previous: back to the last played track, held like a Next. With no
  // history the current track restarts from zero through the replay path,
  // including in playlist mode.
  function goPrev() {
    send({ type: "previous" });
  }

  function advanceMode(to?: MusicModeId) {
    send({ type: "modeAdvanced", to });
  }

  function changeVolume(next: number) {
    setVolume(next);
    volumeRef.current = next;
    prefsStoreRef.current.update({ volume: next });
  }

  function changeMuted(next: boolean) {
    setMuted(next);
    mutedRef.current = next;
    prefsStoreRef.current.update({ muted: next });
  }

  function ended(trackId: string) {
    send({ type: "trackEnded", trackId });
  }

  function toggleTheme() {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try {
        window.localStorage.setItem(THEME_KEY, next);
      } catch {
        // The attribute already applies for the session.
      }
      return next;
    });
  }

  function jumpChapter(ch: number) {
    const found = chapters.find((c) => c.ch === ch);
    if (found) requestGotoScene(found.firstSceneId);
  }

  const currentId = view?.currentId ?? null;
  const track = manifest?.tracks.find((t) => t.id === currentId) ?? null;
  const empty = manifest !== null && manifest.tracks.length === 0;
  // Ordered music modes for the control: styles with tracks, then Chopin.
  const modes = manifest ? musicModes(manifest) : [];
  const modeCurrent = view ? currentMode(view) : null;
  const playlistOn = view?.playlistOn ?? false;
  // Previous restarts the track with no history (including the current
  // playlist piece), so it stays on whenever a track is cued.
  const canPrev = view?.canPrev ?? false;
  const canSkip = view?.canSkip ?? false;

  const bookIndex = routeSceneId ? scenes.findIndex((s) => s.id === routeSceneId) : -1;
  const current = routeSceneId ? byId.get(routeSceneId) ?? null : null;
  // Reader chat position: the scene in view, or the first scene on load.
  const chatScene = (routeSceneId ? scenes.find((s) => s.id === routeSceneId) : null) ?? scenes[0];
  const chatChapter = chapters.find((c) => c.ch === chatScene?.ch) ?? chapters[0];
  const devBars = current
    ? EMOTIONS.map((id) => ({ label: DEV_LABELS[id], value: current.vector[id] ?? 0 }))
    : [];


  // Chat answers from the same book text for shelf books and uploads
  // alike; an upload finished with the reader's own key asks on that key.
  return (
    <NarrationProvider entries={narration} scenes={scenes}>
      <div className="folio">
        <a href="#story" className="skip-link">
          Skip to the story
        </a>
        <TopLine
          bookTitle={bookTitle}
          author={bookAuthor}
          ch={routeSceneId ? (scenes[bookIndex]?.ch ?? chapters[0]?.ch ?? 1) : 1}
          chaptersTotal={chapters.length}
          chapters={chapters}
          onJumpChapter={jumpChapter}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
        {children}
        <BandPlay
          narrationOn={hasNarration(narration)}
          musicFailed={musicFailed}
          empty={empty}
          track={track}
          replayNonce={view?.replayNonce ?? 0}
          fadeSec={view?.fadeSec ?? 0}
          canPrev={canPrev}
          onPrev={goPrev}
          canSkip={canSkip}
          onSkip={skip}
          volume={volume}
          muted={muted}
          onVolumeChange={changeVolume}
          onMutedChange={changeMuted}
          modes={modes}
          current={modeCurrent}
          onAdvance={advanceMode}
          onEnded={ended}
          playlistOn={playlistOn}
        />
      {chatScene && chatChapter && (
        <ReaderChat
          bookId={bookId}
          upToN={chatScene.endN}
          chapter={chatChapter.ch}
          chapterTitle={chatChapter.title}
        />
      )}
      <DevPanel
        open={devOpen}
        onClose={() => setDevOpen(false)}
        sceneLabel={bookIndex >= 0 ? `scene ${bookIndex + 1} of ${scenes.length}` : "no scene"}
        bars={devBars}
        intensity={current?.intensity ?? null}
        tempo={current?.tempo ?? null}
        trackTitle={track?.title ?? "No track cued"}
        sceneAttr={sceneAttr}
      />
      </div>
    </NarrationProvider>
  );
}

