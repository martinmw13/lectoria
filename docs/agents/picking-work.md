# Picking Work

How an agent (or the maintainer) chooses **what to work next** and **which issues can run in parallel** — without asking a human each time. The answer is *derived on demand* from the issue tracker, never stored as a snapshot (a stored list goes stale the moment a PR merges).

## Source of truth: the issue body

Two fields in each issue body drive selection. Keep them current; they are what make the answer computable.

- **`Blocked by:`** — issue numbers that must merge first. An issue is *eligible* only when every blocker is **closed**. Use `None` when nothing blocks it.
- **`Touches:`** — the files/areas the issue will modify, as concretely as known (e.g. `lectoria/api/routes/images.py`, `tests/test_api_*.py`, `frontend/src/`, `lectoria/app.py`). This is what makes parallelism computable without grepping the codebase.

These complement the triage labels (see `triage-labels.md`): `ready-for-agent` (an AFK agent may pick it up), `ready-for-human` (needs a human — usually a decision), `needs-triage` / `needs-info` (not yet actionable).

## What's next

1. List open issues labelled `ready-for-agent`.
2. Drop any whose `Blocked by:` issues are still open.
3. The remainder are **eligible**. Prefer the ones that unblock the most other issues, then the smallest.

`ready-for-human` issues that are decision-gated (e.g. a CORS policy call, an in-scope/out-of-scope decision) are the maintainer's queue, not an agent's — surface them, don't auto-start them.

## What can run in parallel

Each parallel session runs in its own worktree → its own PR → merges to `main`. The only thing that forces serialization is **two PRs editing the same file**. So:

> Two issues are **parallel-safe if and only if their `Touches:` sets are disjoint.**

Procedure:

1. Take the eligible set (from *What's next*).
2. Draw an edge between any two issues whose `Touches:` sets intersect.
3. A valid parallel batch is any set of issues with **no edges between them** (an independent set in that graph).
4. Also honour any explicit `Coordination` note in a body — even when files look disjoint, a body may flag an ordering (e.g. "land after #X").

When two issues overlap, don't run them together — pick an order, land one, then rebase/run the other.

If an issue has no `Touches:` line, fall back to grepping the codebase for the symbols and areas it names — but the real fix is to add the line to the issue (see below).

## Verify before trusting

A `Blocked by:` premise can be **wrong** — an issue may claim a prerequisite is done when the code shows otherwise. Before declaring an issue eligible, sanity-check any load-bearing blocker claim against the actual code (a quick `grep` for the symbol the issue says is "no longer called"). If the claim is false, fix the issue's `Blocked by:` rather than starting the work.

## Writing issues so this works

When creating or triaging an issue (`/triage`, `/to-issues`, or by hand — see `issue-tracker.md`), include both fields in the body:

```
## Blocked by
#34, #35   (or: None)

## Touches
lectoria/api/routes/images.py, tests/test_api_images.py
```

That is the whole contract: keep `Blocked by` and `Touches` honest, and "what's next / what's parallel" stays a five-minute derivation anyone can run.
