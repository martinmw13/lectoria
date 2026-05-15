---
name: ship-pr
description: Ship changes end-to-end — create branch, commit, push, create PR.
---

# Ship PR Workflow

The user has made changes (staged or unstaged). Package and ship them:
branch -> commit -> push -> PR.

## Step 1 — Understand the changes

1. Run `git status` and `git diff` (staged + unstaged)
2. Summarize the changes

## Step 2 — Create branch (if on main/develop)

```bash
git checkout -b type/short-description   # feat/ or fix/
```

## Step 3 — Commit and push

```bash
git add <specific files>
git commit -m "type(scope): short description"
git push -u origin <branch-name>
```

## Step 4 — Create the PR

```bash
gh pr create --title "type(scope): description" --body "$(cat <<'EOF'
## Summary
- What changed
- Why it was needed

## Test plan
- [ ] Specific verification steps
EOF
)"
```

## Summary output

```markdown

Done! Shipped:

- Branch: `branch-name`
- PR: <PR_URL>
```
