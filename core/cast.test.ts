import { describe, expect, it } from "vitest";
import { castUpTo, condense, displayName, type CastSceneInput } from "./cast";

const chars = [
  { id: "a", name: "Ann" },
  { id: "b", name: "Bo" },
  { id: "c", name: "Cy" },
];
const scenes: CastSceneInput[] = [
  { id: "c1s1", ch: 1, title: "One", summary: "Ann wakes up early.", present: ["a"] },
  { id: "c1s2", ch: 1, title: "Two", summary: "Ann meets Bo.", present: ["a", "b"] },
  { id: "c2s1", ch: 2, title: "Three", summary: "SECRET: Bo betrays Ann to Cy.", present: ["a", "b", "c"] },
];

describe("castUpTo spoiler filter", () => {
  it("lists only characters met at or before the current scene", () => {
    expect(castUpTo(scenes, chars, "c1s1").map((c) => c.id)).toEqual(["a"]);
    expect(castUpTo(scenes, chars, "c1s2").map((c) => c.id)).toEqual(["a", "b"]);
    expect(castUpTo(scenes, chars, "c2s1").map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("never carries text from a later scene", () => {
    const text = JSON.stringify(castUpTo(scenes, chars, "c1s2"));
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("Cy");
    expect(text).not.toContain("Three");
  });

  it("describes from first sighting and builds known-so-far from later scenes", () => {
    const [ann] = castUpTo(scenes, chars, "c1s2");
    expect(ann?.description).toBe("Ann wakes up early");
    expect(ann?.known).toEqual(["Ann meets Bo"]);
    expect(ann?.scenes).toBe(2);
    expect(ann?.firstSeen).toEqual({ sceneId: "c1s1", ch: 1, title: "One" });
  });

  it("returns nothing for an unknown scene", () => {
    expect(castUpTo(scenes, chars, "c9s9")).toEqual([]);
  });
});

it("turns slug names into words", () => {
  expect(displayName("farm-woman")).toBe("Farm woman");
  expect(displayName("Tin Woodman")).toBe("Tin Woodman");
});

it("condenses to the clause naming the character, cut cleanly under the cap", () => {
  const line = condense("The storm rises, and the Tin Woodman asks for a heart and joins the party on the long road.", "Tin Woodman", 40);
  expect(line).toBe("The Tin Woodman asks for a heart");
  expect(line.length).toBeLessThanOrEqual(40);
  expect(line).not.toMatch(/…|\.\.\.$/);
  expect(condense("Nobody here.", "Tin Woodman", 40)).toBe("");
});
