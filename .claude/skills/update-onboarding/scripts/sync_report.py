#!/usr/bin/env python3
"""Resolve the onboarding sync window and report the changes to review.

Usage:
    python sync_report.py            # since the marker in onboarding.html (or last edit)
    python sync_report.py 7          # last 7 days
    python sync_report.py v0.2.1     # since a tag / commit
"""

from __future__ import annotations

import re
import subprocess
import sys
from datetime import date
from pathlib import Path

ONBOARDING = Path("docs/onboarding.html")
SCRIPT = ".claude/skills/update-onboarding/scripts/set_marker.py"
MARKER_RE = re.compile(r"<!-- onboarding-sync: (\S+) \S+ -->")
PR_RE = re.compile(r"\(#(\d+)\)")


def git(*args: str) -> str:
    result = subprocess.run(["git", *args], capture_output=True, text=True, check=True)
    return result.stdout.strip()


def head_sha() -> str:
    for ref in ("origin/main", "HEAD"):
        try:
            return git("rev-parse", ref)
        except subprocess.CalledProcessError:
            continue
    raise SystemExit("error: cannot resolve origin/main or HEAD")


def marker_sha() -> str | None:
    if not ONBOARDING.exists():
        return None
    match = MARKER_RE.search(ONBOARDING.read_text())
    return match.group(1) if match else None


def resolve_base(since: str | None, head: str) -> tuple[list[str], str]:
    """Return (git-log range args, human description of the window)."""
    if since and since.isdigit():
        return [f"--since={since} days ago", head], f"last {since} days"
    if since:
        return [f"{since}..{head}"], f"since {since}"
    base = marker_sha() or git("log", "-1", "--format=%H", "--", str(ONBOARDING))
    return [f"{base}..{head}"], f"since {base[:9]}"


def main() -> None:
    since = sys.argv[1] if len(sys.argv) > 1 else None
    today = date.today().isoformat()
    head = head_sha()
    log_args, base_desc = resolve_base(since, head)
    log = git("log", *log_args, "--pretty=format:%h %ad %s", "--date=short")
    prs = sorted({int(n) for n in PR_RE.findall(log)})
    print(f"HEAD (sync up to):   {head[:9]}  ({head})")
    print(f"window:              {base_desc}")
    print(f"date today:          {today}")
    print(f"merged PRs in range: {prs or 'none'}")
    print("\n--- commits to triage (keep the mental-model-changing ones) ---")
    print(log or "(no commits in range)")
    print("\n--- after a successful sync, stamp the marker: ---")
    print(f"python {SCRIPT} {head} {today}")


if __name__ == "__main__":
    main()
