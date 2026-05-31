/**
 * Framework-free crossfade audio engine (zero React imports). It owns the
 * *mechanism* of music playback — the dual-track volume ramp, the local->CDN
 * load-with-fallback, play/pause/resume, volume/mute, and teardown — behind a
 * small imperative interface. The *policy* (which track, whether to crossfade,
 * skip bookkeeping, all UI copy) stays in `MusicPlayer`; the engine only
 * executes what it is told. Whether a crossfade happens is a backend decision
 * (D12 hysteresis / `should_crossfade`); the engine just performs the ramp.
 *
 * It is a plain class held in a `useRef` via the thin `useCrossfadeAudio` hook
 * (not a hook itself) so this timer/volume math is unit-testable against a fake
 * `Audio` element and fake timers with no React render. See
 * `docs/adr/0002-frontend-audio-engine-is-a-plain-class.md`.
 *
 * Single writer to `audio.volume`: the engine holds a logical `volume`/`muted`
 * and derives `target = muted ? 0 : volume`. `setVolume`/`setMuted` write the
 * element directly only when no fade is running; during a fade the ramp tick is
 * the sole writer and reads the live `target` every step, so dragging the slider
 * mid-crossfade takes effect (the bug this engine fixes was two writers racing).
 */

export type AudioErrorCode = 'load-failed' | 'autoplay-blocked' | 'disposed';

export class AudioError extends Error {
  readonly code: AudioErrorCode;

  constructor(code: AudioErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'AudioError';
    this.code = code;
  }
}

export interface CrossfadePlayerOptions {
  /** The sole injection seam: produce an audio element for a URL (real: `new Audio(src)`). */
  createAudio: (src: string) => HTMLAudioElement;
  /** Reports *actual* playback state: true once play/crossfade starts, false on pause. */
  onState?: (playing: boolean) => void;
  /** Crossfade ramp duration in ms (default 2000). */
  crossfadeMs?: number;
}

const RAMP_TICK_MS = 50;
const DEFAULT_CROSSFADE_MS = 2000;

function kill(audio: HTMLAudioElement | null): void {
  if (audio) {
    audio.pause();
    audio.src = '';
  }
}

export class CrossfadeAudioPlayer {
  private readonly createAudio: (src: string) => HTMLAudioElement;
  private readonly onState: (playing: boolean) => void;
  private readonly crossfadeMs: number;
  private current: HTMLAudioElement | null = null;
  private next: HTMLAudioElement | null = null;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private fadeResolve: (() => void) | null = null;
  private volume = 1;
  private muted = false;
  private disposed = false;

  constructor(opts: CrossfadePlayerOptions) {
    this.createAudio = opts.createAudio;
    this.onState = opts.onState ?? (() => {});
    this.crossfadeMs = opts.crossfadeMs ?? DEFAULT_CROSSFADE_MS;
  }

  /** True once a track is loaded and current; the component gates crossfade-vs-cold-start on it. */
  get hasCurrent(): boolean {
    return this.current !== null;
  }

  private get target(): number {
    return this.muted ? 0 : this.volume;
  }

  /** Cold start: load `url` (falling back to `fallbackUrl`) and play it at `target` volume. */
  async play(url: string, opts: { fallbackUrl: string | null }): Promise<void> {
    if (this.disposed) return;
    const audio = await this.load(url, opts.fallbackUrl);
    if (this.disposed) {
      kill(audio);
      return;
    }
    this.stopFade();
    kill(this.current);
    this.current = audio;
    audio.volume = this.target;
    try {
      await audio.play();
    } catch {
      throw new AudioError('autoplay-blocked');
    }
    if (this.current !== audio) return; // superseded or disposed during the play() await
    this.onState(true);
  }

