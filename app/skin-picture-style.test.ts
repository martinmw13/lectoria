import { describe, expect, it } from "vitest";
import { imageKey, parseImageRequest } from "@/core/images";
import { effectiveImageStylePref, requestStyleFields } from "./image-style";

// Scene, panels (chapter) and inline (passage) requests all spread
// requestStyleFields of the one per-skin pref; the server key must follow.
const bodies = {
  scene: { kind: "scene", bookId: "oz", textVersion: "t", sceneId: "c1s1" },
  chapter: { kind: "chapter", bookId: "oz", textVersion: "t", ch: 1, reachedCh: 1 },
  passage: { kind: "passage", bookId: "oz", textVersion: "t", n: 3 },
} as const;

function keyFor(body: Record<string, unknown>, skin: string): string {
  const fields = requestStyleFields(effectiveImageStylePref(null, skin));
  return imageKey(parseImageRequest({ ...body, ...fields }));
}

describe("per-skin picture style reaches the server key", () => {
  for (const [kind, body] of Object.entries(bodies)) {
    it(`${kind}: Watercolor sends watercolor and keys apart from Engraving`, () => {
      expect(requestStyleFields(effectiveImageStylePref(null, "watercolor"))).toEqual({ style: { preset: "watercolor" } });
      const water = keyFor(body, "watercolor");
      const engr = keyFor(body, "engraving");
      expect(water).toContain("style-watercolor");
      expect(engr).not.toContain("style-");
      expect(water).not.toBe(engr);
    });
  }
});
