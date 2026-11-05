// Rain level, volume, and mute logic against an injected engine, so
// tests use a fake. The controller owns fades: fade in from off,
// crossfade between playing levels, fade out to off. Nothing starts
// before unlock (the user gesture); pending loads never race, so only
// the latest level starts and at most two voices are alive at once.
import {
  AMBIENCES,
  CROSSFADE_SEC,
  DEFAULT_AMBIENCE_VOLUME,
  FADE_IN_SEC,
  FADE_OUT_SEC,
  MUTE_FADE_SEC,
  VOLUME_RAMP_SEC,
  ambienceGain,
  levelById,
} from "@/core/ambience";
import type { Ambience, AmbienceSource } from "@/core/ambience";

export interface AmbienceVoice {
  ramp(gain: number, sec: number): void;
  stop(fadeSec: number): void;
}

export interface AmbienceEngine {
  load(sources: AmbienceSource[]): Promise<unknown>;
  start(handle: unknown, gain: number, fadeSec: number): AmbienceVoice;
  unlock(): Promise<void>;
}

export class AmbienceController {
  private levelId = "off";
  private volume = DEFAULT_AMBIENCE_VOLUME;
  private muted = false;
  private duck = 1;
  private unlocked = false;
  private voice: AmbienceVoice | null = null;
  private pendingId: string | null = null;
  private seq = 0;

  constructor(
    private engine: AmbienceEngine,
    private ambience: Ambience = AMBIENCES[0]!,
  ) {}

  private targetGain(levelId: string): number {
    return ambienceGain(this.volume, this.muted, levelById(this.ambience, levelId)?.gainDb ?? 0) * this.duck;
  }

  // Read-aloud duck, a multiplier on the slider gain (~6 dB). The narration
  // controller already eases it over ~1 s, so each step only needs a
  // short smoothing ramp. It never starts or stops a voice.
  setDuck(duck: number): void {
    const next = Number.isFinite(duck) ? Math.min(1, Math.max(0, duck)) : 1;
    if (next === this.duck) return;
    this.duck = next;
    this.voice?.ramp(this.targetGain(this.levelId), VOLUME_RAMP_SEC);
  }

  private play(levelId: string): void {
    const level = levelById(this.ambience, levelId);
    if (!level || !this.unlocked) return;
    const at = ++this.seq;
    this.pendingId = levelId;
    const sources = level.sources;
    void this.engine.load(sources).then((handle) => {
      if (at !== this.seq) return;
      this.pendingId = null;
      const prev = this.voice;
      this.voice = null;
      // From off there is nothing to crossfade, so fade in instead.
      if (prev) prev.stop(CROSSFADE_SEC);
      this.voice = this.engine.start(handle, this.targetGain(levelId), prev ? CROSSFADE_SEC : FADE_IN_SEC);
    }, () => {
      // A failed load stays silent; clearing pendingId lets the next unlock retry.
      if (at === this.seq) this.pendingId = null;
    });
  }

  setLevel(levelId: string): void {
    const next = levelById(this.ambience, levelId) ? levelId : "off";
    if (next === this.levelId) return;
    this.levelId = next;
    if (next === "off") {
      this.seq += 1;
      this.pendingId = null;
      const prev = this.voice;
      this.voice = null;
      prev?.stop(FADE_OUT_SEC);
      return;
    }
    this.play(next);
  }

  setVolume(volume: number): void {
    this.volume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0;
    this.voice?.ramp(this.targetGain(this.levelId), VOLUME_RAMP_SEC);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.voice?.ramp(this.targetGain(this.levelId), MUTE_FADE_SEC);
  }

  async unlock(): Promise<void> {
    this.unlocked = true;
    await this.engine.unlock().catch(() => undefined);
    if (this.levelId !== "off" && !this.voice && !this.pendingId) this.play(this.levelId);
  }

  dispose(): void {
    this.seq += 1;
    this.pendingId = null;
    const prev = this.voice;
    this.voice = null;
    prev?.stop(0);
  }
}
