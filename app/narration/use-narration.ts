// Read-aloud controller: one dedicated audio element per reader mount,
// per-chapter manifests fetched lazily, duck signal for the music
// player. The element lives in the layout-level provider, so scrolling
// never interrupts playback. Play starts at the live scene (the scene
// under the reading line); pausing keeps the position, so pressing play
// again in the same scene resumes where it paused.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  NARRATION_VOICES,
  isNarrationVoiceId,
  parseChapterNarration,
  sceneSpan,
  type ChapterNarration,
} from "@/core/narration";
import { getCurrentSceneId } from "../leer/current-scene";
import {
  AMBIENCE_DUCK_DB,
  MUSIC_DUCK_DB,
  NARRATION_DUCK_DOWN_MS,
  NARRATION_DUCK_HOLD_MS,
  NARRATION_DUCK_UP_MS,
  duckTarget,
  easeDuck,
} from "./duck";
import { DEFAULT_NARRATION_PREFS, loadNarrationPrefs, saveNarrationPrefs } from "./prefs";
import type { NarrationChapterEntry, NarrationPrefs, NarrationStatus } from "./types";

export interface NarrationSceneRef {
  id: string;
  ch: number;
  startN: number;
  endN: number;
}

function cacheKey(voice: string, ch: number): string {
  return `${voice}:${ch}`;
}

// The saved voice when the chapter offers it, else the chapter's first
// available voice. The saved pref never changes here; only setVoice saves.
export function pickEffectiveVoice(saved: string, available: string[]): string {
  return available.includes(saved) ? saved : (available[0] ?? saved);
}

