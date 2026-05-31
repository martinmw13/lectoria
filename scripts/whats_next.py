#!/usr/bin/env python3
"""`just next` — derive eligible / parallel-safe issues from the live tracker.

Automates the work-selection method in `docs/agents/picking-work.md` so
"what's next / what's parallel-safe" is a one-command derivation instead of a
by-hand computation. Reads `ready-for-agent` issues plus their `## Blocked by`
and `## Touches` sections, cross-references closed issues and open PRs, and
prints four sections: Available now, In flight, Blocked, Parallel-safe groups.

`gh` I/O is confined to the `fetch_*` functions at the edges; the derivation
(`parse_*`, bucketing, parallel grouping) is pure and unit-tested on canned
JSON — no live `gh` calls in the tests.
"""

import json
import re
import subprocess
import sys
from dataclasses import dataclass

REPO = "martinmw13/lectoria"
READY_LABEL = "ready-for-agent"

_HEADING_RE = re.compile(r"^#{2,}\s")
_HR_RE = re.compile(r"^(-{3,}|\*{3,}|_{3,})$")
_ISSUE_REF_RE = re.compile(r"#(\d+)")
# GitHub closing keywords: close/closes/closed, fix/fixes/fixed, resolve/...
_CLOSING_RE = re.compile(r"(?i)\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)")
_PAREN_NOTE_RE = re.compile(r"\([^)]*\)")  # "(new)", "(derivation test)"
_INLINE_TOUCHES_RE = re.compile(r"(?im)^\s*\*{0,2}touches:\*{0,2}\s*(.+)$")
_TOUCH_PREFIX_RE = re.compile(r"(?i)^\+?\s*(?:new\s+)?")  # "+ new <file>" markers


@dataclass(frozen=True)
class Issue:
    number: int
    title: str
    blocked_by: frozenset[int]
    touches: frozenset[str]
    has_touches: bool


@dataclass
class Buckets:
    available: list[Issue]
    in_flight: list[tuple[Issue, list[int]]]  # (issue, open PR numbers)
    blocked: list[tuple[Issue, list[int]]]  # (issue, open blocker numbers)


# --- parsing (pure) --------------------------------------------------------


def extract_section(body: str, heading: str) -> str | None:
    """Return the text under a `## <heading>` section, or None if absent.

    Capture stops at the next `##`+ heading, a horizontal rule, or a blockquote
    line (`>`). Blockers/touches are written as plain lines first; a trailing
    `> Heavy contention` Coordination note (cf. #69) — including its lazy
    continuation lines — would otherwise pollute the `#N` / file extraction.
    """
    target = heading.strip().lower()
    out: list[str] = []
    capturing = False
    for line in body.splitlines():
        stripped = line.strip()
        if _HEADING_RE.match(stripped):
            if capturing:
                break
            capturing = stripped.lstrip("#").strip().lower() == target
            continue
        if capturing:
            if _HR_RE.match(stripped) or stripped.startswith(">"):
                break
            out.append(line)
    return "\n".join(out).strip() if capturing else None


def parse_blocked_by(body: str) -> frozenset[int]:
    """Issue numbers under `## Blocked by`. `None`/empty/absent → no blockers."""
    section = extract_section(body, "Blocked by")
    if section is None:
        return frozenset()
    return frozenset(int(n) for n in _ISSUE_REF_RE.findall(section))


def _inline_touches(body: str) -> str | None:
    """Fallback for issues that write an inline `**Touches:**` line instead of
    a `## Touches` heading (both forms occur in the tracker, cf. #63). Returns
    the file list that follows the marker, or None.
    """
    match = _INLINE_TOUCHES_RE.search(body)
    return match.group(1) if match else None


def _clean_token(raw: str) -> str:
    """Normalize one comma-separated touch token: drop backticks, a leading
    `+`/`new` new-file marker, and a single trailing sentence period (without
    eating a leading `.` as in `.github/workflows/ci.yml`).
    """
    token = _TOUCH_PREFIX_RE.sub("", raw.replace("`", " ").strip()).strip()
    return token[:-1].strip() if token.endswith(".") else token


