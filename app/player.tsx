"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MUSIC_CONFIG, nowPlaying } from "@/core/music";
import { marqueeDurationMs } from "./marquee";
import { displayTitle } from "@/core/music-credit";
import { effectiveEnd, gainVolume } from "@/core/music-playback";
import type { MusicMode, MusicModeId, Track } from "@/core/music";
import { MusicStyleControl } from "./folio/music-style-control";
import { pressButton } from "./button-fx";
import { RainAmbience } from "./rain-button";
import { rememberPaused, useMusicAutostart } from "./player-autostart";

// Two audio elements with equal-power crossfades. Volume lives in a
// ref, so the slider never re-runs the track effect or touches src.
// Nothing plays before the first user press. Reduced motion only
// affects visuals; the audio fade always runs its full length.
export function Player({
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
  duck = 1,
  ambienceDuck = 1,
}: {
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
  // Read-aloud duck: a multiplier on the slider volume, 1 normally.
  duck?: number;
  // Rain and ambience duck, a multiplier on the rain slider.
  ambienceDuck?: number;
}) {
  const firstRef = useRef<HTMLAudioElement | null>(null);
  const secondRef = useRef<HTMLAudioElement | null>(null);
  const audibleRef = useRef(0);
  const levelRef = useRef<[number, number]>([1, 0]);
  const gainRef = useRef<[number, number]>([0, 0]);
  const cueRef = useRef<[string | null, string | null]>([null, null]);
  const segmentEndRef = useRef<string | null>(null);
  // Slider value and mute live in the reader (persisted prefs); refs
  // mirror the props so the engine never re-runs on volume moves.
  const volumeRef = useRef(volume);
  // eslint-disable-next-line react-hooks/refs -- latest-prop mirror so the engine never re-runs on volume moves
  volumeRef.current = volume;
  const mutedRef = useRef(muted);
  // eslint-disable-next-line react-hooks/refs -- latest-prop mirror so the engine never re-runs on volume moves
  mutedRef.current = muted;
  const duckRef = useRef(duck);
  // eslint-disable-next-line react-hooks/refs -- latest-prop mirror so the engine never re-runs on volume moves
  duckRef.current = duck;
  const fadeRef = useRef<number | null>(null);
  const loopArmedRef = useRef<string | null>(null);
  const trackRef = useRef<Track | null>(track);
  // eslint-disable-next-line react-hooks/refs -- latest-prop mirror so the engine never re-runs on track moves
  trackRef.current = track;
  const fadeSecRef = useRef(fadeSec);
  // eslint-disable-next-line react-hooks/refs -- latest-prop mirror so the engine never re-runs on track moves
  fadeSecRef.current = fadeSec;
  const onEndedRef = useRef(onEnded);
  // eslint-disable-next-line react-hooks/refs -- latest-prop mirror so the engine never re-runs on callback moves
  onEndedRef.current = onEnded;
  const playingRef = useRef(false);
  const startedRef = useRef(false);
  const firstPlayRef = useRef(true);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Scheduler fade when set, else the config default; never 0 mid session.
  function loopFadeSec() {
    return fadeSecRef.current > 0 ? fadeSecRef.current : MUSIC_CONFIG.crossfadeSec;
  }
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const requestPlayRef = useRef((_: Track, __: number) => {});

  // Starts false on server and client alike so hydration matches; the
  // effect below then reads the real preference and re-renders.
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-only reduced-motion read; initial false keeps hydration matching
    setReducedMotion(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  function applyLevels() {
    const els = [firstRef.current, secondRef.current];
    const audible = mutedRef.current ? 0 : volumeRef.current;
    els.forEach((el, i) => {
      if (el)
        el.volume = gainVolume(
          (levelRef.current[i] ?? 0) * duckRef.current,
          audible,
          gainRef.current[i] ?? 0,
        );
    });
  }

  function cancelFade() {
    if (fadeRef.current !== null) {
      cancelAnimationFrame(fadeRef.current);
      fadeRef.current = null;
    }
  }

  // A refused start (autoplay policy, bad src) on the audible element stops
  // everything and shows Play; aborts and superseded elements are ignored.
  function startEl(el: HTMLAudioElement, idx: number) {
    // src is assigned only here so a paused reader downloads no music.
    const cue = cueRef.current[idx];
    if (cue) {
      cueRef.current[idx] = null;
      el.src = cue;
    }
    void el.play().catch((err: unknown) => {
      if ((err as { name?: string })?.name === "AbortError" || audibleRef.current !== idx) return;
      playingRef.current = false;
      setPlaying(false);
      for (const other of [firstRef.current, secondRef.current]) other?.pause();
      if ((err as { name?: string })?.name === "NotAllowedError") armGestureStart();
    });
  }

  // Assigned each render so handlers always see fresh refs. Fades from
  // the currently louder element to the newest track; a mid-fade request
  // cancels the pending fade and starts from current levels.
  // eslint-disable-next-line react-hooks/refs -- handler reassigned each render so callbacks see fresh refs
  requestPlayRef.current = (next: Track, durSec: number) => {
    const els = [firstRef.current, secondRef.current];
    const srcIdx = (levelRef.current[0] ?? 0) >= (levelRef.current[1] ?? 0) ? 0 : 1;
    const dstIdx = 1 - srcIdx;
    const srcEl = els[srcIdx];
    const dst = els[dstIdx];
    if (!srcEl || !dst) return;
    cancelFade();
    if (trackRef.current?.id !== next.id) loopArmedRef.current = null;
    trackRef.current = next;
    segmentEndRef.current = null;
    gainRef.current[dstIdx] = next.gainDb ?? 0;
    cueRef.current[dstIdx] = next.src;
    dst.onloadedmetadata = () => {
      if (next.startSec > 0 && Number.isFinite(dst.duration) && next.startSec < dst.duration) {
        try {
          dst.currentTime = next.startSec;
        } catch {
          // Past the end; leave playback at zero.
        }
      }
    };
    if (!playingRef.current || durSec <= 0) {
      levelRef.current = [0, 0];
      levelRef.current[dstIdx] = 1;
      audibleRef.current = dstIdx;
      srcEl.pause();
      applyLevels();
      if (playingRef.current) startEl(dst, dstIdx);
      return;
    }
    audibleRef.current = dstIdx;
    if (playingRef.current) startEl(dst, dstIdx);
    const startSrc = levelRef.current[srcIdx] ?? 0;
    const startDst = levelRef.current[dstIdx] ?? 0;
    // eslint-disable-next-line react-hooks/purity -- fade clock starts when the fade runs, not during render
    let t0 = performance.now();
    let prev = t0;
    const tick = (now: number) => {
      // Pause freezes the fade; resume continues from the frozen point.
      if (!playingRef.current) {
        t0 += now - prev;
        prev = now;
        fadeRef.current = requestAnimationFrame(tick);
        return;
      }
      prev = now;
      const t = Math.min(1, (now - t0) / (durSec * 1000));
      levelRef.current[srcIdx] = startSrc * Math.cos((t * Math.PI) / 2);
      levelRef.current[dstIdx] = startDst + (1 - startDst) * Math.sin((t * Math.PI) / 2);
      applyLevels();
      if (t < 1) {
        fadeRef.current = requestAnimationFrame(tick);
        return;
      }
      fadeRef.current = null;
      levelRef.current[srcIdx] = 0;
      levelRef.current[dstIdx] = 1;
      audibleRef.current = dstIdx;
      applyLevels();
      srcEl.pause();
    };
    fadeRef.current = requestAnimationFrame(tick);
  };

  const trackId = track?.id ?? null;

  // Reading begins with music; a blocked start waits for the first gesture.
  const { armGestureStart, disarmGesture } = useMusicAutostart({
    trackId,
    rootRef,
    startPlayback,
  });

  useEffect(() => {
    const next = trackRef.current;
    if (!started || !next) {
      // Before the first press, swaps only set gain; src waits for playback.
      if (!started && next) {
        gainRef.current[audibleRef.current] = next.gainDb ?? 0;
        applyLevels();
      }
      return;
    }
    // The single start path: fade 0 on the very first press. Later swaps
    // always crossfade (scheduler fade, else the config default) so a
    // stale 0 from the session never cuts the audio. replayNonce re-cues
    // the same track; nothing else is a dep so volume/pause never restart.
    const dur = firstPlayRef.current ? 0 : loopFadeSec();
    firstPlayRef.current = false;
    requestPlayRef.current(next, dur);
  }, [started, trackId, replayNonce]);

  useEffect(
    () => () => {
      cancelFade();
    },
    [],
  );

  // Duck moves outside the fade engine, so re-apply on every step.
  useEffect(() => {
    applyLevels();
  }, [duck]);

  function handleTimeUpdate(index: number, el: HTMLAudioElement) {
    const next = trackRef.current;
    if (!next || index !== audibleRef.current) return;
    const end = effectiveEnd(next.endSec, el.duration);
    if (!Number.isFinite(end)) return;
    // A non-looping or playlist track ends at the segment end, where the
    // media may keep playing, so fire the ended path once per play.
    if (!next.loop || playlistOn) {
      if (el.currentTime >= end && segmentEndRef.current !== next.id) {
        segmentEndRef.current = next.id;
        onEndedRef.current(next.id);
      }
      return;
    }
    const fade = loopFadeSec();
    if (end <= fade * 2) return;
    const remain = end - el.currentTime;
    if (remain <= fade && loopArmedRef.current !== next.id) {
      loopArmedRef.current = next.id;
      requestPlayRef.current(next, fade);
    } else if (remain > fade + 1) {
      loopArmedRef.current = null;
    }
  }

  function handleEnded(index: number) {
    const els = [firstRef.current, secondRef.current];
    // An element that ends while a fade is running is the one fading out.
    if (index !== audibleRef.current || fadeRef.current !== null) {
      els[index]?.pause();
      return;
    }
    const next = trackRef.current;
    if (!next || segmentEndRef.current === next.id) return;
    if (next.loop && !playlistOn) {
      requestPlayRef.current(next, loopFadeSec());
      return;
    }
    segmentEndRef.current = next.id;
    onEndedRef.current(next.id);
  }

  // The single start path (autostart, first gesture, Play): the first start
  // lets the track effect cue the track; later starts resume the elements.
  function startPlayback() {
    if (playingRef.current && startedRef.current) return;
    disarmGesture();
    rememberPaused(false);
    playingRef.current = true;
    setPlaying(true);
    if (!startedRef.current) {
      startedRef.current = true;
      setStarted(true);
      return;
    }
    const both = [firstRef.current, secondRef.current];
    let heard = false;
    both.forEach((el, i) => {
      if (el && (levelRef.current[i] ?? 0) > 0.02) {
        heard = true;
        startEl(el, i);
      }
    });
    const next = trackRef.current;
    if (!heard && next) requestPlayRef.current(next, 0);
  }

  function toggle() {
    if (!startedRef.current || !playingRef.current) {
      startPlayback();
      return;
    }
    disarmGesture();
    for (const el of [firstRef.current, secondRef.current]) el?.pause();
    playingRef.current = false;
    setPlaying(false);
    rememberPaused(true);
  }

  function changeVolume(value: number) {
    volumeRef.current = value;
    applyLevels();
    onVolumeChange(value);
  }

  function toggleMute() {
    const next = !mutedRef.current;
    mutedRef.current = next;
    applyLevels();
    onMutedChange(next);
  }

  const now = track ? nowPlaying(track) : null;
  const head = track
    ? [displayTitle(track.title), track.composer ?? track.artist]
        .filter((part): part is string => typeof part === "string" && part.length > 0)
        .join(" · ")
    : null;
  const showSource =
    !!track?.sourceUrl && !!track.artist && !!track.composer && track.artist !== track.composer;
  const slotRef = useRef<HTMLSpanElement | null>(null);
  const innerRef = useRef<HTMLSpanElement | null>(null);

  // Fixed-width slot: measure overflow and drive the marquee via CSS vars.
  useLayoutEffect(() => {
    const slot = slotRef.current;
    const inner = innerRef.current;
    if (!slot || !inner) return;
    const update = () => {
      const shift = inner.scrollWidth - slot.clientWidth;
      if (shift > 0) {
        slot.dataset.overflow = "1";
        slot.style.setProperty("--marquee-shift", `${shift}px`);
        slot.style.setProperty("--marquee-duration", `${marqueeDurationMs(shift)}ms`);
      } else {
        delete slot.dataset.overflow;
        slot.style.removeProperty("--marquee-shift");
        slot.style.removeProperty("--marquee-duration");
      }
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(slot);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [trackId, head]);

  return (
    <div ref={rootRef} className="player" role="region" aria-label="Music player" data-reduced-motion={reducedMotion}>
      <audio ref={firstRef} preload="none" onTimeUpdate={(e) => handleTimeUpdate(0, e.currentTarget)} onEnded={() => handleEnded(0)} />
      <audio ref={secondRef} preload="none" onTimeUpdate={(e) => handleTimeUpdate(1, e.currentTarget)} onEnded={() => handleEnded(1)} />
      <button type="button" className="skip" onClick={(e) => { pressButton(e); onPrev(); }} disabled={!canPrev} aria-label="Previous track" title="Previous track">
        <svg width="17" height="17" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <rect x="2.5" y="3" width="2" height="10" rx="0.5" />
          <path d="M13.5 3.5v9L6 8z" />
        </svg>
      </button>
      <button type="button" className="skip play" onClick={(e) => { pressButton(e); toggle(); }} aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause" : "Play"}>
        {playing ? (
          <svg width="17" height="17" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <rect x="4" y="3" width="2.6" height="10" rx="0.5" />
            <rect x="9.4" y="3" width="2.6" height="10" rx="0.5" />
          </svg>
        ) : (
          <svg width="17" height="17" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M5 3.5v9l7.5-4.5z" />
          </svg>
        )}
      </button>
      <button type="button" className="skip" onClick={(e) => { pressButton(e); onSkip(); }} disabled={!canSkip} aria-label="Next track" title="Next track">
        <svg width="17" height="17" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M2.5 3.5v9l7.5-4.5z" />
          <rect x="11.5" y="3" width="2" height="10" rx="0.5" />
        </svg>
      </button>
      <span className="player-track" aria-live="polite" title={now?.full} ref={slotRef}>
        <span className="player-track-inner" ref={innerRef}>
          {head ?? "The music is resting"}
          {showSource && track?.sourceUrl ? (
            <>
              {" · "}
              <a
                href={track.sourceUrl}
                rel="noopener noreferrer"
                target="_blank"
                aria-label={`${track.artist} (opens in new tab)`}
                title={`${track.artist} (opens in new tab)`}
              >
                {track.artist}{" "}
                <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M3 9 9 3M4.5 3H9v4.5" />
                </svg>
              </a>
            </>
          ) : null}
        </span>
      </span>
      <button
        type="button"
        className="skip"
        onClick={(e) => { pressButton(e); toggleMute(); }}
        aria-pressed={muted}
        aria-label={muted ? "Unmute" : "Mute"}
        title={muted ? "Unmute" : "Mute"}
      >
        <svg width="17" height="17" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M2.5 6v4h2.6L9 13V3L5.1 6H2.5z" />
          {muted ? (
            <path
              d="M11 6.5l4 4m0-4l-4 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          ) : (
            <path
              d="M11 5.6a3.4 3.4 0 0 1 0 4.8M12.8 3.8a6 6 0 0 1 0 8.4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          )}
        </svg>
      </button>
      <label className="player-volume">
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => changeVolume(Number(e.target.value))}
          aria-label="Volume"
        />
      </label>
      <MusicStyleControl modes={modes} current={current} onAdvance={onAdvance} />
      <span className="rain-group">
        <RainAmbience muted={muted} duck={ambienceDuck} />
      </span>
    </div>
  );
}