function useDuckRamp(target: number): number {
  const [duck, setDuck] = useState(1);
  const duckRef = useRef(1);
  useEffect(() => {
    if (duckRef.current === target) {
      setDuck(target);
      return;
    }
    const from = duckRef.current;
    const duration = target < from ? NARRATION_DUCK_DOWN_MS : NARRATION_DUCK_UP_MS;
    let raf = 0;
    let start = -1;
    const tick = (now: number) => {
      if (start < 0) start = now;
      const next = easeDuck(from, target, now - start, duration);
      duckRef.current = next;
      setDuck(next);
      if (next !== target) raf = requestAnimationFrame(tick);
    };
    // Releases wait out the between-chunk gap; a re-duck inside it
    // cancels the timer and the level never moves.
    const hold = target > from ? NARRATION_DUCK_HOLD_MS : 0;
    const timer = setTimeout(() => {
      raf = requestAnimationFrame(tick);
    }, hold);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [target]);
  return duck;
}

export function useNarrationController(opts: {
  entries: NarrationChapterEntry[];
  scenes: NarrationSceneRef[];
}) {
  const [prefs, setPrefs] = useState<NarrationPrefs>(DEFAULT_NARRATION_PREFS);
  const [status, setStatus] = useState<NarrationStatus>("idle");
  const [playing, setPlaying] = useState(false);
  const [scene, setScene] = useState<NarrationSceneRef | null>(null);
  const [manifest, setManifest] = useState<ChapterNarration | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Manifests are cached per voice and chapter, so switching back to a
  // voice never refetches.
  const cacheRef = useRef(new Map<string, ChapterNarration>());
  const entriesRef = useRef(opts.entries);
  // eslint-disable-next-line react-hooks/refs -- latest-props mirror for async audio callbacks
  entriesRef.current = opts.entries;
  const scenesRef = useRef(opts.scenes);
  // eslint-disable-next-line react-hooks/refs -- latest-props mirror for async audio callbacks
  scenesRef.current = opts.scenes;
  const sceneRef = useRef(scene);
  // eslint-disable-next-line react-hooks/refs -- latest-props mirror for async audio callbacks
  sceneRef.current = scene;
  const prefsRef = useRef(prefs);
  // eslint-disable-next-line react-hooks/refs -- latest-props mirror for async audio callbacks
  prefsRef.current = prefs;
  const loadToken = useRef(0);
  const wantPlay = useRef(false);
  const pendingSeek = useRef<number | null>(null);
  const advancingRef = useRef(false);
  const prefetching = useRef(new Set<string>());

  // Stored prefs apply after the server-matching first render.
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-only narration prefs restore from localStorage
      setPrefs(loadNarrationPrefs(window.localStorage));
    } catch {
      // Defaults already render; playback starts on user press.
    }
  }, []);

  function persist(next: NarrationPrefs) {
    setPrefs(next);
    try {
      saveNarrationPrefs(window.localStorage, next);
    } catch {
      // Private mode: playback continues without persistence.
    }
  }

  // Voices with narration for the current chapter, in the shared list
  // order. Falling back to every known entry voice before the first
  // scene keeps the picker stable while the scene resolves.
  const voices = useMemo(() => {
    const inChapter =
      scene === null ? opts.entries : opts.entries.filter((e) => e.ch === scene.ch);
    const ids = new Set(inChapter.map((e) => e.voice));
    return NARRATION_VOICES.filter((v) => ids.has(v.id)).map((v) => v.id);
  }, [opts.entries, scene]);

  const effectiveVoice = pickEffectiveVoice(prefs.voice, voices);

  // Current chapter manifest in the chosen voice: cache hit or a lazy
  // fetch, parsed at the trust boundary.
  useEffect(() => {
    if (!prefs.on || scene === null) {
      if (!prefs.on) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- manifest/status sync on voice/scene change; cache hits apply inline
        setStatus("idle");
        setManifest(null);
      }
      return;
    }
    const key = cacheKey(effectiveVoice, scene.ch);
    const cached = cacheRef.current.get(key);
    if (cached) {
      setManifest(cached);
      setStatus("ready");
      return;
    }
    const token = (loadToken.current += 1);
    setStatus("loading");
    setManifest(null);
    const entry = entriesRef.current.find((e) => e.ch === scene.ch && e.voice === effectiveVoice);
    if (!entry) {
      if (loadToken.current === token) {
        setStatus("error");
        wantPlay.current = false;
      }
      return;
    }
    fetch(entry.manifest, { signal: AbortSignal.timeout(15_000) })
      .then((res) => {
        if (!res.ok) throw new Error(`narration ${res.status}`);
        return res.json();
      })
      .then((json: unknown) => {
        if (loadToken.current !== token) return;
        const parsed = parseChapterNarration(json);
        cacheRef.current.set(key, parsed);
        setManifest(parsed);
        setStatus("ready");
      })
      .catch(() => {
        if (loadToken.current === token) {
          setStatus("error");
          wantPlay.current = false;
        }
      });
  }, [prefs.on, effectiveVoice, scene]);

  // On a chapter's last scene the next manifest is fetched ahead, so the
  // boundary advance usually finds it cached. It only fills the cache:
  // status and the current fetch (with its loadToken guard) stay untouched.
  useEffect(() => {
    if (!prefs.on || scene === null) return;
    const order = scenesRef.current;
    const at = order.findIndex((s) => s.id === scene.id);
    const next = at >= 0 ? order[at + 1] : undefined;
    if (!next || next.ch === scene.ch) return;
    const key = cacheKey(effectiveVoice, next.ch);
    if (cacheRef.current.has(key)) return;
    const entry = entriesRef.current.find((e) => e.ch === next.ch && e.voice === effectiveVoice);
    if (!entry || prefetching.current.has(key)) return;
    prefetching.current.add(key);
    fetch(entry.manifest, { signal: AbortSignal.timeout(15_000) })
      .then((res) => {
        if (!res.ok) throw new Error(`narration ${res.status}`);
        return res.json();
      })
      .then((json: unknown) => {
        cacheRef.current.set(key, parseChapterNarration(json));
      })
      .catch(() => {
        // The boundary advance fetches it again through the main path.
      })
      .finally(() => {
        prefetching.current.delete(key);
      });
  }, [prefs.on, effectiveVoice, scene]);

  // Seek to the scene span, swapping chapter audio when needed. A fresh
  // src seeks on loadedmetadata; a kept src seeks at once. An explicit
  // position (click-to-seek) wins over the span start.
  const seekScene = useCallback(() => {
    const audio = audioRef.current;
    const current = sceneRef.current;
    const heard =
      current !== null ? cacheRef.current.get(cacheKey(effectiveVoice, current.ch)) : undefined;
    if (!audio || !current || !heard) return;
    const span = sceneSpan(heard, current.startN, current.endN);
    if (!span) return;
    const at = pendingSeek.current;
    pendingSeek.current = null;
    const pos = at ?? span.startSec;
    if (audio.dataset.key !== heard.key) {
      pendingSeek.current = pos;
      audio.dataset.key = heard.key;
      audio.src = heard.src;
    } else {
      try {
        audio.currentTime = pos;
      } catch {
        pendingSeek.current = pos;
      }
    }
  }, [effectiveVoice]);

  const playCurrent = useCallback(() => {
    const audio = audioRef.current;
    if (
      !audio ||
      sceneRef.current === null ||
      cacheRef.current.get(cacheKey(effectiveVoice, sceneRef.current.ch)) === undefined
    ) {
      return;
    }
    seekScene();
    wantPlay.current = true;
    void audio.play().catch(() => {
      wantPlay.current = false;
    });
  }, [seekScene, effectiveVoice]);

  // Scene moves seek at once; playback resumes when the manifest lands.
  // A self-advance inside one chapter never seeks: that audio is
  // continuous, so the voice just keeps playing into the next scene.
  const prevSceneId = useRef<string | null>(null);
  const prevSceneCh = useRef<number | null>(null);
  useEffect(() => {
    if (scene !== null && prevSceneId.current !== scene.id) {
      // A paused advance (the chapter ended mid-scene) falls through to
      // the seek below, so the voice resumes at the next span start.
      const keepPlaying =
        advancingRef.current &&
        prevSceneCh.current === scene.ch &&
        pendingSeek.current === null &&
        audioRef.current !== null &&
        !audioRef.current.paused;
      prevSceneId.current = scene.id;
      prevSceneCh.current = scene.ch;
      advancingRef.current = false;
      if (keepPlaying) return;
      if (cacheRef.current.get(cacheKey(effectiveVoice, scene.ch)) !== undefined) {
        if (wantPlay.current && prefsRef.current.on) playCurrent();
        else seekScene();
      }
    }
  }, [scene, manifest, seekScene, playCurrent, effectiveVoice]);

  // The want-to-play flag survives the manifest fetch.
  useEffect(() => {
    if (status === "ready" && wantPlay.current && prefs.on) playCurrent();
  }, [status, prefs.on, playCurrent]);

  // One audio element: play/pause mirror to state, the chapter end and
  // span end advance without user action, errors surface quietly.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => {
      setPlaying(true);
      setStatus((s) => (s === "error" ? "ready" : s));
    };
    const onPause = () => setPlaying(false);
    const onMeta = () => {
      if (pendingSeek.current !== null) {
        const at = pendingSeek.current;
        pendingSeek.current = null;
        try {
          // A voice swap keeps seconds, so clamp past a shorter chapter.
          audio.currentTime =
            Number.isFinite(audio.duration) && audio.duration > 0 ? Math.min(at, Math.max(0, audio.duration - 0.1)) : at;
        } catch {
          // Past the end; the watchdog advances on timeupdate.
        }
      }
    };
    // The one advance path: the span watchdog (0.15 s early) and the
    // chapter end both land here. Events for a chapter whose manifest is
    // missing, or whose audio is not the one playing, are ignored, so a
    // late `ended` can never skip the next chapter's first scene.
    const advance = () => {
      const current = sceneRef.current;
      if (advancingRef.current || !current) return;
      const heard = cacheRef.current.get(cacheKey(effectiveVoice, current.ch));
      if (!heard || audio.dataset.key !== heard.key) return;
      const order = scenesRef.current;
      const at = order.findIndex((s) => s.id === current.id);
      const next = at >= 0 ? order[at + 1] : undefined;
      if (next === undefined) {
        wantPlay.current = false;
        audio.pause();
        return;
      }
      // The voice moves on by itself; the reader's scroll never steers it.
      advancingRef.current = true;
      setScene(next);
    };
    const onTime = () => {
      const current = sceneRef.current;
      if (!current || audio.paused) return;
      const heard = cacheRef.current.get(cacheKey(effectiveVoice, current.ch));
      if (!heard || audio.dataset.key !== heard.key) return;
      const span = sceneSpan(heard, current.startN, current.endN);
      if (span !== null && audio.currentTime >= span.endSec - 0.15) advance();
    };
    const onError = () => {
      setStatus("error");
      setPlaying(false);
      wantPlay.current = false;
      // Forget the broken src so the next press re-sets it and reloads once.
      delete audio.dataset.key;
    };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", advance);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", advance);
      audio.removeEventListener("error", onError);
    };
  }, [effectiveVoice]);

  // Duck ramps: music about 11 dB and rain about 6 dB under the user's
  // own sliders while the voice plays, eased over ~1 s each way; a
  // release waits ~0.6 s so chunk gaps hold the duck. Pause, the end
  // of the book, errors, and switching off all restore the level.
  const narrating = prefs.on && playing;
  const duck = useDuckRamp(duckTarget(narrating, MUSIC_DUCK_DB));
  const ambienceDuck = useDuckRamp(duckTarget(narrating, AMBIENCE_DUCK_DB));

  // The narration volume rides its own slider, never the music mute.
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      try {
        audio.volume = prefs.volume;
      } catch {
        // A missing media engine keeps the slider harmless.
      }
    }
  }, [prefs.volume, status]);

  // Press play at the live scene: the scene under the reading line, at
  // its span start — or where it paused when still in that scene. The
  // live scene keeps following scroll only; narration never sets it.
  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (playing) {
      wantPlay.current = false;
      audio?.pause();
      return;
    }
    // A fresh press supersedes any click-to-seek still waiting on a fetch.
    pendingSeek.current = null;
    if (!prefsRef.current.on) {
      persist({ on: true, volume: prefsRef.current.volume, voice: prefsRef.current.voice });
    }
    const order = scenesRef.current;
    const liveId = getCurrentSceneId();
    const found = liveId !== null ? order.find((s) => s.id === liveId) : undefined;
    const target = found ?? sceneRef.current ?? order[0] ?? null;
    if (target === null) {
      wantPlay.current = true;
      return;
    }
    if (sceneRef.current?.id !== target.id) {
      setScene(target);
      wantPlay.current = true;
      return;
    }
    wantPlay.current = true;
    const heard = cacheRef.current.get(cacheKey(effectiveVoice, target.ch));
    if (audio && heard && audio.dataset.key === heard.key) {
      // Still positioned in this scene: resume where it paused.
      void audio.play().catch(() => {
        wantPlay.current = false;
      });
      return;
    }
    playCurrent();
  }, [playing, playCurrent, effectiveVoice]);

  const setVolume = useCallback(
    (volume: number) => {
      persist({ on: prefsRef.current.on, volume, voice: prefsRef.current.voice });
    },
    [],
  );

  // Switching voice mid-playback restarts the current chapter at
  // roughly the same position: the live seconds carry over through
  // pendingSeek and the new manifest seeks there once it lands.
  const setVoice = useCallback((voice: string) => {
    if (!isNarrationVoiceId(voice) || voice === prefsRef.current.voice) return;
    const audio = audioRef.current;
    if (audio && !audio.paused) {
      try {
        pendingSeek.current = audio.currentTime;
      } catch {
        pendingSeek.current = null;
      }
    }
    persist({ on: prefsRef.current.on, volume: prefsRef.current.volume, voice });
  }, []);

  // Click-to-seek: the scene holding paragraph n becomes current and
  // the voice jumps to t. Live-chapter audio seeks at once; a chapter
  // swap (or a manifest still loading) seeks through pendingSeek once
  // ready. Without t the scene starts at its span start.
  const seekTo = useCallback((n: number, t?: number) => {
    const target = scenesRef.current.find((s) => s.startN <= n && n <= s.endN);
    if (!target) return;
    if (t !== undefined) pendingSeek.current = t;
    if (sceneRef.current?.id === target.id) {
      const audio = audioRef.current;
      const heard = cacheRef.current.get(cacheKey(effectiveVoice, target.ch));
      if (t !== undefined && audio && heard && audio.dataset.key === heard.key) {
        pendingSeek.current = null;
        try {
          audio.currentTime = t;
        } catch {
          pendingSeek.current = t;
        }
      }
      return;
    }
    setScene(target);
  }, [effectiveVoice]);

  const span =
    scene !== null && manifest !== null ? sceneSpan(manifest, scene.startN, scene.endN) : null;

  return {
    audioRef,
    on: prefs.on,
    volume: prefs.volume,
    voice: effectiveVoice,
    voices,
    status,
    playing,
    duck,
    ambienceDuck,
    scene,
    manifest,
    span,
    toggle,
    setVolume,
    setVoice,
    seekTo,
  };
}

export type NarrationController = ReturnType<typeof useNarrationController>;
