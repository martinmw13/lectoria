import { describe, expect, it } from "vitest";
import {
  AMBIENCES,
  CROSSFADE_SEC,
  DEFAULT_AMBIENCE_VOLUME,
  FADE_IN_SEC,
  FADE_OUT_SEC,
  MUTE_FADE_SEC,
  ambienceGain,
  ambienceLabel,
  levelById,
  nextLevel,
  parseAmbiencePrefs,
} from "./ambience";

const rain = AMBIENCES[0]!;

describe("ambience", () => {
  it("lists rain levels in cycle order with webm then m4a sources", () => {
    expect(rain.levels.map((level) => level.id)).toEqual(["off", "drizzle", "moderate", "storm"]);
    expect(rain.levels[0]!.sources).toEqual([]);
    for (const level of rain.levels.slice(1)) {
      expect(level.sources.map((source) => source.src)).toEqual([
        `/ambience/v2/rain-${level.id}.webm`,
        `/ambience/v2/rain-${level.id}.m4a`,
      ]);
      expect(level.sources.map((source) => source.type)).toEqual([
        "audio/webm; codecs=opus",
        "audio/mp4",
      ]);
      expect(level.gainDb).toBe(0);
    }
  });

  it("cycles off to drizzle to moderate to storm and back to off", () => {
    expect(nextLevel(rain, "off")).toBe("drizzle");
    expect(nextLevel(rain, "drizzle")).toBe("moderate");
    expect(nextLevel(rain, "moderate")).toBe("storm");
    expect(nextLevel(rain, "storm")).toBe("off");
    expect(nextLevel(rain, "nope")).toBe("drizzle");
  });

  it("labels levels with the ambience name", () => {
    expect(ambienceLabel(rain, "storm")).toBe("Rain: storm");
    expect(ambienceLabel(rain, "off")).toBe("Rain: off");
  });

  it("pins the fade constants and default volume", () => {
    expect(DEFAULT_AMBIENCE_VOLUME).toBe(0.4);
    expect(FADE_IN_SEC).toBe(1.5);
    expect(FADE_OUT_SEC).toBe(1.2);
    expect(CROSSFADE_SEC).toBe(2);
    expect(MUTE_FADE_SEC).toBe(0.3);
  });

  it("scales volume by the dB trim and silences when muted", () => {
    expect(ambienceGain(0.4, false, 0)).toBeCloseTo(0.4);
    expect(ambienceGain(1, false, -20)).toBeCloseTo(0.1);
    expect(ambienceGain(0.4, true, 0)).toBe(0);
    expect(ambienceGain(2, false, 0)).toBe(1);
    expect(ambienceGain(-1, false, 0)).toBe(0);
    expect(ambienceGain(Number.NaN, false, 0)).toBe(0);
  });

  it("parses prefs and falls back for anything invalid", () => {
    expect(parseAmbiencePrefs({ level: "storm", volume: 0.7 })).toEqual({
      level: "storm",
      volume: 0.7,
    });
    const fallback = { level: "off", volume: 0.4 };
    expect(parseAmbiencePrefs(null)).toEqual(fallback);
    expect(parseAmbiencePrefs("storm")).toEqual(fallback);
    expect(parseAmbiencePrefs({})).toEqual(fallback);
    expect(parseAmbiencePrefs({ level: "hail", volume: 0.7 })).toEqual({ level: "off", volume: 0.7 });
    expect(parseAmbiencePrefs({ level: "storm", volume: 2 })).toEqual({ level: "storm", volume: 0.4 });
    expect(parseAmbiencePrefs({ level: "storm", volume: "loud" })).toEqual({
      level: "storm",
      volume: 0.4,
    });
  });

  it("finds levels by id", () => {
    expect(levelById(rain, "moderate")?.color).toBeTruthy();
    expect(levelById(rain, "hail")).toBeNull();
  });
});
