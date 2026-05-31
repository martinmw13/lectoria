#!/usr/bin/env python3
"""Swap the <svg id="lec-<name>"> block in onboarding.html with a rendered SVG.

Idempotent: it matches the existing inline SVG by its svgId and replaces it in place,
so it re-runs cleanly on every diagram update (no ASCII-anchor assumptions).

Usage: python embed_diagram.py <name> <svg-file>
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ONBOARDING = Path("docs/onboarding.html")


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: embed_diagram.py <name> <svg-file>")
    name, svg_path = sys.argv[1], sys.argv[2]
    raw = Path(svg_path).read_text()
    new_svg = raw[raw.index("<svg") :].strip()
    pattern = re.compile(rf'<svg id="lec-{re.escape(name)}".*?</svg>', re.DOTALL)
    html = ONBOARDING.read_text()
    html, n = pattern.subn(lambda _m: new_svg, html, count=1)
    if n != 1:
        raise SystemExit(
            f'error: <svg id="lec-{name}"> not found in onboarding.html '
            "(is that diagram embedded as a <figure> yet?)"
        )
    ONBOARDING.write_text(html)
    print(f"embedded lec-{name} ({len(new_svg)} bytes)")


if __name__ == "__main__":
    main()
