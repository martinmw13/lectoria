# Development Workflow

## Change Classification

Before implementing, classify the change:

| Level | Criteria | Process |
|-------|----------|---------|
| **S** | Approach obvious, no ambiguity | Implement directly |
| **M** | Multiple approaches, trade-offs | Brainstorm → Implement |
| **L** | High uncertainty, cross-cutting | Research → Plan → Implement |

### Complementary Signals

- **First time in this area?** → Upgrade one level
- **Irreversible?** → Upgrade one level
- **Cross-boundary?** (multiple systems/teams) → Upgrade one level

## Mandatory Process

### For S changes

1. Implement the change
2. Run `just test` and `just check`
3. Commit and create PR

### For M changes

1. **Brainstorm**: What are we building? What are the options? What are the trade-offs?
2. Choose approach with human input
3. Implement, test, PR

### For L changes

1. **Research**: Use `/research_codebase` to understand current state
2. **Plan**: Use `/create_plan` to write implementation plan in `docs/plans/`
3. **Implement**: Use `/implement_plan` to execute with review gates

## Branch Convention

`type/description` — e.g., `feat/add-customer-dimension`, `fix/null-handling-pipeline`

Use conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`
