---
name: update-onboarding
description: Update docs/onboarding.html (the Lectoria developer guide) to reflect recently merged work. Use when the user says "update onboarding", "refresh the onboarding doc/guide", "sync onboarding", or invokes /update-onboarding. Accepts an optional window — a number of days (e.g. 7) or a since-ref (commit/tag); with no argument it syncs from the last-synced marker stored inside the doc.
---

# Update Onboarding

Keep `docs/onboarding.html` current as a **current-state guide, not a changelog**. The
doc carries a self-describing high-water mark; this skill reads it, folds in the
mental-model-changing work merged since then, and re-stamps it.

## Quick start

```bash
# what changed since the last sync? (or pass `7` for days, or a tag/sha)
python .claude/skills/update-onboarding/scripts/sync_report.py
```

## Workflow

1. **Scope the window.** Run `sync_report.py [<days|ref>]`. With no arg it reads the
   `<!-- onboarding-sync: <sha> <date> -->` marker in the doc (falling back to the
   doc's last-edit commit). It prints `HEAD` (the origin/main tip you sync up to), the
   commit/PR list, and the exact `set_marker.py` command for step 5.

2. **Triage with one test:** *does this change a new developer's mental model of the
   current system?* Fold in the ones that pass; skip internal-only churn. The
   calibration table below is the rule of thumb.

3. **Content sync (most runs).** Edit prose / sections / tables in place. Gotchas:
   - A new `<section id="x">` is invisible unless you add a matching `<a href="#x">`
     to the sidebar nav (scroll-spy reads `#sidebar a[href^="#"]`).
   - Keep the **two** disk-layout trees in sync (NCM "Disk Storage" + "Data Directory
     Layout").
   - Correct now-false statements; remove resolved "Known Debt" rows; add a decision
     card when a documented decision changes.

4. **Diagram update (only if a diagram's subject changed).** Edit the source in
   `docs/diagrams/<name>.mmd`, then swap it in place (idempotent, by svgId):
   ```bash
   .claude/skills/update-onboarding/scripts/update_diagram.sh system   # | pipeline | byok
   ```
   Never hand-edit the embedded `<svg>` — always regenerate.

5. **Re-stamp the marker** with the `set_marker.py …` line from step 1 (updates the
   hidden comment + the visible "Current as of" line).

6. **Verify & ship.** `just check && just test`. Optionally render the page to PDF
   with a local Chrome to eyeball diagrams. Ship via a worktree + draft PR per the repo
   workflow; commit `docs(onboarding): …`. Run the skill once per cycle (running twice
   before the PR merges produces competing PRs).

## Calibration — what is section-worthy

| Change | Action |
|--------|--------|
| New module / seam (e.g. BookStore) | new section + sidebar link + diagram if it's central |
| A now-false claim (e.g. CORS "allow all origins") | correct the prose; drop the stale debt row; add a decision card |
| New dev command (e.g. `just dev-all`) | one table row |
| Import hoisting, dedup helpers, CI tweaks, dep/version bumps | **skip** — invisible to a reader's mental model |

See [REFERENCE.md](REFERENCE.md) for the marker format, script details, and the full
editing-gotcha and diagram-pipeline notes.
