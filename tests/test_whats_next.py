"""Tests for whats_next.py — the pure derivation behind `just next`.

No live `gh` calls: every test feeds canned issue/PR JSON through the pure
parse/classify/grouping functions.
"""

from scripts.whats_next import (
    _TOUCHES_WARNING,
    Buckets,
    Issue,
    build_pr_refs,
    classify,
    parallel_groups,
    parse_blocked_by,
    parse_issue,
    parse_touches,
    pr_issue_refs,
    render_blocked,
    unblocks,
)

# A body shaped like #69: real blocker bullets, then a `> Heavy contention`
# Coordination blockquote naming other issues, then an HR + triage footer.
MESSY_BODY = """## What to build

Migrate the thing.

## Blocked by

- #68 — needs the generated ChaptersData component.
- #61 — SceneView is a dead consumer; delete it first.

> **Heavy contention** (not parallel-safe): client.ts with #63 and #65
  (note #64 touches only UploadPage.tsx); ReaderPage with #62; PageView #70.

## Touches

`frontend/src/api/client.ts`, `frontend/src/api/types.ts` (new)

---
> *Edited during AI triage (2026-05-30).*
"""


class TestParseBlockedBy:
    def test_none_means_no_blockers(self):
        assert parse_blocked_by("## Blocked by\n\nNone — can start immediately.") == frozenset()

    def test_missing_section_means_no_blockers(self):
        assert parse_blocked_by("## What to build\n\nstuff") == frozenset()

    def test_multiple_refs_on_one_line(self):
        assert parse_blocked_by("## Blocked by\n#34, #35") == {34, 35}

    def test_ignores_coordination_blockquote_refs(self):
        # Only the real blocker bullets, NOT the #63/#65/#64/#62/#70 in the
        # `> Heavy contention` note, and not refs from later sections.
        assert parse_blocked_by(MESSY_BODY) == {68, 61}


class TestParseTouches:
    def test_strips_backticks_and_annotations(self):
        touches, found = parse_touches(
            "## Touches\n`justfile`, `scripts/whats_next.py` (new), `tests/` (test)"
        )
        assert found is True
        assert touches == {"justfile", "scripts/whats_next.py", "tests/"}

    def test_missing_section_is_flagged_not_dropped(self):
        touches, found = parse_touches("## What to build\n\nno touches here")
        assert found is False
        assert touches == frozenset()

    def test_stops_at_horizontal_rule_and_footer(self):
        # The trailing `---` + triage blockquote must not leak in as a token.
        touches, found = parse_touches(MESSY_BODY)
        assert found is True
        assert touches == {"frontend/src/api/client.ts", "frontend/src/api/types.ts"}

    def test_inline_bold_touches_line_fallback(self):
        # #63-style: no `## Touches` heading, an inline `**Touches:**` line with
        # `+ new` markers and a trailing period.
        body = (
            "## What\n\nstuff\n\n"
            "**Touches:** `frontend/src/api/client.ts`, "
            "+ new `frontend/src/api/byok.ts`.\n\n## Next\n"
        )
        touches, found = parse_touches(body)
        assert found is True
        assert touches == {"frontend/src/api/client.ts", "frontend/src/api/byok.ts"}

    def test_comma_inside_annotation_does_not_fracture_path(self):
        # #66-style: a comma inside `(... , ...)` must not split the path.
        body = (
            "## Touches\n\n"
            "frontend/src/hooks/useCrossfadeAudio.ts (new — thin hook, per #31), "
            "package.json"
        )
        touches, _ = parse_touches(body)
        assert touches == {"frontend/src/hooks/useCrossfadeAudio.ts", "package.json"}

    def test_leading_dot_path_is_preserved(self):
        touches, _ = parse_touches("## Touches\n`.github/workflows/ci.yml`, `README.md`")
        assert touches == {".github/workflows/ci.yml", "README.md"}


class TestParseIssue:
    def test_builds_issue_from_canned_json(self):
        iss = parse_issue({"number": 74, "title": "add just next", "body": MESSY_BODY})
        assert iss.number == 74
        assert iss.blocked_by == {68, 61}
        assert iss.has_touches is True


