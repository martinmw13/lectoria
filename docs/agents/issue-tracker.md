# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## Body conventions

Every implementable issue (especially `ready-for-agent`) should carry two fields in its body so that work-selection and parallelism are computable from the tracker alone (see `picking-work.md`):

```
## Blocked by
#34, #35   (or: None)

## Touches
lectoria/api/routes/images.py, tests/test_api_images.py
```

- **`Blocked by`** — issue numbers that must merge first; an issue is eligible only when all are closed.
- **`Touches`** — the files/areas the issue will modify. Two issues are parallel-safe when their `Touches` sets are disjoint.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.
