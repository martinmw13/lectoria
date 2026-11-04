import { describe, expect, it } from "vitest";
import oz from "../data/books/oz/bookmap.json";
import ozScenes from "../data/books/oz/scenes.json";
import { handleCastGet } from "./cast";

interface Entry { id: string; name: string; description: string; known: string[] }

async function cast(sceneId: string): Promise<Entry[]> {
  const res = await handleCastGet(new Request(`http://localhost/api/cast?bookId=oz&sceneId=${sceneId}`));
  expect(res.status).toBe(200);
  return ((await res.json()) as { cast: Entry[] }).cast;
}

const order = (ozScenes as { scenes: { id: string; summary: string }[] }).scenes;

describe("cast api on Oz", () => {
  it("chapter 1 shows only the Kansas household", async () => {
    expect((await cast("c1s1")).map((c) => c.id).sort()).toEqual(["aunt-em", "dorothy", "uncle-henry"]);
  });

  it("never names a character before their first scene, nor any later summary", async () => {
    for (const probe of ["c1s4", "c3s2", "c10s1", order[Math.floor(order.length / 2)]!.id]) {
      const idx = order.findIndex((s) => s.id === probe);
      expect(idx).toBeGreaterThanOrEqual(0);
      const seen = new Set<string>();
      for (const s of order.slice(0, idx + 1)) for (const id of oz.scenes[s.id as keyof typeof oz.scenes]?.characters_present ?? []) seen.add(id);
      const got = await cast(probe);
      for (const c of got) expect(seen.has(c.id)).toBe(true);
      const allowed = new Set(order.slice(0, idx + 1).map((s) => s.summary));
      for (const c of got) for (const line of [c.description, ...c.known]) expect(allowed.has(line)).toBe(true);
      const text = JSON.stringify(got);
      for (const s of order.slice(idx + 1)) if (!allowed.has(s.summary)) expect(text).not.toContain(s.summary);
      expect(text).not.toContain("physical_description");
    }
  });

  it("404s for unknown books and scenes", async () => {
    for (const q of ["bookId=nope&sceneId=c1s1", "bookId=oz&sceneId=c99s1", "bookId=oz&sceneId=x"]) {
      expect((await handleCastGet(new Request(`http://localhost/api/cast?${q}`))).status).toBe(404);
    }
  });
});