def parse_touches(body: str) -> tuple[frozenset[str], bool]:
    """Return (normalized touch tokens, found_section).

    Reads the `## Touches` section, falling back to an inline `**Touches:**`
    line. `found_section` is False when neither exists — the caller flags
    these rather than dropping them (per picking-work.md). Parenthetical
    annotations are stripped *before* splitting so a comma inside `(... , ...)`
    (cf. #66) does not fracture a path.
    """
    section = extract_section(body, "Touches")
    if section is None:
        section = _inline_touches(body)
    if section is None:
        return frozenset(), False
    cleaned = _PAREN_NOTE_RE.sub(" ", section.replace("\n", " "))
    tokens = {token for raw in cleaned.split(",") if (token := _clean_token(raw))}
    return frozenset(tokens), True


def parse_issue(raw: dict) -> Issue:
    """Build an Issue from a `gh issue list --json number,title,body` record."""
    body = raw.get("body") or ""
    touches, has_touches = parse_touches(body)
    return Issue(
        number=raw["number"],
        title=raw["title"],
        blocked_by=parse_blocked_by(body),
        touches=touches,
        has_touches=has_touches,
    )


def pr_issue_refs(pr: dict) -> set[int]:
    """Issues an open PR is handling: closing-keyword refs in the body, plus
    any pure-digit segment of the branch name (fallback). Plain `#N` mentions
    without a closing keyword are ignored (they are usually cross-references).
    """
    refs = {int(n) for n in _CLOSING_RE.findall(pr.get("body") or "")}
    for seg in re.split(r"[-_/]", pr.get("headRefName") or ""):
        if seg.isdigit():
            refs.add(int(seg))
    return refs


# --- derivation (pure) -----------------------------------------------------


def build_pr_refs(prs: list[dict]) -> dict[int, list[int]]:
    """Map issue number -> [open PR numbers handling it]."""
    refs: dict[int, list[int]] = {}
    for pr in prs:
        for issue_num in pr_issue_refs(pr):
            refs.setdefault(issue_num, []).append(pr["number"])
    return refs


def classify(issues: list[Issue], closed: set[int], pr_refs: dict[int, list[int]]) -> Buckets:
    """Partition issues: Blocked (any open blocker) → In flight (open PR) →
    Available. Precedence guarantees each issue lands in exactly one bucket.
    """
    available: list[Issue] = []
    in_flight: list[tuple[Issue, list[int]]] = []
    blocked: list[tuple[Issue, list[int]]] = []
    for iss in issues:
        open_blockers = sorted(b for b in iss.blocked_by if b not in closed)
        if open_blockers:
            blocked.append((iss, open_blockers))
        elif prs := sorted(pr_refs.get(iss.number, [])):
            in_flight.append((iss, prs))
        else:
            available.append(iss)
    return Buckets(available, in_flight, blocked)


def unblocks(number: int, issues: list[Issue]) -> list[int]:
    """Issue numbers whose `Blocked by:` names this one."""
    return sorted(i.number for i in issues if number in i.blocked_by)


def overlaps(a: Issue, b: Issue) -> bool:
    """Two issues conflict (cannot run together) when their `Touches:` sets
    share a token, or when either has no declared Touches (cannot prove safe).
    """
    if not a.has_touches or not b.has_touches:
        return True
    return bool(a.touches & b.touches)


def _bron_kerbosch(
    r: set[int], p: set[int], x: set[int], adj: dict[int, set[int]], out: list[list[int]]
) -> None:
    """Enumerate maximal cliques of the compatibility graph into `out`."""
    if not p and not x:
        out.append(sorted(r))
        return
    pivot = next(iter(p | x))
    for v in list(p - adj[pivot]):
        _bron_kerbosch(r | {v}, p & adj[v], x & adj[v], adj, out)
        p = p - {v}
        x = x | {v}


def parallel_groups(issues: list[Issue]) -> list[list[int]]:
    """Maximal sets of issues that can all run concurrently — pairwise
    non-overlapping `Touches:`. Each group is a maximal clique in the
    compatibility graph (edge = parallel-safe pair). Larger groups first.
    """
    if not issues:  # Bron–Kerbosch would otherwise emit one empty clique
        return []
    compat = {
        a.number: {b.number for b in issues if a.number != b.number and not overlaps(a, b)}
        for a in issues
    }
    groups: list[list[int]] = []
    _bron_kerbosch(set(), {i.number for i in issues}, set(), compat, groups)
    groups.sort(key=lambda g: (-len(g), g))
    return groups