  /** Load `url` and crossfade from the current track to it over `ms` (default `crossfadeMs`). */
  async crossfadeTo(
    url: string,
    opts: { fallbackUrl: string | null; ms?: number },
  ): Promise<void> {
    if (this.disposed) return;
    const audio = await this.load(url, opts.fallbackUrl);
    if (this.disposed) {
      kill(audio);
      return;
    }
    this.stopFade();
    const old = this.current;
    this.next = audio;
    audio.volume = 0;
    // Autoplay can't block mid-fade (the element is already unlocked), so swallow.
    audio.play().catch(() => {});
    await this.ramp(old, audio, opts.ms ?? this.crossfadeMs);
    // Only report playing if this fade ran to completion. If it was superseded,
    // paused, or disposed mid-ramp, the ramp promise was settled early and `audio`
    // is no longer current — so do not flip state back to playing.
    if (this.current !== audio) return;
    this.onState(true);
  }

  pause(): void {
    if (this.disposed) return;
    this.stopFade();
    this.current?.pause();
    this.onState(false);
  }

  resume(): void {
    if (this.disposed) return;
    this.current?.play().catch(() => {});
    this.onState(true);
  }

  setVolume(v: number): void {
    if (this.disposed) return;
    this.volume = v;
    // Single writer: only touch the element directly when no fade is running.
    if (this.fadeTimer === null && this.current) this.current.volume = this.target;
  }

  setMuted(m: boolean): void {
    if (this.disposed) return;
    this.muted = m;
    if (this.fadeTimer === null && this.current) this.current.volume = this.target;
  }

  /** Idempotent teardown: clear the fade timer, kill both elements, block further work. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearFadeTimer();
    kill(this.current);
    kill(this.next);
    this.current = null;
    this.next = null;
  }

  // --- private mechanism ---

  private load(url: string, fallbackUrl: string | null): Promise<HTMLAudioElement> {
    return new Promise((resolve, reject) => {
      const audio = this.createAudio(url);
      audio.loop = true;

      const onReady = () => {
        audio.removeEventListener('canplaythrough', onReady);
        audio.removeEventListener('error', onError);
        // A dispose() that landed mid-load orphaned this element: kill it and reject.
        if (this.disposed) {
          kill(audio);
          reject(new AudioError('disposed'));
          return;
        }
        resolve(audio);
      };

      const onError = () => {
        audio.removeEventListener('canplaythrough', onReady);
        audio.removeEventListener('error', onError);
        audio.src = '';
        if (fallbackUrl && fallbackUrl !== url) {
          this.load(fallbackUrl, null).then(resolve, reject);
        } else {
          reject(new AudioError('load-failed', `Failed to load audio: ${url}`));
        }
      };

      audio.addEventListener('canplaythrough', onReady, { once: true });
      audio.addEventListener('error', onError, { once: true });
      audio.load();
    });
  }

  private ramp(
    oldEl: HTMLAudioElement | null,
    newEl: HTMLAudioElement,
    ms: number,
  ): Promise<void> {
    return new Promise((resolve) => {
      this.fadeResolve = resolve;
      const steps = ms / RAMP_TICK_MS;
      let step = 0;
      this.fadeTimer = setInterval(() => {
        step++;
        const progress = step / steps;
        // Read the live target every tick: this is the single writer to volume
        // during a fade, so a setVolume/setMuted mid-crossfade lands here rather
        // than racing a separate sync effect (the bug this engine fixes).
        const target = this.target;
        newEl.volume = Math.min(progress * target, target);
        if (oldEl) oldEl.volume = Math.max((1 - progress) * target, 0);
        if (step >= steps) {
          kill(oldEl);
          this.current = newEl;
          this.next = null;
          this.clearFadeTimer(); // clears the interval AND settles this ramp's promise
        }
      }, RAMP_TICK_MS);
    });
  }

  /** Used at the *start* of play/crossfade: clear the timer AND kill the pending `next`. */
  private stopFade(): void {
    this.clearFadeTimer();
    kill(this.next);
    this.next = null;
  }

  /** Clear the fade interval and settle the in-flight ramp's promise. Never touches `next`. */
  private clearFadeTimer(): void {
    if (this.fadeTimer !== null) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }
    // Settle the ramp promise on every path (completed, superseded, paused, disposed)
    // so `await crossfadeTo(...)` never hangs. The caller's `current !== audio` guard
    // keeps an interrupted fade from reporting playing.
    if (this.fadeResolve !== null) {
      const resolve = this.fadeResolve;
      this.fadeResolve = null;
      resolve();
    }
  }
}
