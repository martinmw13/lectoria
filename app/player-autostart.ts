// Music autostart: reading begins with music unless the user paused it.
// Blocked autoplay arms a one-shot gesture listener that starts playback.
// Start reading on home always means music: it clears a sticky pause and
// mute and leaves an intent the reader honors on its first track.
import { useEffect, useRef, type RefObject } from "react";
import { DEFAULT_VOLUME, createMusicPrefsStore } from "./music-prefs";

// An explicit pause sticks across visits: the reader never auto-starts
// music the user stopped.
const MUSIC_PAUSED_KEY = "lectoria.music.paused";
const GESTURES = ["pointerdown", "keydown", "touchend", "wheel"] as const;

function pausedByUser(): boolean {
  try {
    return window.localStorage.getItem(MUSIC_PAUSED_KEY) === "1";
  } catch {
    return false;
  }
}

// A one-sample silent WAV: playing it inside the Start reading click
// unlocks media playback for this document (Safari/iOS count only
// gesture-time play()), so the reader's own autostart is not refused
// after the client-side page turn.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";

// Set by the Start reading click, read once by the reader's player. It is
// session-scoped and short-lived, so a later reload never forces music.
export const MUSIC_INTENT_KEY = "lectoria.music.autostart";
export const MUSIC_INTENT_TTL_MS = 60_000;

function markAutostartIntent(now: number) {
  try {
    window.sessionStorage.setItem(MUSIC_INTENT_KEY, String(now));
  } catch {
    // No session storage: the cleared pause still lets the reader start.
  }
}

/** Reads and clears the Start reading intent; true when it is fresh. */
export function takeAutostartIntent(now: number = Date.now()): boolean {
  try {
    const raw = window.sessionStorage.getItem(MUSIC_INTENT_KEY);
    if (raw === null) return false;
    window.sessionStorage.removeItem(MUSIC_INTENT_KEY);
    const at = Number(raw);
    return Number.isFinite(at) && now - at >= 0 && now - at <= MUSIC_INTENT_TTL_MS;
  } catch {
    return false;
  }
}

/**
 * Call from the Start reading click on home. Music always starts from this
 * entry point: an earlier pause, mute, or zero volume is undone, an intent
 * is left for the reader, and a silent play inside the click unlocks media
 * playback for this document. Never throws.
 */
export function unlockMusicFromGesture(now: number = Date.now()): boolean {
  rememberPaused(false);
  try {
    const prefs = createMusicPrefsStore();
    const stored = prefs.load();
    if (stored === null || stored.muted || stored.volume === 0) {
      prefs.update({ muted: false, volume: stored?.volume ? stored.volume : DEFAULT_VOLUME });
    }
  } catch {
    // Storage refused: the reader falls back to its defaults (unmuted).
  }
  markAutostartIntent(now);
  try {
    const a = new Audio(SILENT_WAV);
    void a.play()?.catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

export function rememberPaused(paused: boolean) {
  try {
    if (paused) window.localStorage.setItem(MUSIC_PAUSED_KEY, "1");
    else window.localStorage.removeItem(MUSIC_PAUSED_KEY);
  } catch {
    // Private mode: the pause holds for this page only.
  }
}

export function useMusicAutostart({
  trackId,
  rootRef,
  startPlayback,
}: {
  trackId: string | null;
  rootRef: RefObject<HTMLDivElement | null>;
  startPlayback: () => void;
}): { armGestureStart: () => void; disarmGesture: () => void } {
  const disarmRef = useRef<(() => void) | null>(null);

  // Autoplay with sound was blocked: the first gesture anywhere, including
  // the player's own controls, starts the music once; only the Play/Pause
  // button is left to its own click.
  function armGestureStart() {
    if (disarmRef.current || pausedByUser()) return;
    const onGesture = (event: Event) => {
      const playButton = (event.target as Element | null)?.closest?.("button.play");
      if (playButton && rootRef.current?.contains(playButton)) return;
      disarm();
      if (pausedByUser()) return;
      startPlayback();
    };
    const disarm = () => {
      for (const type of GESTURES) document.removeEventListener(type, onGesture, true);
      disarmRef.current = null;
    };
    for (const type of GESTURES) document.addEventListener(type, onGesture, { capture: true, passive: true });
    disarmRef.current = disarm;
  }

  const disarmGesture = () => disarmRef.current?.();

  const triedRef = useRef(false);

  // Reading begins with music: try to start as soon as the first track is
  // known, unless the user paused it before. A fresh Start reading intent
  // wins over a pause; a blocked start then waits for the first gesture.
  useEffect(() => {
    if (triedRef.current || trackId === null) return;
    const intent = takeAutostartIntent();
    if (!intent && pausedByUser()) return;
    triedRef.current = true;
    if (intent) rememberPaused(false);
    startPlayback();
  }, [trackId]);

  useEffect(
    () => () => {
      disarmRef.current?.();
    },
    [],
  );

  return { armGestureStart, disarmGesture };
}
