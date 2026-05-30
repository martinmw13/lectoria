# Onboarding diagrams

Mermaid sources for the diagrams embedded in `docs/onboarding.html`.

| Source | Diagram |
|--------|---------|
| `system.mmd`   | System architecture (browser → routes → services + BookStore → providers → Gemini → `data/`) |
| `pipeline.mmd` | Two-stage LLM pipeline (EPUB → ingestion → LLM 1 → LLM 2 → assembly → NCM) |
| `byok.mmd`     | BYOK per-request key flow (sequence diagram) |

## Regenerate

The diagrams are embedded in `onboarding.html` as **inline SVG** (self-contained, no
runtime dependency). To edit one, change its `.mmd` here, re-render to SVG, and replace
the corresponding `<svg id="lec-…">` block in `onboarding.html`.

Rendering needs [`mermaid-cli`](https://github.com/mermaid-js/mermaid-cli) and a local
Chrome/Chromium (point Puppeteer at it — `mmdc` does not bundle a browser here):

```bash
# one config reused for every diagram; set the path to your local Chrome
printf '{"executablePath":"%s","args":["--no-sandbox"]}' "$(command -v google-chrome || command -v chromium)" > /tmp/pptr.json

for d in system pipeline byok; do
  npx -y @mermaid-js/mermaid-cli -p /tmp/pptr.json -c config.json --svgId "lec-$d" -i "$d.mmd" -o "$d.svg"
done
```

Two flags are load-bearing:

- **`-c config.json`** sets `htmlLabels: false`, so labels render as SVG `<text>` instead
  of `<foreignObject>` HTML. Inline `<foreignObject>` does **not** scale with the SVG
  viewBox and inherits the host page's CSS, which clips the labels — SVG `<text>` scales
  cleanly. (The same `htmlLabels` key inside the `%%{init}%%` directive is silently ignored
  by mermaid-cli, so it must live in the config file.)
- **`--svgId lec-<name>`** scopes each SVG's internal CSS and marker IDs so the three
  diagrams can coexist inline in one HTML document without colliding.

The wrapper CSS in `onboarding.html` (`.mermaid-svg svg text`) pins the font family so the
text widths at display match the widths measured at render time.
