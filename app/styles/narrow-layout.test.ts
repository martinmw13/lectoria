// Narrow reader (below 1024px): single column, condensed header, chat
// bottom sheet. No DOM setup in this repo, so the rules are pinned
// against the CSS source directly, like book-view-skin.test.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const folio = readFileSync(new URL("./folio.css", import.meta.url), "utf8");
const chat = readFileSync(new URL("./chat.css", import.meta.url), "utf8");

// The @media (max-width: 1023px) block, brace-matched.
function narrow(css: string): string {
  const start = css.indexOf("@media (max-width: 1023px)");
  if (start < 0) throw new Error("no narrow block");
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css.charAt(i) === "{") depth++;
    else if (css.charAt(i) === "}") {
      depth--;
      if (depth === 0) return css.slice(open, i + 1);
    }
  }
  throw new Error("unbalanced narrow block");
}

describe("narrow reader layout", () => {
  it("stacks the folio into one column", () => {
    const css = narrow(folio);
    expect(css).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(css).toMatch(/grid-template-areas:\s*"top"\s*"pager"\s*"read"\s*"play"/);
  });

  it("hides the pane, divider and margin so the text keeps full width", () => {
    const css = narrow(folio);
    expect(css).toMatch(/\.img-pane,[\s\S]*?\.pane-divider,[\s\S]*?\.vault\s*\{[\s\S]*?display:\s*none/);
  });

  it("condenses the header instead of clipping it", () => {
    const css = narrow(folio);
    expect(css).toMatch(/\.top-line\s*\{[^}]*gap:\s*8px/);
    expect(css).toMatch(/\.wordmark\s*\{[^}]*font-size:\s*18px/);
    expect(css).toMatch(/\.style-menu-key\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/\.warmth input\s*\{[^}]*width:\s*44px/);
  });

  it("keeps the desktop grid above 1024px", () => {
    expect(folio).toContain("grid-template-columns: var(--pane-w) 12px minmax(0, 1fr) 200px");
  });
});

describe("narrow chat sheet", () => {
  it("shows the launcher instead of hiding chat", () => {
    expect(narrow(chat)).not.toMatch(/\.reader-chat\s*\{[^}]*display:\s*none/);
  });

  it("opens the panel as a bottom sheet", () => {
    const css = narrow(chat);
    expect(css).toMatch(/\.chat-panel\s*\{[^}]*position:\s*fixed/);
    expect(css).toMatch(/\.chat-panel\s*\{[^}]*max-height:\s*70dvh/);
    expect(css).toMatch(/\.chat-panel\s*\{[^}]*padding-bottom:\s*env\(safe-area-inset-bottom\)/);
  });

  it("hides the launcher while the sheet is open", () => {
    expect(narrow(chat)).toMatch(/\.reader-chat:has\(\.chat-panel\) \.chat-launch\s*\{[^}]*display:\s*none/);
  });

  it("turns the sheet animation off under prefers-reduced-motion", () => {
    expect(chat).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.chat-panel \{[\s\S]*?animation:\s*none !important/,
    );
  });

  it("keeps the desktop panel size (default, user-resizable)", () => {
    expect(chat).toContain("width: var(--chat-w, 380px)");
  });
});

// The six skins may only paint the reader chrome they restyle; layout
// props there would silently beat the narrow rules, which load earlier.
const SKINS = ["engraving", "watercolor", "ink", "pencil", "comic", "chihiro"] as const;
const NO_DISPLAY = ["img-pane", "pane-divider", "vault", "chat-launch"];
const NO_GEOMETRY = ["chat-panel", "reader-chat"];
const NO_GRID = ["folio", "read-col", "top-line", "band-play", "band-pager"];

function declsFor(css: string, cls: string): string[] {
  const out: string[] = [];
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const sel = new RegExp(`\\.${cls}(?![\\w-])`);
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = rule.exec(stripped))) {
    const selector = m[1] ?? "";
    const decls = m[2] ?? "";
    if (sel.test(selector)) out.push(decls);
  }
  return out;
}

describe.each(SKINS)("skin %s keeps the narrow layout", (skin) => {
  const css = readFileSync(new URL(`./skin-${skin}.css`, import.meta.url), "utf8");

  it("never un-hides a narrow-hidden column", () => {
    for (const cls of NO_DISPLAY) {
      for (const decls of declsFor(css, cls)) {
        expect(decls).not.toMatch(/display\s*:/);
      }
    }
  });

  it("never resizes or repositions the chat sheet", () => {
    for (const cls of NO_GEOMETRY) {
      for (const decls of declsFor(css, cls)) {
        expect(decls).not.toMatch(/(display|position|width|max-width|height|max-height)\s*:/);
      }
    }
  });

  it("never re-grids the folio", () => {
    for (const cls of NO_GRID) {
      for (const decls of declsFor(css, cls)) {
        expect(decls).not.toMatch(/(display|position|grid-template|grid-area)\s*:/);
      }
    }
  });
});
