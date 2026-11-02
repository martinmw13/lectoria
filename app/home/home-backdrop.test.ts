// The home backdrop is one full-bleed layer pinned to the viewport, so
// the skin painting never steps where the 1280px desk starts. jsdom does
// no layout, so the rules are pinned against the CSS source.
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const home = strip(readFileSync(new URL("./home.css", import.meta.url), "utf8"));
const backdrop = strip(readFileSync(new URL("./home-backdrop.css", import.meta.url), "utf8"));

function rules(css: string): Array<[string, string]> {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1]!.trim(), m[2]!]);
}

describe("home backdrop", () => {
  it("pins one layer to the whole viewport", () => {
    const base = rules(backdrop).find(([sel]) => sel === ".ob-desk::before");
    expect(base?.[1]).toMatch(/position:\s*fixed/);
    expect(base?.[1]).toMatch(/inset:\s*0/);
    expect(base?.[1]).toMatch(/pointer-events:\s*none/);
  });

  it("keeps the desk capped at 1280px but transparent in every skin", () => {
    const desk = rules(home).find(([sel]) => sel === ".ob-desk");
    expect(desk?.[1]).toMatch(/min\(1280px/);
    expect(desk?.[1]).toMatch(/background:\s*transparent/);
    for (const [sel, body] of rules(home)) {
      if (sel !== ".ob-desk" && /\.ob-desk$/.test(sel)) expect(body).not.toMatch(/background(-image)?\s*:/);
    }
  });

  it("paints chihiro with the sky-lantern alone", () => {
    const chihiro = rules(backdrop).find(([sel]) => sel.includes('"chihiro"') && sel.endsWith("::before"));
    expect(chihiro?.[1]).toContain("sky-lantern.jpg");
    expect(chihiro?.[1]).not.toMatch(/gradient/);
  });

  it.each(["comic", "engraving", "watercolor", "ink", "pencil"])("paints %s with its own home painting", (skin) => {
    const rule = rules(backdrop).find(([sel]) => sel.includes(`"${skin}"`) && sel.endsWith("::before"));
    expect(rule?.[1]).toContain(`/art/skins/${skin}/home.jpg`);
    expect(rule?.[1]).toMatch(/center \/ cover no-repeat/);
    expect(rule?.[1]).not.toMatch(/gradient/);
    const file = new URL(`../../public/art/skins/${skin}/home.jpg`, import.meta.url);
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBeLessThan(400_000);
  });

  it.each(["engraving", "ink"])("gives the %s Style label ink and a paper halo over the hatching", (skin) => {
    const btn = rules(backdrop).find(([sel]) => sel === `html[data-skin="${skin}"] .style-menu-home .style-menu-btn`);
    expect(btn?.[1]).toMatch(/text-shadow:/);
    const key = rules(backdrop).find(([sel]) => sel.includes(`html[data-skin="${skin}"] .style-menu-home .style-menu-key`));
    expect(key?.[1]).toMatch(/color:\s*var\(--color-text\)/);
  });

  it("keeps the pages a touch more opaque over every painted backdrop", () => {
    const alpha = rules(backdrop).find(([, body]) => /--page-alpha:\s*88%/.test(body));
    for (const skin of ["pencil", "chihiro", "comic", "engraving", "watercolor", "ink"]) {
      expect(alpha?.[0]).toContain(`html[data-skin="${skin}"] .ob-desk`);
    }
  });

  it("lets the backdrop show softly through the pages", () => {
    const page = rules(home).find(([sel]) => sel === ".ob-page");
    expect(page?.[1]).toMatch(/color-mix\(in srgb, var\(--paper\) var\(--page-alpha, 9\d%\), transparent\)/);
  });

  it.each(["chihiro", "comic", "engraving", "watercolor", "ink", "pencil"])("paints the %s reader with the home painting", (skin) => {
    const rule = rules(backdrop).find(([sel]) => sel === `html[data-skin="${skin}"] :is(.ob-desk, .folio)::before`);
    expect(rule?.[1]).toMatch(skin === "chihiro" ? /sky-lantern\.jpg/ : new RegExp(`/art/skins/${skin}/home\\.jpg`));
  });

  it("shows the reader backdrop on desktop light only, masked off the folio column", () => {
    const media = backdrop.slice(backdrop.indexOf("@media (min-width: 1024px)"));
    expect(media.length).toBeGreaterThan(0);
    const layer = rules(media).find(([sel]) => sel.endsWith('html:not([data-theme="dark"]) .folio::before'));
    expect(layer?.[1]).toMatch(/content:\s*""/);
    expect(layer?.[1]).toMatch(/position:\s*fixed/);
    expect(layer?.[1]).toMatch(/z-index:\s*-1/);
    expect(layer?.[1]).toMatch(/pointer-events:\s*none/);
    expect(layer?.[1]).toMatch(/(^|[^-])mask-image:[^;]*transparent calc\(50% - var\(--hole\)\), transparent calc\(50% \+ var\(--hole\)\)/);
    // Outside the desktop block no rule gives the reader layer content.
    const before = backdrop.slice(0, backdrop.indexOf("@media (min-width: 1024px)"));
    for (const [sel, body] of rules(before)) if (sel.includes(".folio")) expect(body).not.toMatch(/content:/);
  });

  it("loads the backdrop in the reader layout", () => {
    const layout = readFileSync(new URL("../read/[bookId]/layout.tsx", import.meta.url), "utf8");
    expect(layout).toContain('import "../../home/home-backdrop.css"');
  });
});

