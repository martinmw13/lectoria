import { describe, expect, it } from "vitest";
import {
  AMBIENCE_DUCK_DB,
  MUSIC_DUCK_DB,
  NARRATION_DUCK_DOWN_MS,
  NARRATION_DUCK_HOLD_MS,
  NARRATION_DUCK_UP_MS,
  duckTarget,
  easeDuck,
} from "./duck";

describe("duckTarget", () => {
  it("keeps the levels: music about 11 dB and rain about 6 dB only while narrating", () => {
    expect(20 * Math.log10(duckTarget(true, MUSIC_DUCK_DB))).toBeCloseTo(-11, 5);
    expect(20 * Math.log10(duckTarget(true, AMBIENCE_DUCK_DB))).toBeCloseTo(-6, 5);
    expect(duckTarget(false, MUSIC_DUCK_DB)).toBe(1);
    expect(duckTarget(false, AMBIENCE_DUCK_DB)).toBe(1);
  });

  it("holds a release long enough to bridge a chunk gap", () => {
    expect(NARRATION_DUCK_HOLD_MS).toBeGreaterThanOrEqual(300);
    expect(NARRATION_DUCK_HOLD_MS).toBeLessThan(NARRATION_DUCK_UP_MS);
  });

  it("eases about one second each way", () => {
    for (const ms of [NARRATION_DUCK_DOWN_MS, NARRATION_DUCK_UP_MS]) {
      expect(ms).toBeGreaterThanOrEqual(800);
      expect(ms).toBeLessThanOrEqual(1200);
    }
  });
});

describe("easeDuck", () => {
  const level = duckTarget(true, MUSIC_DUCK_DB);

  it("starts at the old level and lands on the target at the duration", () => {
    expect(easeDuck(1, level, 0, NARRATION_DUCK_DOWN_MS)).toBe(1);
    expect(easeDuck(1, level, NARRATION_DUCK_DOWN_MS, NARRATION_DUCK_DOWN_MS)).toBe(level);
    expect(easeDuck(level, 1, NARRATION_DUCK_UP_MS * 2, NARRATION_DUCK_UP_MS)).toBe(1);
  });

  it("is halfway at the midpoint and monotonic without overshoot", () => {
    expect(easeDuck(1, level, NARRATION_DUCK_DOWN_MS / 2, NARRATION_DUCK_DOWN_MS)).toBeCloseTo((1 + level) / 2, 9);
    let prev = 1;
    for (let t = 0; t <= NARRATION_DUCK_DOWN_MS; t += 16) {
      const v = easeDuck(1, level, t, NARRATION_DUCK_DOWN_MS);
      expect(v).toBeLessThanOrEqual(prev);
      expect(v).toBeGreaterThanOrEqual(level);
      prev = v;
    }
  });

  it("moves gently at both ends (no click from a sudden step)", () => {
    const d = NARRATION_DUCK_DOWN_MS;
    const span = 1 - level;
    // First and last 16 ms frames move under 1% of the total change.
    expect(1 - easeDuck(1, level, 16, d)).toBeLessThan(span * 0.01);
    expect(easeDuck(1, level, d - 16, d) - level).toBeLessThan(span * 0.01);
  });

  it("jumps on a zero duration", () => {
    expect(easeDuck(0.9, level, 0, 0)).toBe(level);
  });
});
