import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SKINS } from "./skin";
import { heroArt } from "./skin-art";

describe("heroArt", () => {
  it("gives every skin non-empty orchestra/piano/chopin/narrate strings", () => {
    for (const skin of SKINS) {
      const art = heroArt(skin);
      for (const key of ["orchestra", "piano", "chopin", "narrate"] as const) {
        expect(typeof art[key], `${skin}.${key}`).toBe("string");
        expect(art[key].length, `${skin}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the comic hero art burst-free: the burst only appears on hover", () => {
    for (const src of ["/art/skins/comic/orchestra.svg", "/art/skins/comic/piano.svg", "/art/skins/comic/chopin.svg"]) {
      const svg = readFileSync(join(process.cwd(), "public", src), "utf8");
      expect(svg, src).not.toContain("burst-h");
    }
  });

  it("gives watercolor a painted Chopin face, not the piano drawing", () => {
    const src = heroArt("watercolor").chopin;
    expect(src).toBe("/art/skins/watercolor/chopin.png");
    expect(src).not.toBe(heroArt("watercolor").piano);
    const png = readFileSync(join(process.cwd(), "public", src));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(128);
    expect(png.length).toBeLessThan(40_000);
  });

  it("ships a separate burst SVG per comic music mode", () => {
    for (const src of [
      "/art/skins/comic/burst-yellow.svg",
      "/art/skins/comic/burst-blue.svg",
      "/art/skins/comic/burst-salmon.svg",
    ]) {
      const file = join(process.cwd(), "public", src);
      expect(existsSync(file), src).toBe(true);
      const svg = readFileSync(file, "utf8");
      expect(svg.trimStart().startsWith("<svg"), src).toBe(true);
      expect(svg).not.toMatch(/<script|on\w+=/i);
    }
  });

  it("points every skin's art at a real, well-formed SVG or PNG in public/", () => {
    for (const skin of SKINS) {
      const art = heroArt(skin);
      for (const src of Object.values(art)) {
        const file = join(process.cwd(), "public", src);
        expect(existsSync(file), src).toBe(true);
        if (src.endsWith(".png")) {
          // Raster art (pencil drawings): a real PNG, nothing that can run.
          expect(readFileSync(file).subarray(0, 8).toString("hex"), src).toBe("89504e470d0a1a0a");
          continue;
        }
        const svg = readFileSync(file, "utf8");
        expect(svg.trimStart().startsWith("<svg"), src).toBe(true);
        expect(svg).not.toMatch(/<script|on\w+=/i);
      }
    }
  });
});
