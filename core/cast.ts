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
          description: scene.summary,
          known: [],
          all: [],
          scenes: 1,
        });
      } else {
        hit.scenes += 1;
        if (scene.summary) hit.all.push(scene.summary);
      }
    }
  }
  return [...out.values()].map(({ all, ...entry }) => ({ ...entry, known: all.slice(-CAST_KNOWN_MAX) }));
}

// Some bookmap names are bare slugs ("farm-woman"); show them as words.
export function displayName(name: string): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return name;
  const words = name.split("-").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
