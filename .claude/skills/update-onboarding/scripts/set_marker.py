#!/usr/bin/env python3
"""Stamp the onboarding sync marker: hidden comment + visible "Current as of" line.

Replace-only — both are seeded once in onboarding.html. If a marker is missing this
exits with an error telling you to re-seed (see REFERENCE.md).

Usage: python set_marker.py <full-sha> <YYYY-MM-DD>
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ONBOARDING = Path("docs/onboarding.html")
COMMENT_RE = re.compile(r"<!-- onboarding-sync: \S+ \S+ -->")
SYNCED_RE = re.compile(r'<p class="synced">.*?</p>', re.DOTALL)


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: set_marker.py <full-sha> <YYYY-MM-DD>")
    sha, day = sys.argv[1], sys.argv[2]
    comment = f"<!-- onboarding-sync: {sha} {day} -->"
    synced = f'<p class="synced">Current as of {day} · {sha[:7]}</p>'
    html = ONBOARDING.read_text()
    html, n_comment = COMMENT_RE.subn(lambda _m: comment, html, count=1)
    html, n_synced = SYNCED_RE.subn(lambda _m: synced, html, count=1)
    if not (n_comment and n_synced):
        raise SystemExit(
            f"error: marker not found (comment={n_comment}, synced={n_synced}); "
            "re-seed onboarding.html — see REFERENCE.md"
        )
    ONBOARDING.write_text(html)
    print(f"stamped marker: {sha[:9]} {day}")


if __name__ == "__main__":
    main()
