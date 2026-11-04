import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SKINS } from "../app/skin";
import { PORTRAIT_SKINS, PORTRAITS, portraitFor } from "./portraits";

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

  it("keeps the portrait skin list in step with the reader skins", () => {
    expect([...PORTRAIT_SKINS]).toEqual([...SKINS]);
  });

  it("picks the restyled Oz portrait for the active skin, with the realistic one as fallback", () => {
    expect(portraitFor("oz", "toto", 1, "comic")).toEqual({
      src: "/portraits/skins/comic/oz-toto.webp",
      large: "/portraits/skins/comic/oz-toto@2x.webp",
    });
    expect(portraitFor("oz", "dorothy", 1, "not-a-skin")).toEqual({ src: "/portraits/oz.webp", large: "/portraits/oz@2x.webp" });
    expect(portraitFor("oz", "dorothy", 1)).toEqual({ src: "/portraits/oz.webp", large: "/portraits/oz@2x.webp" });
    expect(portraitFor("oz", "dorothy", 2, "ink")).toBeNull();
  });

  it("ships every declared skin copy, thumb and @2x, under 60KB", () => {
    for (const list of Object.values(PORTRAITS))
      for (const p of list)
        for (const skin of p.skins ?? []) {
          for (const path of [p.src, p.large]) {
            const file = join(root, "public", path.replace("/portraits/", `/portraits/skins/${skin}/`));
            expect(existsSync(file), file).toBe(true);
            expect(statSync(file).size, file).toBeLessThanOrEqual(60_000);
          }
        }
  });

  it("restyles all four Oz chapter 1 characters in every skin", () => {
    for (const p of PORTRAITS.oz ?? []) expect([...(p.skins ?? [])], p.characterId).toEqual([...SKINS]);
  });

  it("restyles every book's protagonist in every skin", () => {
    for (const [book, list] of Object.entries(PORTRAITS)) {
      for (const p of list) expect([...(p.skins ?? [])], `${book}/${p.characterId}`).toEqual([...SKINS]);
    }
  });
});
