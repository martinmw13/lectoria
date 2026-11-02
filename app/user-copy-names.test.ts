import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { SKIN_NAMES } from "./style-menu";
import { IMAGE_STYLE_PRESETS } from "@/core/image-style";

// The chihiro skin is shown to readers and judges as "Lantern dusk". The id
// `chihiro` (lowercase) may stay in code, CSS selectors and asset paths, but
// the capitalised name and the film or studio it came from must never reach
// user-facing copy: labels, alt text, aria-labels, titles or the README.
const ROOT = join(__dirname, "..");
const BANNED = /Chihiro|Ghibli|Spirited Away|Miyazaki/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

// Drop comments so explanatory notes about the skin id do not count.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("user-facing copy never names Chihiro", () => {
  it("labels the chihiro skin Lantern dusk", () => {
    expect(SKIN_NAMES.chihiro).toBe("Lantern dusk");
    for (const name of Object.values(SKIN_NAMES)) expect(name).not.toMatch(BANNED);
    for (const preset of IMAGE_STYLE_PRESETS) expect(`${preset.label} ${preset.descriptor}`).not.toMatch(BANNED);
  });

  it("keeps the name out of app and server strings", () => {
    // core/style-prompts.ts is the server-only image prompt, never shown.
    const files = [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "server"))];
    const hits = files
      .filter((f) => BANNED.test(stripComments(readFileSync(f, "utf8"))))
      .map((f) => relative(ROOT, f));
    expect(hits).toEqual([]);
  });

  it("keeps the name out of the README and shelf data", () => {
    for (const f of ["README.md", "data/library.json"]) {
      expect(readFileSync(join(ROOT, f), "utf8")).not.toMatch(BANNED);
    }
  });
});
