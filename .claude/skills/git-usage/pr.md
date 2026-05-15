# Generate PR Description

## Steps

1. **Read the PR template**: Check `.github/PULL_REQUEST_TEMPLATE.md`, use default if missing
2. **Identify the PR**: Check current branch for associated PR, or list open PRs
3. **Gather information**: Get full diff (`gh pr diff`), commit history, base branch
4. **Analyze changes**: Read the diff carefully, understand purpose and impact
5. **Generate description**: Fill out each template section thoroughly
6. **Create or update the PR**: Use `gh pr create` or `gh pr edit`

## Default Template

```markdown
## Summary
[What changed and why]

## Test Plan
[How it was verified]

## Checklist
- [ ] Tests added/updated
- [ ] Documentation updated
```

## Important

- Be thorough but concise
- Focus on "why" as much as "what"
- Include breaking changes prominently