class TestPrIssueRefs:
    def test_closing_keyword_in_body(self):
        pr = {
            "number": 75,
            "body": "Fixes #64\n\nalso mentions #65 and #66.",
            "headRefName": "worktree-fix-stuff",
        }
        assert pr_issue_refs(pr) == {64}

    def test_pure_digit_branch_segment_fallback(self):
        pr = {"number": 90, "body": "no closing keyword", "headRefName": "fix/123-foo"}
        assert pr_issue_refs(pr) == {123}

    def test_release_pr_with_no_refs_maps_to_nothing(self):
        pr = {
            "number": 52,
            "body": "## 0.2.2\n\nrelease notes",
            "headRefName": "release-please--branches--main",
        }
        assert pr_issue_refs(pr) == set()

    def test_build_pr_refs_indexes_by_issue(self):
        prs = [{"number": 75, "body": "Closes #64", "headRefName": "x"}]
        assert build_pr_refs(prs) == {64: [75]}


def _issue(number, blocked_by=(), touches=("a.py",), has_touches=True):
    return Issue(number, f"issue {number}", frozenset(blocked_by), frozenset(touches), has_touches)


class TestClassify:
    def test_open_blocker_goes_to_blocked_with_numbers(self):
        issues = [_issue(10, blocked_by=(5, 6))]
        buckets = classify(issues, closed={6}, pr_refs={})
        assert buckets.available == []
        assert buckets.blocked == [(issues[0], [5])]  # #6 closed, #5 still open

    def test_closed_blockers_make_issue_available(self):
        issues = [_issue(10, blocked_by=(5, 6))]
        buckets = classify(issues, closed={5, 6}, pr_refs={})
        assert buckets.available == issues
        assert buckets.blocked == []

    def test_open_pr_makes_issue_in_flight_not_available(self):
        issues = [_issue(10)]
        buckets = classify(issues, closed=set(), pr_refs={10: [75]})
        assert buckets.available == []
        assert buckets.in_flight == [(issues[0], [75])]

    def test_open_blocker_beats_open_pr(self):
        # Precedence: a still-open blocker wins over an in-flight PR.
        issues = [_issue(10, blocked_by=(5,))]
        buckets = classify(issues, closed=set(), pr_refs={10: [75]})
        assert buckets.blocked == [(issues[0], [5])]
        assert buckets.in_flight == []


class TestUnblocks:
    def test_lists_issues_naming_this_one(self):
        issues = [_issue(10, blocked_by=(5,)), _issue(11, blocked_by=(5,)), _issue(12)]
        assert unblocks(5, issues) == [10, 11]
        assert unblocks(12, issues) == []


class TestRender:
    def test_missing_touches_flagged_outside_available(self):
        # Criterion 5: an undeclared-Touches issue must be flagged in every
        # bucket, not only Available.
        iss = _issue(10, blocked_by=(5,), touches=(), has_touches=False)
        buckets = Buckets(available=[], in_flight=[], blocked=[(iss, [5])])
        assert _TOUCHES_WARNING in render_blocked(buckets)


class TestParallelGroups:
    def test_disjoint_touches_group_together(self):
        issues = [_issue(1, touches=("a.py",)), _issue(2, touches=("b.py",))]
        assert parallel_groups(issues) == [[1, 2]]

    def test_overlapping_touches_split_into_singletons(self):
        issues = [_issue(1, touches=("shared.py",)), _issue(2, touches=("shared.py",))]
        assert parallel_groups(issues) == [[1], [2]]

    def test_missing_touches_conflicts_with_everything(self):
        issues = [
            _issue(1, touches=("a.py",)),
            _issue(2, touches=("b.py",)),
            _issue(3, touches=(), has_touches=False),
        ]
        groups = parallel_groups(issues)
        assert [1, 2] in groups  # the two declared-Touches issues run together
        assert [3] in groups  # the undeclared one stands alone
        assert not any(3 in g and len(g) > 1 for g in groups)

    def test_no_available_issues_yields_no_groups(self):
        # All ready issues blocked/in-flight → no group line, not an empty one.
        assert parallel_groups([]) == []

    def test_chain_yields_maximal_groups(self):
        # 1↔a, 2↔b, 3↔a (3 overlaps 1). Maximal groups: {1,2} and {2,3}.
        issues = [
            _issue(1, touches=("a.py",)),
            _issue(2, touches=("b.py",)),
            _issue(3, touches=("a.py",)),
        ]
        groups = parallel_groups(issues)
        assert [1, 2] in groups
        assert [2, 3] in groups
