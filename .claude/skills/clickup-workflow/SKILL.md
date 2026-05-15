---
name: clickup-workflow
description: End-to-end ClickUp card workflow. Reads a card, researches, plans, implements, creates PR, and communicates via Slack for human validation at each gate. Use when the user provides a ClickUp task ID or URL and wants you to work it through the full development lifecycle. Can be triggered with a prompt like 'work on', 'help me with', 'fix', 'implement', 'create feature for' or something similar in english or spanish followed by clikcup link or ID.
model: opus
---

# ClickUp Card Full Workflow

You are tasked with executing the complete development lifecycle for a ClickUp card — from reading and understanding the task, through research, planning, implementation, and PR creation — with human-in-the-loop validation gates via Slack.

## Constants

<!-- ADAPT: Replace with your ClickUp workspace ID (found in your ClickUp URL) -->
- **ClickUp Workspace ID**: `YOUR_WORKSPACE_ID`

### ClickUp Board → Repository Mapping

<!-- ADAPT: Map your repositories to their corresponding ClickUp lists/boards -->
| Repository | ClickUp List | List ID |
|---|---|---|
| `your-repo-name` | [Board Name](https://app.clickup.com/YOUR_WORKSPACE_ID/v/li/YOUR_LIST_ID) | `YOUR_LIST_ID` |

> Repo-specific details (Slack channel ID, GitHub URL, Phase 4 pre-PR steps) are in
> `.claude/skills/clickup-workflow/repos/<repo-name>.md` and are loaded during Initial Setup.
> See `repos/_example.md` for the template to create your own repo configs.

## Slack Link Format

**CRITICAL**: Slack uses mrkdwn, not Markdown. Links MUST use angle-bracket format:

```text
<URL|display text>
```

**Never** write plain URLs, never use `[text](URL)` Markdown syntax, and never wrap URLs in parentheses. Every URL that appears in a Slack message must be a proper `<URL|display text>` link.

### URL Construction Helpers

Given a branch name `BRANCH`, a file path `FILE_PATH`, and the resolved `REPO_URL` variable:

- **Branch**: `{REPO_URL}/tree/{BRANCH}` → `<{REPO_URL}/tree/{BRANCH}|{BRANCH}>`
- **Doc file**: `{REPO_URL}/blob/{BRANCH}/{FILE_PATH}` → `<{REPO_URL}/blob/{BRANCH}/{FILE_PATH}|{FILE_PATH}>`
- **PR**: use the URL returned by `gh pr create` → `<PR_URL|View PR>`
- **ClickUp card**: `<CLICKUP_URL|View Card>`

## Slack Thread Strategy

**All Slack communication for a single card MUST happen in one thread.**

1. **Open the thread once** at the very beginning of the workflow (after reading the ClickUp card).
2. **Capture the `ts`** (timestamp) returned by the first message — this is the `thread_ts` for all subsequent replies.
3. **Every subsequent Slack message** (research review, plan review, manual validation, PR review, errors) MUST be sent with `thread_ts` set to that captured value so they appear as replies in the same thread.

### Opening Message Format

Send this as the first Slack message to `{SLACK_CHANNEL_ID}`:

```text
:thread: *[ClickUp card title]* — <https://app.clickup.com/t/[TASK_ID]|View Card>

Starting end-to-end workflow. All updates for this card will be posted in this thread.
```

Save the `ts` from the response as `SLACK_THREAD_TS`. Use it for all follow-up messages.

## Context Management Rules

**CRITICAL**: This workflow can be long-running. To avoid context exhaustion:

- **Delegate aggressively**: Use Task agents for research, analysis, and implementation phases. Do NOT keep large file contents in your main context.
- **Target < 50% context usage**: If you feel context is getting heavy, break into sub-agents.
- **Each phase should be a sub-agent** when possible (research, plan creation, implementation).
- **Keep the main orchestrator lean**: Your job is to coordinate, gate, and communicate — not to hold all the code in memory.

## Resume Workflow

**Trigger**: User says "resume workflow", "resume [task_id]", or "continue workflow".

When resuming a disconnected session:

1. **Read the state file**: `docs/plans/.workflow-state.json` on the current branch (or ask the user for the branch name and check it out first)
   - If the file doesn't exist on the current branch, ask the user for the branch name and run `git checkout <branch>` to find it
2. **Restore state variables** from the file:
   - `SLACK_THREAD_TS` ← `slack_thread_ts`
   - `SLACK_CHANNEL_ID` ← `slack_channel_id`
   - `PHASE` ← `phase`
   - `TASK_ID` ← `task_id`
   - `CLICKUP_URL` ← `clickup_url`
   - `REPO_URL` ← `repo_url`
3. **Post reconnection notice** to the Slack thread:

   ```text
   :arrows_counterclockwise: Session reconnected. Checking for approval on the *[PHASE]* gate...
   ```

4. **Re-spawn the human gate** sub-agent using the recovered `SLACK_THREAD_TS` and the `gate_message_ts` from the state file to know which messages to inspect
5. Continue the workflow from the recovered phase

---

## Initial Setup

When this skill is invoked:

1. **Parse the input** to extract the ClickUp task ID or URL
   - From URL: extract the task ID (e.g., from `https://app.clickup.com/t/86b85vz35` extract `86b85vz35`)
   - From plain ID: use directly
   - If no task provided, ask the user for it
   - DO NOT invent or infer or guess the content of the card. ONLY work if you find a valid ClickUp Card. If not, stop and ask the user.

2. **Detect current repository and load repo config**:
   - Run `git remote get-url origin` to get the remote URL
   - Extract the repo name from the remote URL
   - Read `.claude/skills/clickup-workflow/repos/<repo-name>.md`
   - Set the following variables from the config file:
     - `REPO_URL` — GitHub base URL for this repo
     - `SLACK_CHANNEL_ID` — Slack channel ID to post updates to
     - `SLACK_CHANNEL_NAME` — Human-readable channel name for display
   - If the repo is not recognized, ask the user which repo config to use

3. **Read the ClickUp card** using the `clickup-ticket-reader` agent:
   - Spawn a `clickup-ticket-reader` agent with the task ID
   - This gets the full description, comments, subtasks, and related tasks

4. **Understand the card** and summarize it back to the user:

   ```text
   I've read ClickUp task [ID]: [Title]

   Summary: [Brief summary of what needs to be done]
   Acceptance Criteria: [If any]
   Priority: [Priority level]
   ```

5. **HARD STOP — Confirm card with user before proceeding**:
   - Present the card title and summary as shown above
   - Then ask: "Does this look correct? Reply **yes** to start the full workflow, or correct me if this is the wrong card."
   - **DO NOT proceed to any further steps until the user explicitly confirms.**
   - If the user says the card is wrong or the data looks invented, stop and ask them to re-provide the task ID or URL.
   - Only continue once the user has confirmed the card content is accurate.

6. **Open the Slack thread** (do this BEFORE any other Slack communication):
   - Send the opening message to `{SLACK_CHANNEL_ID}` (see *Slack Thread Strategy* above)
   - Store the returned `ts` as `SLACK_THREAD_TS` — this is required for all subsequent messages
   - **Immediately write the initial workflow state file** to `docs/plans/.workflow-state.json`:

     ```json
     {
       "task_id": "<CLICKUP_TASK_ID>",
       "branch": "<BRANCH_NAME>",
       "phase": "started",
       "slack_channel_id": "<SLACK_CHANNEL_ID>",
       "slack_channel_name": "<SLACK_CHANNEL_NAME>",
       "slack_thread_ts": "<SLACK_THREAD_TS>",
       "gate_message_ts": null,
       "clickup_url": "<CLICKUP_URL>",
       "repo_url": "<REPO_URL>",
       "started_at": "<ISO_TIMESTAMP>",
       "gate_entered_at": null,
       "status": "in_progress"
     }
     ```

   - Commit and push: `git add docs/plans/.workflow-state.json && git commit -m "chore: init workflow state" && git push`

7. **Update ClickUp card status to IN PROGRESS**:
   - Use `mcp__clickup__clickup_update_task` with `status: "in progress"`
   - Add a comment: "Starting work on this task. Will update with progress."

8. **Create a feature branch**:
   - Branch name: `feat/[short-description-from-card]` or `fix/` if it's a bug fix
   - `git checkout -b feat/[branch-name]` from the latest main

## Phase 1: Research (Conditional)

Assess whether the task is straightforward or needs deep research.

### If task is SIMPLE (small bug fix, config change, minor addition):

- Skip research document creation
- Proceed directly to Phase 2 (Planning)
- Comment on ClickUp: "Task is straightforward — skipping deep research, moving to planning."

### If task is COMPLEX (new feature, architectural change, multi-file changes):

1. **Invoke the `/research_codebase` command logic**:
   - Spawn a Task agent (subagent_type: `general-purpose`, model: `opus`) with the full research_codebase workflow
   - Provide it with: the ClickUp card summary, relevant context, and the research question
   - The agent will:
     - Decompose the research into parallel sub-agents
     - Write a research document to `docs/research/YYYY-MM-DD-CLICKUP-{id}-{description}.md`
   - Wait for the agent to complete

2. **Commit and push the research document**:
   - `git add docs/research/...`
   - Commit: `docs: add research for ClickUp {id} - {short description}`
   - `git push -u origin feat/[branch-name]`

3. **Send Slack message for research validation**:
   - Use `mcp__claude_ai_Slack__slack_send_message` to channel `{SLACK_CHANNEL_ID}` with `thread_ts=SLACK_THREAD_TS`:

     ```text
     :mag: *Research Ready for Review*
     *Branch*: <{REPO_URL}/tree/[branch-name]|[branch-name]>
     *Research doc*: <{REPO_URL}/blob/[branch-name]/docs/research/[filename].md|docs/research/[filename].md>

     Please review the research document and reply with:
     - :white_check_mark: to approve and proceed to planning
     - :x: with feedback to iterate
     ```

4. **Comment on ClickUp**: "Research document created and pushed. Awaiting human review on Slack."

5. **Update state file** — set `"phase": "research"` in `docs/plans/.workflow-state.json`, then commit & push.

6. **Human gate** — follow `.claude/skills/clickup-workflow/HUMAN_GATE.md` with `GATE_LABEL="research"`.
   - If approved → Phase 2
   - If rejected → iterate research, re-commit, re-push, re-notify, re-run gate
   - Comment on ClickUp with outcome

## Phase 2: Planning (Always)

1. **Invoke the `/create_plan` command logic**:
   - Spawn a Task agent (subagent_type: `general-purpose`, model: `opus`) with the full create_plan workflow
   - Provide it with:
     - The ClickUp card summary
     - The research document path (if created)
     - Any context gathered so far
   - The agent will:
     - Research the codebase for implementation patterns
     - Create a plan at `docs/plans/YYYY-MM-DD-CLICKUP-{id}-{description}.md`
   - Wait for the agent to complete

2. **Commit and push the plan**:
   - `git add docs/plans/...`
   - Commit: `docs: add implementation plan for ClickUp {id}`
   - `git push`

3. **Send Slack message for plan validation**:
   - Use `mcp__claude_ai_Slack__slack_send_message` to channel `{SLACK_CHANNEL_ID}` with `thread_ts=SLACK_THREAD_TS`:

     ```text
     :clipboard: *Implementation Plan Ready for Review*
     *Branch*: <{REPO_URL}/tree/[branch-name]|[branch-name]>
     *Plan doc*: <{REPO_URL}/blob/[branch-name]/docs/plans/[filename].md|docs/plans/[filename].md>

     Please review the plan and reply with:
     - :white_check_mark: to approve and proceed to implementation
     - :x: with feedback to iterate
     ```

4. **Comment on ClickUp**: "Implementation plan created and pushed. Awaiting human review on Slack."

5. **Update state file** — set `"phase": "plan"` in `docs/plans/.workflow-state.json`, then commit & push.

6. **Human gate** — follow `.claude/skills/clickup-workflow/HUMAN_GATE.md` with `GATE_LABEL="plan"`.
   - If approved → Phase 3
   - If rejected → iterate plan, re-commit, re-push, re-notify, re-run gate
   - Comment on ClickUp with outcome

## Phase 3: Implementation

1. **Invoke the `/implement_plan` command logic**:
   - Spawn a Task agent (subagent_type: `general-purpose`, model: `opus`) with the implement_plan workflow
   - Provide it with:
     - The plan document path
     - The ClickUp card summary
     - Instructions to implement phase by phase
   - The agent will:
     - Read the plan
     - Implement each phase
     - Run automated verification (tests, linting)
     - Report back results

2. **After each significant implementation milestone**:
   - Commit and push changes
   - Comment on ClickUp with progress update
   - If manual validation is needed, send Slack message to `{SLACK_CHANNEL_ID}` with `thread_ts=SLACK_THREAD_TS`:

     ```text
     :hammer_and_wrench: *Manual Validation Needed*
     *Phase*: [Current phase]
     *What to test*: [Specific manual verification steps from the plan]

     Please test and reply with:
     - :white_check_mark: to approve
     - :x: with issues found
     ```

   - **Update state file** — set `"phase": "manual validation – [phase name]"` in `docs/plans/.workflow-state.json`, then commit & push

   - Then run the **Human gate** — follow `.claude/skills/clickup-workflow/HUMAN_GATE.md` with `GATE_LABEL="manual validation – [phase name]"`

3. **When implementation is complete**:
   - Ensure all automated checks pass
   - Commit any remaining changes
   - Push everything

## Phase 4: PR Creation and Final Review

1. **Run repo-specific pre-PR steps**:
   - Read `.claude/skills/clickup-workflow/repos/<repo-name>.md`
   - Follow the **"Phase 4: Pre-PR Steps"** section defined there
   - This covers repo-specific tasks such as: manifest generation, version bumping, running local tests, building the project, etc.
   - Complete all steps before creating the PR

2. **Create the PR**:
   - Use `gh pr create` with a clear title and description summarizing the changes
   - Link the ClickUp card in the PR description

3. **Send Slack message for PR review**:
   - Use `mcp__claude_ai_Slack__slack_send_message` to channel `{SLACK_CHANNEL_ID}` with `thread_ts=SLACK_THREAD_TS`:

     ```text
     :rocket: *PR Ready for Review*
     *PR*: <[PR_URL]|View PR>

     Changes summary:
     - [Key change 1]
     - [Key change 2]

     Please review and approve/request changes.
     ```

4. **Update ClickUp card**:

   - Set status to `CODE REVIEW`
   - Add comment: "PR created: [PR URL]. Moving to code review."

5. **Final summary to user**:

   ```text
   Workflow complete for ClickUp task [ID]:

   - Research: [created/skipped] — [doc path if created]
   - Plan: [doc path]
   - Implementation: [summary of changes]
   - PR: [PR URL]
   - ClickUp Status: CODE REVIEW

   The PR is ready for human review on GitHub.
   ```

## Error Handling

- If any phase fails, comment on the ClickUp card with the error details
- Send a Slack message notifying the team of the blocker
- Present the error to the user and ask for guidance
- Do NOT silently skip phases or ignore failures

## ClickUp Comment Guidelines

Add comments at these checkpoints:

- Task started (status -> IN PROGRESS)
- Research complete (with doc link)
- Plan complete (with doc link)
- Implementation progress (per phase)
- PR created (with PR link, status -> CODE REVIEW)
- Any blockers or issues encountered

Keep comments concise but informative. Include links to artifacts (docs, PRs, branches).

## Slack Communication Guidelines

- Always use channel `{SLACK_CHANNEL_ID}` (resolved at startup from the repo config)
- **One thread per card**: open it once at the start with the card title + link; reply to it for everything else
- Always pass `thread_ts=SLACK_THREAD_TS` on every follow-up message — NEVER post to the channel directly after the opening message
- Use emoji prefixes for quick scanning:
  - `:thread:` for the opening thread message
  - `:mag:` for research
  - `:clipboard:` for plans
  - `:hammer_and_wrench:` for implementation/manual testing
  - `:rocket:` for PR ready
  - `:rotating_light:` for blockers/errors
- The opening message includes the ClickUp task name and URL; subsequent thread replies don't need to repeat it
- Always include clear instructions for how to respond
- Keep messages structured and scannable

## Interaction Model

This skill is designed to be **semi-autonomous with human gates**:

- You drive the work forward autonomously within each phase
- You pause at defined gates (research review, plan review, manual testing, PR review)
- At each gate, you notify via Slack and wait for the user to relay the response
- The user can also provide feedback directly in the conversation at any time

If the user says "continue" or "approved" at any gate, proceed to the next phase.
If the user provides specific feedback, iterate on the current phase before proceeding.
