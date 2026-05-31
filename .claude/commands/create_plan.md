---
description: Create detailed implementation plans with thorough research and iteration
model: opus
---

# Implementation Plan

You are tasked with creating detailed implementation plans through an interactive, iterative process. Be skeptical, thorough, and work collaboratively to produce high-quality technical specifications.

## Initial Response

When this command is invoked:

1. **If parameters provided**: Read any provided files FULLY, then begin research
2. **If no parameters**: Ask for task/ticket description, context, constraints, and links to related work

## Process Steps

### Step 1: Context Gathering & Initial Analysis

1. **Read all mentioned files FULLY** (no limit/offset)
2. **Spawn parallel research tasks**:
   - Use **codebase-locator** to find all related files
   - Use **codebase-analyzer** to understand current implementation
   - Use **docs-locator** to find existing documentation
3. **Read all files identified by research**
4. **Present informed understanding and focused questions**

### Step 2: Research & Discovery

1. If the user corrects any misunderstanding, spawn new research to verify
2. Spawn parallel sub-tasks for comprehensive research
3. Present findings and design options with trade-offs

### Step 3: Plan Structure Development

1. Create initial plan outline with phases
2. Get feedback on structure before writing details

### Step 4: Detailed Plan Writing

Write the plan to `~/.claude/plans/lectoria/YYYY-MM-DD-description.md` (personal scratch — plans are not committed to the repo) using this template:

```markdown
# [Feature/Task Name] Implementation Plan

## Overview
[What we're implementing and why]

## Current State Analysis
[What exists now, what's missing, constraints]

## Desired End State
[Specification of end state and how to verify it]

## What We're NOT Doing
[Out-of-scope items]

## Phase 1: [Name]
### Changes Required
#### 1. [Component]
**File**: `path/to/file`
**Changes**: [Summary]

### Success Criteria
#### Automated Verification
- [ ] Tests pass: `just test`
- [ ] Linting passes: `just lint`

#### Manual Verification
- [ ] Feature works as expected
```

### Step 5: Review

1. Present the draft and ask for feedback
2. Iterate until the user is satisfied
3. No open questions in final plan — resolve everything first

## Guidelines

- **Be Skeptical**: Question vague requirements, identify issues early
- **Be Interactive**: Get buy-in at each step, allow course corrections
- **Be Thorough**: Read all context files completely, include file:line references
- **Be Practical**: Focus on incremental, testable changes
- **No Open Questions**: Research or ask before finalizing
