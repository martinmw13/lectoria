import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PORTRAITS, portraitFor } from "./portraits";

const root = join(__dirname, "..");

describe("protagonist portraits", () => {
  it("shows Dorothy's portrait in Oz chapter 1 only", () => {
    expect(portraitFor("oz", "dorothy", 1)).toEqual({
      src: "/portraits/oz.webp",
      large: "/portraits/oz@2x.webp",
    });
    expect(portraitFor("oz", "dorothy", 2)).toBeNull();
    expect(portraitFor("oz", "dorothy", undefined)).toBeNull();
  });

  it("gives Oz a portrait for every character present in chapter 1", () => {
    const map = JSON.parse(readFileSync(join(root, "data/books/oz/bookmap.json"), "utf8")) as {
      scenes: Record<string, { characters_present?: string[] }>;
    };
    const ch1 = new Set(
      Object.entries(map.scenes)
        .filter(([id]) => id.startsWith("c1s"))
        .flatMap(([, x]) => x.characters_present ?? []),
    );
    expect([...ch1].sort()).toEqual(["aunt-em", "dorothy", "toto", "uncle-henry"]);
    expect(ch1.size).toBeGreaterThan(1);
    for (const id of ch1) expect(portraitFor("oz", id, 1), id).not.toBeNull();
    expect(portraitFor("oz", "toto", 2)).toBeNull();
  });

  it("never gives a portrait to anyone but a mapped character", () => {
    expect(portraitFor("oz", "scarecrow", 1)).toBeNull();
    expect(portraitFor("alice", "white-rabbit", 1)).toBeNull();
    expect(portraitFor("unknown-book", "dorothy", 1)).toBeNull();
  });

  it("maps every shelf book to a real bookmap character and a committed image", () => {
    for (const [bookId, list] of Object.entries(PORTRAITS)) {
      if (bookId !== "oz") expect(list, bookId).toHaveLength(1);
      for (const p of list) {
        const map = JSON.parse(readFileSync(join(root, "data/books", bookId, "bookmap.json"), "utf8")) as {
          characters: { id: string; name: string }[];
        };
        const c = map.characters.find((x) => x.id === p.characterId);
        expect(c?.name, bookId).toBe(p.characterName);
        expect(existsSync(join(root, "public", p.src)), p.src).toBe(true);
        const big = join(root, "public", p.large);
        expect(existsSync(big), p.large).toBe(true);
        expect(statSync(big).size, p.large).toBeLessThanOrEqual(60_000);
      }
    }
  });
});
