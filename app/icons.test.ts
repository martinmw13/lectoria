import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BASE_ICONS, ICON_SETS, Icon, iconSkin, type IconName } from "./icons";
import { DEFAULT_SKIN, SKINS } from "./skin";

// app/player.tsx keeps its inline SVGs until its open PR lands, then it
// migrates to the registry. app/button-fx.tsx holds the shared particle
// overlay for the pencil/chihiro art buttons. app/folio/picture-draw.tsx
// is the Picture this drawing canvas, not an icon. app/folio/picture-button.tsx
// holds the per-skin button art until it moves into the registry as a skinned icon.
// app/home/home-defs.tsx holds SVG filter defs, not icons.
// app/home/spread.tsx holds decorative per-skin art (lantern, ink
// underline, read arrows), shown per skin through page CSS.
// app/chat/chat-bubble.tsx holds the chat launcher bubble, restyled per
// skin by CSS classes on its paths, like picture-button.tsx.
// app/chat/ask-art-print.tsx and ask-art-hand.tsx hold the per-skin
// "Ask the book" launcher artwork, like spread.tsx.
// app/folio/classic-music-fx.tsx holds the classic-skin music motion
// overlay, rendered beside ButtonFx instead of an icon.
const ALLOWLIST = new Set([
  "app/icons.tsx",
  "app/button-fx.tsx",
  "app/folio/classic-music-fx.tsx",
  "app/player.tsx",
  "app/folio/picture-draw.tsx",
  "app/folio/picture-button.tsx",
  "app/home/home-defs.tsx",
  "app/home/spread.tsx",
  "app/chat/chat-bubble.tsx",
  "app/chat/ask-art-print.tsx",
  "app/chat/ask-art-hand.tsx",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

describe("icon registry", () => {
  it("renders base icons byte-identical for every skin", () => {
    const names = Object.keys(BASE_ICONS);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const first = renderToStaticMarkup(createElement(Icon, { name: name as IconName, skin: SKINS[0] }));
      for (const skin of SKINS) {
        expect(renderToStaticMarkup(createElement(Icon, { name: name as IconName, skin }))).toBe(first);
      }
    }
  });

  it("falls back to the base set for names a skin does not override", () => {
    const names = Object.keys(BASE_ICONS);
    for (const name of names) {
      const html = renderToStaticMarkup(createElement(Icon, { name: name as IconName }));
      expect(html.startsWith("<svg")).toBe(true);
    }
  });

  it("resolves every rain state for every skin, falling back to the default art", () => {
    expect(readFileSync(new URL("./icons-rain.tsx", import.meta.url), "utf8")).not.toContain(
      "dangerouslySetInnerHTML",
    );
    const rains: IconName[] = ["rain-off", "rain-drizzle", "rain-moderate", "rain-storm"];
    for (const name of rains) {
      for (const skin of SKINS) {
        const html = renderToStaticMarkup(createElement(Icon, { name, skin }));
        expect(html).toContain('viewBox="0 0 100 100"');
        expect(html).toContain('aria-hidden="true"');
        if (iconSkin(name, skin) !== skin) {
          expect(html).toBe(renderToStaticMarkup(createElement(Icon, { name, skin: DEFAULT_SKIN })));
        }
      }
    }
  });

  it("ships its own rain art for every skin", () => {
    for (const skin of SKINS) expect(iconSkin("rain-storm", skin)).toBe(skin);
    expect(iconSkin("moon", "watercolor")).toBe(DEFAULT_SKIN);
    const rains: IconName[] = ["rain-off", "rain-drizzle", "rain-moderate", "rain-storm"];
    const seen = new Set<string>();
    for (const name of rains) {
      for (const skin of SKINS) {
        seen.add(renderToStaticMarkup(createElement(Icon, { name, skin })));
      }
    }
    expect(seen.size).toBe(rains.length * SKINS.length);
  });

  it("carries the class hooks the rain CSS animates", () => {
    for (const skin of SKINS) {
      const storm = renderToStaticMarkup(createElement(Icon, { name: "rain-storm", skin }));
      // Pencil and chihiro are paintings; their particles live in the
      // shared ButtonFx overlay, so the registry icon keeps only the paint.
      const painted = skin === "pencil" || skin === "chihiro";
      for (const cls of painted ? ["paint"] : ["halo", "drop", "bolt"]) {
        expect(storm).toContain(cls);
      }
      if (!painted) expect(storm).toContain("--i");
      const off = renderToStaticMarkup(createElement(Icon, { name: "rain-off", skin }));
      expect(off).not.toContain("bolt");
    }
  });

  it("keeps inline SVGs only in the registry and the allowlist", () => {
    const probe = "<" + "svg";
    const bad: string[] = [];
    for (const file of walk("app")) {
      if (!file.endsWith(".tsx") || ALLOWLIST.has(file)) continue;
      if (readFileSync(file, "utf8").includes(probe)) bad.push(file);
    }
    expect(bad).toEqual([]);
  });
});
