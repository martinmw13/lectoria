// Ducks while the voice plays. Both are multipliers on the user's own
// slider level, so a duck can only lower a source, never raise it, and
// never starts or stops one: paused music and rain that is off stay so.
export const MUSIC_DUCK_DB = 11;
export const AMBIENCE_DUCK_DB = 6;
// Slow enough to read as a fade, not a cut. Restore is a touch slower so
// the music swells back in after the voice stops.
export const NARRATION_DUCK_DOWN_MS = 900;
export const NARRATION_DUCK_UP_MS = 1100;
// A release waits this long before easing back up, so the brief pause
// between chunks (a chapter's audio swap) keeps the duck held instead of
// pumping the music up and down.
export const NARRATION_DUCK_HOLD_MS = 600;

export function duckTarget(narrating: boolean, duckDb: number): number {
  return narrating ? 10 ** (-duckDb / 20) : 1;
}

// Duck level `elapsedMs` into a ramp from `from` to `to`: a smoothstep
// ease-in-out, so the slope is zero at both ends and the change has no
// audible corner. Pure, so the hook and the tests share the curve.
export function easeDuck(from: number, to: number, elapsedMs: number, durationMs: number): number {
  if (!(durationMs > 0) || elapsedMs >= durationMs) return to;
  if (!(elapsedMs > 0)) return from;
  const t = elapsedMs / durationMs;
  return from + (to - from) * t * t * (3 - 2 * t);
}
