// Pure rain ambience model: levels, fades, prefs. No DOM, no env, no
// network, so tests run it directly. Adding fireplace later is one entry.
export interface AmbienceSource {
  src: string;
  type: string;
}

export interface AmbienceLevel {
  id: string;
  label: string;
  color: string;
  sources: AmbienceSource[];
  gainDb: number;
}

export interface Ambience {
  id: string;
  label: string;
  levels: AmbienceLevel[];
}

export const DEFAULT_AMBIENCE_VOLUME = 0.4;
export const FADE_IN_SEC = 1.5;
export const FADE_OUT_SEC = 1.2;
export const CROSSFADE_SEC = 2;
export const MUTE_FADE_SEC = 0.3;
export const VOLUME_RAMP_SEC = 0.1;

const WEBM: AmbienceSource = { src: "", type: "audio/webm; codecs=opus" };

function rainLevel(id: string, color: string): AmbienceLevel {
  return {
    id,
    label: id,
    color,
    sources: [
      { ...WEBM, src: `/ambience/v2/rain-${id}.webm` },
      { src: `/ambience/v2/rain-${id}.m4a`, type: "audio/mp4" },
    ],
    gainDb: 0,
  };
}

export const AMBIENCES: Ambience[] = [
  {
    id: "rain",
    label: "Rain",
    levels: [
      { id: "off", label: "off", color: "#9aa4ae", sources: [], gainDb: 0 },
      rainLevel("drizzle", "#5ab8f0"),
      rainLevel("moderate", "#f2c230"),
      rainLevel("storm", "#e5484d"),
    ],
  },
];

export function levelById(ambience: Ambience, levelId: string): AmbienceLevel | null {
  return ambience.levels.find((level) => level.id === levelId) ?? null;
}

// Cycle order is the levels array: off -> drizzle -> moderate -> storm.
export function nextLevel(ambience: Ambience, levelId: string): string {
  const at = ambience.levels.findIndex((level) => level.id === levelId);
  if (at < 0) return "drizzle";
  return ambience.levels[(at + 1) % ambience.levels.length]?.id ?? levelId;
}

export function ambienceLabel(ambience: Ambience, levelId: string): string {
  const level = levelById(ambience, levelId);
  return `${ambience.label}: ${level?.label ?? levelId}`;
}

// Muted is silence; otherwise the clamped volume scaled by the dB trim.
export function ambienceGain(volume: number, muted: boolean, gainDb: number): number {
  if (muted) return 0;
  const clamped = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0;
  return clamped * 10 ** (gainDb / 20);
}

export interface AmbiencePrefs {
  level: string;
  volume: number;
}

function validLevel(value: unknown): string | null {
  const ids = AMBIENCES.flatMap((ambience) => ambience.levels.map((level) => level.id));
  return typeof value === "string" && ids.includes(value) ? value : null;
}

function validVolume(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

// Anything invalid falls back to off at the default volume, never throws.
export function parseAmbiencePrefs(value: unknown): AmbiencePrefs {
  const fallback = { level: "off", volume: DEFAULT_AMBIENCE_VOLUME };
  if (typeof value !== "object" || value === null) return fallback;
  const { level, volume } = value as Record<string, unknown>;
  return {
    level: validLevel(level) ?? fallback.level,
    volume: validVolume(volume) ?? fallback.volume,
  };
}
