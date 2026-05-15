# Human Gate — Slack Thread Polling

Use this pattern whenever the workflow reaches a validation gate that requires human approval before proceeding.

## When to Use

After sending any Slack validation message (research, plan, manual testing, PR review), invoke this gate to block progression until a human approves.

## What Counts as Approval

Any reply in the thread that contains one of:

- ✅ `:white_check_mark:` emoji
- 👍 `:thumbsup:` emoji
- The words: `ok`, `go`, `go on`, `continue`, `approved`, `lgtm`, `ship it`, `yes`, `done`

Any reply that contains ❌ `:x:`, `no`, `stop`, `reject`, `fix`, `change`, `issue`, or `feedback` is treated as **rejection with feedback** — extract the feedback text and return it to the main agent.

## Before Spawning the Sub-Agent (Main Agent Steps)

Before launching the polling sub-agent, the **main agent** MUST:

1. **Write the workflow state file** to `docs/plans/.workflow-state.json`:

   ```json
   {
     "task_id": "<CLICKUP_TASK_ID>",
     "branch": "<BRANCH_NAME>",
     "phase": "<GATE_LABEL>",
     "slack_channel_id": "<SLACK_CHANNEL_ID>",
     "slack_thread_ts": "<SLACK_THREAD_TS>",
     "gate_message_ts": "<TS_OF_THE_GATE_NOTIFICATION_MESSAGE>",
     "clickup_url": "<CLICKUP_URL>",
     "started_at": "<ISO_TIMESTAMP_WHEN_WORKFLOW_STARTED>",
     "gate_entered_at": "<ISO_TIMESTAMP_NOW>",
     "status": "polling"
   }
   ```

   - `gate_message_ts`: the `ts` returned when you sent the gate notification message to Slack
   - Use `date -u +"%Y-%m-%dT%H:%M:%SZ"` to get the current ISO timestamp

2. **Commit and push the state file**:

   ```bash
   git add docs/plans/.workflow-state.json
   git commit -m "chore: save workflow gate state for <GATE_LABEL>"
   git push
   ```

3. **Add a comment to the ClickUp task** via `mcp__clickup__clickup_create_task_comment`:

   ```text
   [GATE] Phase: <GATE_LABEL> | Slack thread: <SLACK_THREAD_TS> | Channel: <SLACK_CHANNEL_ID>
   ```

   This provides a human-readable backup for reconnection, independent of the state file.

## Polling Sub-Agent Instructions

Spawn a Task agent with `subagent_type: general-purpose` and the following instructions:

---

**Goal**: Poll a Slack thread for human approval. Return as soon as a clear signal is received, or time out gracefully.

**Inputs you will receive**:

- `CHANNEL_ID`: the Slack channel ID
- `THREAD_TS`: the `ts` of the opening thread message
- `GATE_LABEL`: a short label for logging (e.g. "research", "plan", "PR review")
- `STATE_FILE_PATH`: path to the workflow state file (`docs/plans/.workflow-state.json`)

**Loop**:

1. Call `mcp__claude_ai_Slack__slack_read_thread` with `channel=CHANNEL_ID` and `thread_ts=THREAD_TS`
2. Inspect all replies newer than the gate notification message (ignore the gate message itself and any messages sent by the bot/assistant)
3. Check each reply for approval or rejection signals (see above)
4. If **approved**: send an acknowledgement message to the thread via `mcp__claude_ai_Slack__slack_send_message` with `thread_ts=THREAD_TS`:

   ```text
   :white_check_mark: Got it! Approval received for *[GATE_LABEL]*. Continuing the workflow now…
   ```

   Then return `{ "status": "approved" }`
5. If **rejected with feedback**: return `{ "status": "rejected", "feedback": "<extracted feedback text>" }`
6. If no signal yet: wait 60 seconds, then repeat from step 1
7. Repeat for up to **20 iterations** (~20 minutes). If the limit is reached without a response:
   - Update `docs/plans/.workflow-state.json` — change `"status"` to `"awaiting_resume"` and add `"timed_out_at": "<ISO_TIMESTAMP>"`
   - Commit and push the updated state file:

     ```bash
     git add docs/plans/.workflow-state.json
     git commit -m "chore: workflow gate timed out at <GATE_LABEL>"
     git push
     ```

   - Send a message to the thread via `mcp__claude_ai_Slack__slack_send_message` with `thread_ts=THREAD_TS`:

     ```text
     :hourglass: Polling timed out on the *[GATE_LABEL]* gate.
     React with ✅ or reply `continue` in this thread, or say *"resume workflow"* in your terminal to reconnect.
     Thread TS for reconnection: `[THREAD_TS]`
     ```

   - Return `{ "status": "timeout" }`

---

## Main Agent: Handling the Result

After the polling sub-agent returns:

| Result | Action |
|--------|--------|
| `approved` | Update `docs/plans/.workflow-state.json` with `"status": "approved"`, commit & push. Proceed to the next phase. |
| `rejected` + feedback | Feed the feedback back into the current phase, iterate, re-push, re-notify, then re-spawn the gate |
| `timeout` | Stop the workflow. Print to the terminal: `Workflow paused. State saved to docs/plans/.workflow-state.json. Say "resume workflow" to reconnect.` Wait for the user to respond directly. |
