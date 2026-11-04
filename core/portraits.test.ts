import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PORTRAITS, portraitFor } from "./portraits";

const root = join(__dirname, "..");

describe("protagonist portraits", () => {
  it("shows Dorothy's portrait in Oz chapter 1 only", () => {
    expect(portraitFor("oz", "dorothy", 1)).toBe("/portraits/oz.webp");
    expect(portraitFor("oz", "dorothy", 2)).toBeNull();
    expect(portraitFor("oz", "dorothy", undefined)).toBeNull();
  });

  it("never gives a portrait to anyone but the protagonist", () => {
    expect(portraitFor("oz", "toto", 1)).toBeNull();
    expect(portraitFor("oz", "aunt-em", 1)).toBeNull();
    expect(portraitFor("unknown-book", "dorothy", 1)).toBeNull();
  });

  it("maps every shelf book to a real bookmap character and a committed image", () => {
    for (const [bookId, p] of Object.entries(PORTRAITS)) {
      const map = JSON.parse(readFileSync(join(root, "data/books", bookId, "bookmap.json"), "utf8")) as {
        characters: { id: string; name: string }[];
      };
      const c = map.characters.find((x) => x.id === p.characterId);
      expect(c?.name, bookId).toBe(p.characterName);
      expect(existsSync(join(root, "public", p.src)), p.src).toBe(true);
    }
  });
});
