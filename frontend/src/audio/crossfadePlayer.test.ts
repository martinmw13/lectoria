import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { CrossfadeAudioPlayer, AudioError } from './crossfadePlayer';

/**
 * Typed fake `Audio` element (no `any`), cast through `unknown` at the `createAudio`
 * seam. `emit` synchronously fires the listeners the engine registered, standing in
 * for the browser dispatching `canplaythrough` / `error`.
 */
class FakeAudio {
  src = '';
  loop = false;
  volume = 1;
  play = vi.fn<() => Promise<void>>(() => Promise.resolve());
  pause = vi.fn();
  load = vi.fn();
  private listeners: Record<string, Array<() => void>> = {};

  addEventListener(type: string, cb: () => void) {
    (this.listeners[type] ??= []).push(cb);
  }

  removeEventListener(type: string, cb: () => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== cb);
  }

  emit(type: 'canplaythrough' | 'error') {
    (this.listeners[type] ?? []).slice().forEach((f) => f());
  }
}

describe('CrossfadeAudioPlayer', () => {
  let fakes: FakeAudio[];
  let createAudio: (src: string) => HTMLAudioElement;
  let onState: Mock<(playing: boolean) => void>;
  let player: CrossfadeAudioPlayer;

  beforeEach(() => {
    vi.useFakeTimers();
    fakes = [];
    createAudio = (src: string) => {
      const a = new FakeAudio();
      a.src = src;
      fakes.push(a);
      return a as unknown as HTMLAudioElement;
    };
    onState = vi.fn<(playing: boolean) => void>();
    player = new CrossfadeAudioPlayer({ createAudio, onState, crossfadeMs: 2000 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Cold start: kick off play(), resolve the load, await the (timer-free) start.
  async function coldStart(url: string, fallbackUrl: string | null = null) {
    const p = player.play(url, { fallbackUrl });
    fakes[fakes.length - 1].emit('canplaythrough');
    await p;
  }

  it('ends a crossfade at the target volume and kills the old element', async () => {
    player.setVolume(0.6);
    await coldStart('track1');
    expect(player.hasCurrent).toBe(true);

    const p = player.crossfadeTo('track2', { fallbackUrl: null });
    fakes[1].emit('canplaythrough');
    await vi.advanceTimersByTimeAsync(2000);
    await p;

    expect(fakes[1].volume).toBe(0.6); // new element ramped to target
    expect(fakes[0].pause).toHaveBeenCalled(); // old element killed
    expect(fakes[0].src).toBe('');
  });

  it('honours a volume change made mid-crossfade (live target, not the fade-start value)', async () => {
    player.setVolume(0.8);
    await coldStart('track1');

    const p = player.crossfadeTo('track2', { fallbackUrl: null });
    fakes[1].emit('canplaythrough');
    await vi.advanceTimersByTimeAsync(1000); // half the 2000ms fade
    player.setVolume(0.2); // drag the slider mid-fade
    await vi.advanceTimersByTimeAsync(1000); // finish the fade
    await p;

    // Live target: 0.2. The buggy port captures 0.8 at fade start and ends there.
    expect(fakes[1].volume).toBe(0.2);
  });

  it('falls back from a failed local URL to the CDN URL', async () => {
    const p = player.play('/api/music/local.mp3', { fallbackUrl: 'https://cdn/track.mp3' });
    fakes[0].emit('error'); // local fails
    fakes[1].emit('canplaythrough'); // CDN loads
    await p;

    expect(fakes).toHaveLength(2);
    expect(fakes[1].src).toBe('https://cdn/track.mp3');
    expect(fakes[1].play).toHaveBeenCalled();
    expect(player.hasCurrent).toBe(true);
  });

  it('rejects with load-failed when both the local and CDN URLs fail', async () => {
    const p = player.play('/api/music/local.mp3', { fallbackUrl: 'https://cdn/track.mp3' });
    fakes[0].emit('error'); // local fails -> tries CDN
    fakes[1].emit('error'); // CDN fails -> no more fallback
    const err = await p.catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AudioError);
    expect((err as AudioError).code).toBe('load-failed');
  });

  it('rejects with autoplay-blocked when play() is refused, and never reports playing', async () => {
    const p = player.play('track1', { fallbackUrl: null });
    fakes[0].play.mockRejectedValue(new Error('blocked'));
    fakes[0].emit('canplaythrough');
    const err = await p.catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AudioError);
    expect((err as AudioError).code).toBe('autoplay-blocked');
    expect(onState).not.toHaveBeenCalledWith(true);
  });

  it('kills the orphan and rejects with disposed when dispose() lands mid-load', async () => {
    const p = player.play('track1', { fallbackUrl: null });
    player.dispose();
    fakes[0].emit('canplaythrough'); // load resolves AFTER dispose
    const err = await p.catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AudioError);
    expect((err as AudioError).code).toBe('disposed');
    expect(fakes[0].pause).toHaveBeenCalled(); // orphan killed
    expect(fakes[0].src).toBe('');
    expect(fakes[0].play).not.toHaveBeenCalled(); // never started
  });

  it('resume() replays the existing element without reloading', async () => {
    await coldStart('track1');
    player.pause();
    player.resume();

    expect(fakes).toHaveLength(1); // createAudio called once
    expect(fakes[0].load).toHaveBeenCalledTimes(1); // loaded once
    expect(fakes[0].play).toHaveBeenCalledTimes(2); // initial play + resume
  });

  it('settles when a crossfade is interrupted by pause, and stays paused', async () => {
    await coldStart('track1');
    onState.mockClear();

    let settled = false;
    void player.crossfadeTo('track2', { fallbackUrl: null }).then(() => {
      settled = true;
    });
    fakes[1].emit('canplaythrough');
    await vi.advanceTimersByTimeAsync(1000); // half the fade
    player.pause(); // interrupt mid-crossfade
    await vi.advanceTimersByTimeAsync(100); // flush the settle

    expect(settled).toBe(true); // the crossfade promise resolved — it must not hang
    expect(onState).toHaveBeenLastCalledWith(false); // the interrupted fade must not report playing
  });

  it('settles a superseded crossfade and only the winning one reports playing', async () => {
    player.setVolume(0.5);
    await coldStart('track1');
    onState.mockClear();

    let firstSettled = false;
    void player.crossfadeTo('track2', { fallbackUrl: null }).then(() => {
      firstSettled = true;
    });
    fakes[1].emit('canplaythrough');
    await vi.advanceTimersByTimeAsync(1000); // half of the first fade

    const winner = player.crossfadeTo('track3', { fallbackUrl: null });
    fakes[2].emit('canplaythrough');
    await vi.advanceTimersByTimeAsync(100); // the supersede settles the first fade
    expect(firstSettled).toBe(true); // superseded fade resolved — it must not hang

    await vi.advanceTimersByTimeAsync(2000); // finish the winning fade
    await winner;

    expect(fakes[2].volume).toBe(0.5); // winner ramped to target
    expect(fakes[1].pause).toHaveBeenCalled(); // superseded element was killed
    expect(onState.mock.calls.filter((c) => c[0] === true)).toHaveLength(1);
  });
});
