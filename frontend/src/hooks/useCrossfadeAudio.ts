import { useEffect, useRef, useState } from 'react';
import { CrossfadeAudioPlayer } from '../audio/crossfadePlayer';

export interface UseCrossfadeAudio {
  /** Last-known *actual* playback state, for the play/pause icon. */
  playing: boolean;
  /** Same signal as a ref: the auto-play-on-scene-change gate reads it synchronously. */
  playingRef: React.RefObject<boolean>;
  /** The live engine. Policy code reads `.current` per call site (see the doc comment). */
  playerRef: React.RefObject<CrossfadeAudioPlayer | null>;
}

/**
 * Thin React bridge to the framework-free `CrossfadeAudioPlayer`. The engine owns
 * the mechanism (ramp, load-with-fallback, teardown); this hook only manages its
 * lifecycle and mirrors its `onState` callback into React. It is deliberately not
 * where the audio logic lives — that is a plain class so it stays unit-testable
 * without a render (docs/adr/0002-frontend-audio-engine-is-a-plain-class.md).
 *
 * The engine is created inside an effect, NOT in render, because the app runs in
 * `<StrictMode>` (main.tsx), which double-invokes effects in dev (setup -> cleanup
 * -> setup). Disposing on cleanup and nulling the ref makes the second setup build
 * a fresh, live engine. A render-created instance would be disposed by the
 * simulated unmount and never rebuilt -> music silently dead in dev.
 *
 * It returns `playerRef` rather than a render-captured instance: a captured value
 * goes stale the moment StrictMode's cleanup disposes it, whereas reading
 * `playerRef.current` at call time always hits the live engine. The hook's create
 * effect runs before the component's scene-change effect (hooks register first),
 * so `.current` is set by the time any policy code runs. The `[volume]`/`[muted]`
 * forwarding effects also run on every (re)mount, so they initialize the engine
 * built on StrictMode's second setup — keeping the engine the *only* writer to
 * `audio.volume`.
 */
export function useCrossfadeAudio(
  volume: number,
  muted: boolean,
  crossfadeMs?: number,
): UseCrossfadeAudio {
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  const playerRef = useRef<CrossfadeAudioPlayer | null>(null);

  useEffect(() => {
    const player = new CrossfadeAudioPlayer({
      createAudio: (src) => new Audio(src),
      onState: (p) => {
        playingRef.current = p;
        setPlaying(p);
      },
      crossfadeMs,
    });
    playerRef.current = player;
    return () => {
      player.dispose();
      playerRef.current = null;
    };
  }, [crossfadeMs]);

  // Forward the UI's volume/muted to the engine, which stays the sole writer to
  // audio.volume. Running on mount initializes a freshly-(re)created engine.
  useEffect(() => {
    playerRef.current?.setVolume(volume);
  }, [volume]);
  useEffect(() => {
    playerRef.current?.setMuted(muted);
  }, [muted]);

  return { playing, playingRef, playerRef };
}
