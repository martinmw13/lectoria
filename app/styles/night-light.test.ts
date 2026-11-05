// Night Light (page warmth): one full-viewport layer for every skin.
// Pinned against the CSS source, like narrow-layout.test.ts.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dir = new URL("./", import.meta.url);
const css = readFileSync(new URL("./warmth.css", dir), "utf8");
const rule = (sel: string) => {
  const i = css.indexOf(`${sel} {`);
  if (i < 0) throw new Error(`no rule ${sel}`);
  return css.slice(i, css.indexOf("}", i));
};

describe("night light", () => {
  it("covers the whole viewport above every element without eating input", () => {
    const r = rule("html::after");
    expect(r).toMatch(/position:\s*fixed/);
    expect(r).toMatch(/inset:\s*0/);
    expect(r).toMatch(/z-index:\s*2147483647/);
    expect(r).toMatch(/pointer-events:\s*none/);
    expect(r).toMatch(/opacity:\s*calc\(var\(--warmth\)/);
  });

  it("is not scoped to any skin or to the reading column", () => {
    expect(css).not.toMatch(/data-skin[^{]*\{[^}]*--warmth[^}]*\}[^]*?background/);
    expect(css).not.toMatch(/\.read-col/);
    expect(css).not.toMatch(/body::before/);
  });

  it("no skin overrides --warmth or hides the overlay", () => {
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".css") && n !== "warmth.css")) {
      const src = readFileSync(new URL(f, dir), "utf8");
      expect(src, f).not.toMatch(/--warmth\s*:/);
      expect(src, f).not.toMatch(/html(\[[^\]]*\])*::after/);
    }
  });
});
