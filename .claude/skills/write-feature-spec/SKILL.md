---
name: write-feature-spec
description: Write a full product spec (PRD) and implementation specs for a feature.
---

# Feature Specification Generator

Create comprehensive feature documentation including a product-friendly PRD and implementation specs.

## Arguments

- `$ARGUMENTS` — Feature name and description

## Instructions

### 1. Parse Input

Extract feature slug (kebab-case) and description. If unclear, ask:

- What problem does this solve?
- What components are affected?
- Specific requirements or constraints?

### 2. Research Phase

Use sub-agents to gather context:

- Existing patterns in the codebase
- Related features and implementations

### 3. Create PRD

Write `docs/specs/{feature-slug}/PRD.md`:

- **~200 lines max**, 2-5 minute read
- **NO technical implementation details** — no code, no SQL, no file paths
- Product language accessible to non-engineers

Sections: Overview, Problem Statement, User Stories, Requirements (Must/Should/Nice), Business Logic, Risks, Success Metrics

### 4. Create Implementation Specs

For each affected area, write `docs/specs/{feature-slug}/impl-{area}.md`:

- Technical requirements (WHAT, not HOW)
- Affected areas and files to investigate
- Data structures and contracts
- Edge cases to handle

### 5. Review & Confirmation

Present summary and ask:

1. "Does everything look OK? Any changes needed?"
2. Iterate until satisfied
