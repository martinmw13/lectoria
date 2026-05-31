#!/usr/bin/env bash
# Regenerate one onboarding diagram and swap it into docs/onboarding.html in place.
#
# Renders docs/diagrams/<name>.mmd with a LOCAL Chrome (public renderers such as kroki
# are blocked in the sandbox), then embeds by svgId via embed_diagram.py (idempotent).
#
# Usage: update_diagram.sh <name>      # name is system | pipeline | byok
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
name="${1:?usage: update_diagram.sh <name>   (system | pipeline | byok)}"
dir="docs/diagrams"
src="$dir/$name.mmd"
[ -f "$src" ] || { echo "error: $src not found (run from the repo root)" >&2; exit 1; }

chrome="$(command -v google-chrome || command -v google-chrome-stable \
  || command -v chromium || command -v chromium-browser || true)"
[ -n "$chrome" ] || { echo "error: no local Chrome/Chromium found; mmdc needs one" >&2; exit 1; }

pptr="$(mktemp)"
svg="$(mktemp --suffix=.svg)"
trap 'rm -f "$pptr" "$svg"' EXIT
printf '{"executablePath":"%s","args":["--no-sandbox","--disable-gpu"]}' "$chrome" >"$pptr"

# -c config.json => htmlLabels:false: labels become SVG <text> that scale with the
#   viewBox (the same key inside the %%{init}%% directive is ignored by mermaid-cli).
# --svgId lec-<name> => unique CSS/marker IDs so the diagrams coexist inline.
npx -y @mermaid-js/mermaid-cli@latest -p "$pptr" -c "$dir/config.json" \
  --svgId "lec-$name" -i "$src" -o "$svg"

python3 "$here/embed_diagram.py" "$name" "$svg"
