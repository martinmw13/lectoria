---
description: Research codebase comprehensively using parallel sub-agents
model: opus
---

# Research Codebase

You are tasked with conducting comprehensive research across the codebase to answer user questions by spawning parallel sub-agents and synthesizing their findings.

## Initial Setup

When invoked, respond with:

```text
I'm ready to research the codebase. Please provide your research question or area of interest.
```

Then wait for the user's research query.

## Steps

1. **Read any directly mentioned files first** — FULLY, no limit/offset. Read in main context before spawning sub-tasks.

2. **Decompose the research question** — Break into composable areas, identify components/patterns to investigate, create a research plan.

3. **Spawn parallel sub-agent tasks**:
   - Use **codebase-locator** to find what exists
   - Use **codebase-analyzer** on promising findings
   - Use **docs-locator** for historical context
   - Run multiple agents in parallel for different aspects

4. **Wait for ALL sub-agents**, then synthesize:
   - Compile results, prioritize live codebase as source of truth
   - Connect findings across components
   - Include specific file paths and line numbers
   - Highlight patterns and architectural decisions

5. **Generate research document** at `docs/research/YYYY-MM-DD-description.md`:

```markdown
# Research: [Topic]

**Date**: [Current date]
**Branch**: [Current branch]

## Research Question
[Original query]

## Summary
[High-level findings]

## Detailed Findings

### [Area 1]
- Finding with reference (`file.py:123`)

### [Area 2]
...

## Code References
- `path/to/file.py:123` - Description

## Architecture Insights
[Patterns and design decisions]

## Open Questions
[Areas needing further investigation]
```

1. **Present findings** to the user with key references

2. **Handle follow-ups** — Append to same document, spawn new sub-agents as needed

## Important Notes

- Always use parallel agents to maximize efficiency
- Always run fresh codebase research — don't rely solely on existing docs
- Focus on concrete file paths and line numbers
- Research documents should be self-contained
- Each sub-agent prompt should be specific and focused on read-only operations