# --- gh I/O (edges) --------------------------------------------------------


_GH_TIMEOUT = 30  # seconds — bound the network call so `just next` cannot hang


def _gh_json(args: list[str]) -> list[dict]:
    proc = subprocess.run(
        ["gh", *args], capture_output=True, text=True, check=True, timeout=_GH_TIMEOUT
    )
    return json.loads(proc.stdout)


def fetch_ready_issues() -> list[Issue]:
    raw = _gh_json(
        [
            "issue",
            "list",
            "--repo",
            REPO,
            "--label",
            READY_LABEL,
            "--state",
            "open",
            "--limit",
            "200",
            "--json",
            "number,title,body",
        ]
    )
    return [parse_issue(r) for r in raw]


def fetch_closed_numbers() -> set[int]:
    raw = _gh_json(
        ["issue", "list", "--repo", REPO, "--state", "closed", "--limit", "500", "--json", "number"]
    )
    return {r["number"] for r in raw}


def fetch_open_prs() -> list[dict]:
    return _gh_json(
        [
            "pr",
            "list",
            "--repo",
            REPO,
            "--state",
            "open",
            "--limit",
            "200",
            "--json",
            "number,title,body,headRefName",
        ]
    )


# --- rendering -------------------------------------------------------------

_RULE = "─" * 64


_TOUCHES_WARNING = "       ⚠ no `Touches:` line — add one (picking-work.md)"


def _join_refs(nums: list[int]) -> str:
    return ", ".join(f"#{n}" for n in nums)


def _flag_missing_touches(iss: Issue, lines: list[str]) -> None:
    """Append the missing-Touches warning so it surfaces in every bucket, not
    only Available (an undeclared issue must never be silently un-flagged).
    """
    if not iss.has_touches:
        lines.append(_TOUCHES_WARNING)


def render_available(buckets: Buckets, ready: list[Issue]) -> list[str]:
    lines = ["Available now — ready, all blockers closed, no open PR", _RULE]
    if not buckets.available:
        lines.append("  (none)")
    for iss in buckets.available:
        unb = unblocks(iss.number, ready)
        note = f"  → unblocks {_join_refs(unb)}" if unb else ""
        lines.append(f"  #{iss.number}  {iss.title}{note}")
        _flag_missing_touches(iss, lines)
    return lines


def render_in_flight(buckets: Buckets) -> list[str]:
    lines = ["In flight — an open PR already handles these", _RULE]
    if not buckets.in_flight:
        lines.append("  (none)")
    for iss, prs in buckets.in_flight:
        lines.append(f"  #{iss.number}  {iss.title}  (PR {_join_refs(prs)})")
        _flag_missing_touches(iss, lines)
    return lines


def render_blocked(buckets: Buckets) -> list[str]:
    lines = ["Blocked — waiting on an open blocker", _RULE]
    if not buckets.blocked:
        lines.append("  (none)")
    for iss, blockers in buckets.blocked:
        lines.append(f"  #{iss.number}  {iss.title}  (blocked by {_join_refs(blockers)})")
        _flag_missing_touches(iss, lines)
    return lines


def render_groups(groups: list[list[int]]) -> list[str]:
    lines = ["Parallel-safe groups — disjoint Touches, can run concurrently", _RULE]
    if not groups:
        lines.append("  (none available)")
    for i, group in enumerate(groups, 1):
        lines.append(f"  group {i}: {_join_refs(group)}")
    return lines


def main() -> int:
    try:
        ready = fetch_ready_issues()
        closed = fetch_closed_numbers()
        prs = fetch_open_prs()
    except (
        subprocess.CalledProcessError,
        subprocess.TimeoutExpired,
        FileNotFoundError,
        json.JSONDecodeError,
    ) as exc:
        print(f"error: failed to query the tracker via gh: {exc}", file=sys.stderr)
        return 1
    buckets = classify(ready, closed, build_pr_refs(prs))
    groups = parallel_groups(buckets.available)
    out = [
        *render_available(buckets, ready),
        "",
        *render_in_flight(buckets),
        "",
        *render_blocked(buckets),
        "",
        *render_groups(groups),
    ]
    print("\n".join(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
