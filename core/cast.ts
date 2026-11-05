// The cast codex: who the reader has met so far, built only from scenes
// at or before the current one. Pure, no LLM, no network. A character's
// bookmap physical_description is never used: it is written with the
// whole book in view and can spoil (Oz's "false forms"), so every line
// here comes from a scene summary the reader has already passed.
export interface CastSceneInput {
  id: string;
  ch: number;
  title: string;
  summary: string;
  /** Bookmap character ids present in this scene. */
  present: string[];
}

export interface CastCharacterInput {
  id: string;
  name: string;
}

export interface CastEntry {
  id: string;
  name: string;
  firstSeen: { sceneId: string; ch: number; title: string };
  /** The summary of the scene where the reader first met them. */
  description: string;
  /** Later summaries they appear in, oldest first, the latest few only. */
  known: string[];
  /** Scenes so far that include them. */
  scenes: number;
}

export const CAST_KNOWN_MAX = 3;
/** Hard caps, in characters, for the who line and each known bullet. */
export const CAST_WHO_MAX = 80;
export const CAST_KNOWN_CHARS = 60;

// Characters in order of first appearance. Unknown scene ids yield an
// empty cast: we never guess a position and risk showing too much.
export function castUpTo(scenes: CastSceneInput[], characters: CastCharacterInput[], currentId: string): CastEntry[] {
  const end = scenes.findIndex((s) => s.id === currentId);
  if (end < 0) return [];
  const byId = new Map(characters.map((c) => [c.id, c]));
  const out = new Map<string, CastEntry & { all: string[] }>();
  for (const scene of scenes.slice(0, end + 1)) {
    for (const id of new Set(scene.present)) {
      const ch = byId.get(id);
      if (!ch) continue;
      const hit = out.get(id);
      if (!hit) {
        out.set(id, {
          id,
          name: displayName(ch.name),
          firstSeen: { sceneId: scene.id, ch: scene.ch, title: scene.title },
          description: condense(scene.summary, ch.name, CAST_WHO_MAX),
          known: [],
          all: [],
          scenes: 1,
        });
      } else {
        hit.scenes += 1;
        if (!hit.description) {
          hit.description = condense(scene.summary, ch.name, CAST_WHO_MAX);
          continue;
        }
        const line = condense(scene.summary, ch.name, CAST_KNOWN_CHARS);
        if (line && line !== hit.description && !hit.all.includes(line)) hit.all.push(line);
      }
    }
  }
  return [...out.values()].map(({ all, ...entry }) => ({
    ...entry,
    description: entry.description || `First met in “${entry.firstSeen.title}”`,
    known: all.slice(-CAST_KNOWN_MAX),
  }));
}

// Some bookmap names are bare slugs ("farm-woman"); show them as words.
export function displayName(name: string): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return name;
  const words = name.split("-").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const TRAILING = /\s+(and|or|but|the|a|an|of|to|in|on|at|with|for|from|by|as|while|that|who|her|his|their|its|into)$/i;

function nameKey(name: string): string {
  const words = displayName(name).split(/\s+/);
  const skip = new Set(["the", "of", "with", "a"]);
  // The last capitalized word is the distinctive one: "East" in Wicked
  // Witch of the East, "Henry" in Uncle Henry.
  const caps = words.filter((w) => !skip.has(w.toLowerCase()) && /^[A-Z]/.test(w));
  return (caps[caps.length - 1] ?? words[0] ?? "").toLowerCase();
}

export function mentions(summary: string, name: string): boolean {
  const key = nameKey(name);
  return key.length > 1 && summary.toLowerCase().includes(key);
}

// Deterministic shortening: the clause that names the character, cut on
// a word boundary under max, with no dangling small words or ellipsis.
// Empty when no clause of at least three words names them. The result is
// always words from an already-allowed summary, never anything new.
const LEADING = /^(and|but|while|so|which|who|then|as|or|now|also|that)\s+/i;

export function condense(summary: string, name: string, max: number): string {
  const key = nameKey(name);
  if (key.length < 2) return "";
  const clauses = summary
    .split(/[.;:!?]\s+|,\s+|\s+(?:while|but|then|as|until|before|after|when|where|so)\s+/)
    .map((c) => {
      let t = c.trim().replace(/[.;:,!?]+$/, "");
      let prev = "";
      while (prev !== t) {
        prev = t;
        t = t.replace(LEADING, "");
      }
      return t;
    })
    .filter((c) => c.split(/\s+/).length >= 3 && c.toLowerCase().includes(key));
  const ranked = [...clauses].sort((x, y) => x.toLowerCase().indexOf(key) - y.toLowerCase().indexOf(key));
  let out = ranked[0] ?? "";
  if (!out) return "";
  if (out.length > max) {
    const cut = out.slice(0, max + 1);
    out = cut.slice(0, Math.max(cut.lastIndexOf(" "), 0));
  }
  let prev = "";
  while (prev !== out) {
    prev = out;
    out = out.replace(TRAILING, "").replace(/[\s,;:'"\u2019-]+$/, "");
  }
  if (!out.toLowerCase().includes(key)) return "";
  return out.charAt(0).toUpperCase() + out.slice(1);
}
