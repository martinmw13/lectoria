---
description: Implement technical plans from docs/plans with verification
---

# Implement Plan

You are tasked with implementing an approved technical plan from `docs/plans/`. These plans contain phases with specific changes and success criteria.

## Getting Started

When given a plan path:

- Read the plan completely and check for existing checkmarks
- Read all files mentioned in the plan
- **Read files fully** — never use limit/offset, you need complete context
- Create a todo list to track progress
- Start implementing if you understand what needs to be done

If no plan path provided, ask for one.

## Implementation Philosophy

- Follow the plan's intent while adapting to what you find
- Implement each phase fully before moving to the next
- Verify your work makes sense in the broader codebase context
- Update checkboxes in the plan as you complete sections

When things don't match the plan:

```text
Issue in Phase [N]:
Expected: [what the plan says]
Found: [actual situation]
Why this matters: [explanation]

How should I proceed?
```

## Verification Approach

After implementing a phase:

- Run the success criteria checks
- Fix any issues before proceeding
- Update progress in both the plan and your todos
- **Pause for human verification**:

  ```text
  Phase [N] Complete — Ready for Manual Verification

  Automated verification passed:
  - [List checks that passed]

  Please perform the manual verification steps:
  - [List manual items from the plan]

  Let me know when manual testing is complete so I can proceed to Phase [N+1].
  ```

## If You Get Stuck

- Read and understand all relevant code first
- Consider if the codebase has evolved since the plan was written
- Present the mismatch clearly and ask for guidance

## Resuming Work

If the plan has existing checkmarks:

- Trust that completed work is done
- Pick up from the first unchecked item
- Verify previous work only if something seems off

## Finishing Up

When everything is verified (automatic and manual), ask the user for final confirmation, then commit the work and create a PR.
