# Commit Changes

## Process

1. **Review what changed**: Run `git status` and `git diff` to understand modifications
2. **Plan commits**: Identify which files belong together, draft clear messages
3. **Present plan**: List files and commit messages, ask for confirmation
4. **Execute**: Use `git add` with specific files (never `-A` or `.`), create commits

## Commit Message Convention

Use conventional commits: `type(scope): description`

Types: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`

## Rules

- Group related changes together
- Keep commits focused and atomic
- Write messages as if the user wrote them
- Do not include co-author or AI attribution in commits
