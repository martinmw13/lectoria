# Repo Config: _example

<!-- ADAPT: Copy this file to <your-repo-name>.md and fill in the values below.
     The repo name must match the name extracted from `git remote get-url origin`. -->

## Variables

- **REPO_URL**: `https://github.com/YOUR_ORG/YOUR_REPO`
- **SLACK_CHANNEL_ID**: `YOUR_SLACK_CHANNEL_ID`
- **SLACK_CHANNEL_NAME**: `your-channel-name`

---

## Phase 4: Pre-PR Steps

<!-- ADAPT: Define the repo-specific steps that must run before creating a PR.
     Below are common patterns — pick what applies to your repo and delete the rest. -->

### Pattern A: Application with tests and version bump

```bash
# 1. Run tests
your-test-command   # e.g., poetry run pytest, npm test, cargo test

# 2. Run linter/type checks
your-lint-command   # e.g., poetry run ruff check ., npm run lint

# 3. Build (if applicable)
your-build-command  # e.g., npm run build, cargo build --release
```

- Bump version in your manifest file (`pyproject.toml`, `package.json`, `Cargo.toml`, etc.)
- Update `CHANGELOG.md`
- Commit: `chore: Bump version to X.Y.Z and update changelog`

### Pattern B: Infrastructure / IaC repo (no app tests)

- Validate config files (Terraform: `terraform validate`, JSON: `jq .`, YAML: python yaml check)
- Summarize infrastructure changes in the PR description (resources created/modified/destroyed, downtime risks)

### Pattern C: Data pipeline repo

- Generate manifests if pipeline definitions changed (e.g., `dbt compile`, `dbt docs generate`)
- Run local pipeline tests if available
- Bump version and update changelog

### Pattern D: Database migrations

- If ORM models were modified, confirm a migration was generated (e.g., `alembic check`, `prisma migrate status`)
- Review the generated migration for correctness before committing
