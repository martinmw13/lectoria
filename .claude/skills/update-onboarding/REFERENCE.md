# Update Onboarding — Reference

## The sync marker

`docs/onboarding.html` carries a high-water mark in two places:

- **Hidden** — `<!-- onboarding-sync: <full-sha> <YYYY-MM-DD> -->` just after `<body>`.
  Machine-readable; `sync_report.py` reads it, `set_marker.py` writes it.
- **Visible** — `<p class="synced">Current as of <date> · <short-sha></p>` in the hero,
  so readers see the doc's freshness (styled by the `.hero .synced` CSS rule).

`set_marker.py` only **replaces** these — they are seeded once. If it errors that the
marker is missing, re-seed by hand: add the comment after `<body>`, the
`<p class="synced">` line at the end of the hero, and the `.hero .synced` CSS rule.

The mark is set to the `origin/main` tip at sync time. The doc-sync PR's own
`docs(onboarding): …` commit self-filters on the next run, so there is no gap and no
double-counting — but only run the skill **once per cycle** (twice before the first PR
merges → two competing PRs against the same file).

## Scripts

| Script | Does |
|--------|------|
| `sync_report.py [<days\|ref>]` | resolve the window, list commits/PRs, print the `set_marker.py` command (read-only) |
| `update_diagram.sh <name>` | render `docs/diagrams/<name>.mmd` with a local Chrome, then swap the inline SVG by its `lec-<name>` id |
| `embed_diagram.py <name> <svg>` | the idempotent svgId swap (called by `update_diagram.sh`) |
| `set_marker.py <sha> <date>` | stamp the hidden comment + visible line |

Run all of them from the repo root.

## Diagram pipeline (the hard-won bits)

- Rendering needs a **local** Chrome/Chromium — public renderers (kroki, mermaid.ink)
  are blocked in the sandbox. `update_diagram.sh` discovers Chrome at runtime and fails
  with a clear message if none is found.
- `htmlLabels:false` lives in `docs/diagrams/config.json` and **must** be passed via
  `-c`; the same key inside the `%%{init}%%` directive is silently ignored by
  mermaid-cli. Without it, labels render as `<foreignObject>` HTML that does **not**
  scale with the SVG viewBox and clips when the inline SVG shrinks to the column width.
- `--svgId lec-<name>` gives each diagram unique CSS/marker IDs so three inline SVGs do
  not collide in one document.
- The wrapper CSS (`.mermaid-svg svg text`) pins the font so display widths match
  render-time widths. Keep node/note labels short — sequence note boxes hug their text.
- The diagrams are embedded as **inline SVG** (self-contained, offline, no CDN). The
  doc grows ~150 KB as a result; that is the intended trade-off.

Full render recipe + colour scheme: [docs/diagrams/README.md](../../../docs/diagrams/README.md).

## Content-sync gotchas

- It is a **current-state guide, not a changelog** — describe the system as it is now.
- New `<section id="x">` ⇒ add `<a href="#x">` to the sidebar (scroll-spy + nav).
- Two disk-layout trees to keep in sync: NCM "Disk Storage" and "Data Directory Layout".
- After edits, sanity-check tag balance (`section` / `figure` / `svg` / `tr` open ==
  close) and that every sidebar `href="#…"` has a matching section.

## Shipping

Docs are autonomous but still go through a PR. Work in a worktree, commit with
`--no-verify` (the worktree venv lacks the pre-commit hook), run `just check && just
test`, and open a **draft** PR. Commit message: `docs(onboarding): …`.
