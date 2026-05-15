---
name: iterate-pr
description: Iterate on an open PR after review feedback. Gathers PR details, review comments, plan docs, and current diff to build a full picture before making changes. Use when the user wants to address PR review comments or continue iterating on an existing PR.
---

# Iterate PR Workflow

Gather all context about the current PR, understand review feedback, and prepare to iterate.

## Prerequisites

- Must be on a feature branch with an open PR (check with `gh pr view`)
- If the user provides a PR number or URL, use that. Otherwise detect from current branch.

## Step 0 — Reattach to workflow session

Check if this PR was created via the clickup-workflow by looking for a workflow state file.

1. Check if `docs/plans/.workflow-state.json` exists on the current branch.
2. **If it exists**, read it and restore the following variables:
   - `SLACK_THREAD_TS` ← `slack_thread_ts`
   - `SLACK_CHANNEL_ID` ← `slack_channel_id`
   - `CLICKUP_URL` ← `clickup_url`
   - `TASK_ID` ← `task_id`
   - `REPO_URL` ← `repo_url`
   - Set `WORKFLOW_ATTACHED = true`
   - Post a reconnection message to the Slack thread using `mcp__claude_ai_Slack__slack_send_message` with `channel_id=SLACK_CHANNEL_ID` and `thread_ts=SLACK_THREAD_TS`:

     ```text
     :arrows_counterclockwise: Starting CR iteration. Reviewing feedback and addressing comments...
     ```

3. **If it doesn't exist**, set `WORKFLOW_ATTACHED = false` and continue in standalone mode (no Slack/ClickUp integration until Step 6).

## Step 1 — Gather PR context (run in parallel)

Run all of the following in parallel to maximize speed:

### 1a. Recent commits on branch

```bash
git log --oneline -20
```

### 1b. PR details

```bash
gh pr view --json title,body,number,url,state,reviews,comments
```

### 1c. Diff stats against base branch

```bash
git diff main...HEAD --stat
```

### 1d. Search for plan/research docs

Use the `docs-locator` agent to search for related plan documents in:

- `docs/plans/` — implementation plans
- `docs/` — reference docs

Search using keywords from the branch name and PR title.

## Step 2 — Get review comments and plan doc

### 2a. PR review comments (inline code review)

```bash
gh api repos/{owner}/{repo}/pulls/{number}/comments \
  --jq '.[] | "---\n\(.path):\(.line // .original_line)\n@\(.user.login): \(.body)\n"'
```

Extract owner/repo from `gh pr view --json url`.

### 2b. Read the plan doc

If a plan document was found in Step 1d, read it in full. This provides the architectural context, design decisions, and phases of implementation.

## Step 3 — Check working tree state

```bash
git diff HEAD --stat
```

See if there are uncommitted changes that need to be addressed.

## Step 4 — Synthesize and present summary

Present a structured summary to the user:

### Summary format:

```markdown
## PR #NNN — `branch-name`

**Status**: [Approved / Changes requested / Pending review] by @reviewer

### What the PR does

[Brief summary from PR body and plan doc]

### Review feedback from @reviewer (needs addressing)

**Category 1 (e.g. Migrations):**

- Comment summary → **Action needed**

**Category 2 (e.g. Code nits):**

1. `file:line` — reviewer's comment → suggested fix
2. ...

**Category 3 (e.g. Seed script):**
3. ...

### Plan doc

[Reference to plan doc path if found]

```

Group review comments by theme/category, not just by file. This makes it easier to tackle related changes together.

### Key details to highlight:

- Who requested changes and their overall summary comment
- Inline code suggestions (with the suggested code)
- Questions from reviewers that need answers
- Nits vs blocking issues
- Whether migrations need consolidation or restructuring
- Any comments in non-English languages (if your team is multilingual) <!-- ADAPT: Remove if not applicable -->

## Step 5 — Ask what to tackle

After presenting the summary, ask the user what they want to address, or offer to work through all items.

## Step 6 — Notify when done

After changes are implemented, committed, and pushed, send notifications based on workflow attachment status.

### If `WORKFLOW_ATTACHED` is true:

1. **Send Slack thread reply** using `mcp__claude_ai_Slack__slack_send_message` with `channel_id=SLACK_CHANNEL_ID` and `thread_ts=SLACK_THREAD_TS`:

   ```markdown

   :recycle: *CR Iteration Complete*
   Changes pushed to address review feedback.

   *Addressed:*

   - [Summary of what was addressed]

   Ready for re-review. :eyes:
   ```

2. **Update workflow state** — read `docs/plans/.workflow-state.json`, set `"phase": "cr_iteration"` and `"status": "in_progress"`, then commit and push:

   ```bash
   git add docs/plans/.workflow-state.json && git commit -m "chore: update workflow state — cr iteration" && git push
   ```

3. **Comment on ClickUp task** using `mcp__clickup__clickup_create_task_comment` with `task_id=TASK_ID`:

   ```text
   CR feedback addressed. Changes pushed for re-review.
   ```

### If `WORKFLOW_ATTACHED` is false (standalone mode):

1. **Attempt to send a Slack notification** (not threaded):
   - Determine the repo name from `gh pr view --json url`
   - Read the repo config from `.claude/skills/clickup-workflow/repos/<repo-name>.md` to get `SLACK_CHANNEL_ID`
   - If found, send via `mcp__claude_ai_Slack__slack_send_message` with `channel_id=SLACK_CHANNEL_ID` (no `thread_ts`):

     ```text
     :recycle: *CR Iteration Complete* — <PR_URL|PR #NNN>
     Changes pushed to address review feedback. Ready for re-review. :eyes:
     ```

   - If repo config can't be found, skip Slack notification entirely.

## Slack format note

Slack uses **mrkdwn**, not Markdown. All Slack messages in this skill must follow these rules:

- Links: `<URL|display text>` — never plain URLs or Markdown `[text](URL)`
- Bold: `*text*` — not `**text**`
- Italic: `_text_` — not `*text*`
- Code: backticks work the same

## Notes

- Copilot review comments are lower priority than human reviewer comments
- Human reviewer comments are the ones that must be addressed for approval
- If your team uses multiple languages in reviews, understand and address comments in any language <!-- ADAPT: Remove if not applicable -->
- If the reviewer suggests consolidating migrations, that means deleting existing ones and creating a single new migration
- Always check if Phase 6 or later phases in the plan doc were added post-review — they may already address some review feedback
