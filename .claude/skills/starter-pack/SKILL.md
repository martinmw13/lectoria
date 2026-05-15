---
name: starter-pack
description: Interactive setup wizard for new and existing projects. Detects greenfield/brownfield, copies files, customizes CLAUDE.md, installs quality gates.
---

# Starter Pack Setup Wizard

Interactive setup for new and existing projects using the agentic SDLC playbook.

## Mode Detection

Before starting, determine which mode to run:

1. Run `ls starter-pack/template/ 2>/dev/null` to check if the playbook repo's template directory exists
2. Check if `CLAUDE.md` or `.claude/` exists in the current directory

| Result | Mode |
|--------|------|
| `starter-pack/template/` exists | **Full Wizard** -- you are inside the playbook repo |
| `CLAUDE.md` or `.claude/` exists (no `starter-pack/template/`) | **Adapt Mode** -- you are inside a target project |
| Neither | **Error** -- tell the user: "Run this skill from inside the playbook repo or a project that already has starter-pack files." |

---

## Full Wizard Mode

Follow these steps in order. Do not skip steps. Ask the user before making destructive changes.

### Step 1 -- Target path

Ask the user for the path to their project. Use `AskUserQuestion` to prompt:

```text
Where is your project? Provide an absolute or relative path.
Examples: ../my-project, /home/user/projects/my-project
```

Store the answer as TARGET.

### Step 2 -- Detect context

Run these checks against TARGET:

```bash
ls <TARGET>/.git/ 2>/dev/null && echo "git: yes" || echo "git: no"
git -C <TARGET> rev-list --count HEAD 2>/dev/null || echo "0"
```

Check for project markers:

```bash
ls <TARGET>/pyproject.toml 2>/dev/null
ls <TARGET>/package.json 2>/dev/null
ls <TARGET>/requirements.txt 2>/dev/null
ls <TARGET>/dbt_project.yml 2>/dev/null
ls <TARGET>/Cargo.toml 2>/dev/null
ls <TARGET>/go.mod 2>/dev/null
ls <TARGET>/terraform/ 2>/dev/null || ls <TARGET>/*.tf 2>/dev/null
ls <TARGET>/src/ 2>/dev/null
```

Report findings to the user. Example:

```text
Found .git with 47 commits, pyproject.toml, src/ directory -- brownfield
```

Then ask the user to confirm: "Is this a **greenfield** (new, empty) or **brownfield** (existing) project?"

Store the answer as PROJECT_TYPE.

### Step 3 -- Copy files

**If greenfield:**

```bash
mkdir -p <TARGET>
cp -r starter-pack/template/. <TARGET>/
```

**If brownfield:**

```bash
mkdir -p <TARGET>/.claude
cp -r starter-pack/template/.claude/. <TARGET>/.claude/
cp starter-pack/template/CLAUDE.md <TARGET>/
```

After copying, report exactly what was copied. List the files using:

```bash
find <TARGET>/.claude -type f 2>/dev/null
ls <TARGET>/CLAUDE.md 2>/dev/null
ls <TARGET>/Justfile 2>/dev/null
ls <TARGET>/.pre-commit-config.yaml 2>/dev/null
```

### Step 4 -- Git init (greenfield only)

Only run this step if PROJECT_TYPE is greenfield AND there is no `.git/` directory in TARGET.

```bash
cd <TARGET> && git init && git add -A && git commit -m "Initial commit from agentic-sdlc-playbook starter-pack"
```

If `.git/` already exists, skip this step and tell the user.

### Step 5 -- Customize CLAUDE.md

Read the copied CLAUDE.md at `<TARGET>/CLAUDE.md`. Find all `<!-- ADAPT: ... -->` comments. For each one, ask the user what to put there using `AskUserQuestion`.

Walk through these sections interactively:

1. **Project name and description**: Ask the user for their project name and a one-line description. Replace the `<!-- ADAPT: Replace with your project name and description -->` block.

2. **Tech stack**: Offer common stacks as choices and ask the user to pick or provide their own:
   - Python + dbt + Airflow
   - Python + PyTorch + MLflow
   - Terraform + Kubernetes
   - Python + FastAPI
   - Node.js + TypeScript
   - Other (describe)

   Replace the `<!-- ADAPT: List your tech stack ... -->` comment with the chosen stack.

3. **Domain**: Ask the user to choose their primary domain. This determines which guide to use in Step 6:
   - Data Engineering
   - AI/ML
   - Data Architecture
   - Infrastructure

   Store the answer as DOMAIN.

4. **Boundaries**: Ask the user to define what the agent can do:
   - **Autonomous** (agent can do without asking): e.g., tests, docs, comments
   - **Ask first** (agent must confirm): e.g., application code changes, schema changes
   - **Prohibited** (agent must never do): e.g., production deploys, secret access

   Replace the `<!-- ADAPT: Add domain-specific prohibitions ... -->` block with their answers.

5. **Commands**: Ask the user to map the standard commands to their real tools:
   - `just test` runs what? (e.g., `pytest`, `dbt test`, `npm test`)
   - `just lint` runs what? (e.g., `ruff check .`, `eslint .`, `terraform validate`)
   - `just format` runs what? (e.g., `ruff format .`, `prettier --write .`, `terraform fmt`)

   Replace the `<!-- ADAPT: Add domain-specific commands ... -->` block.

Write the customized CLAUDE.md back to `<TARGET>/CLAUDE.md`.

### Step 6 -- Domain-specific rules

Based on the DOMAIN chosen in Step 5, read the relevant guide from this repository:

| Domain | Guide path |
|--------|-----------|
| Data Engineering | `playbook/guides/data-engineering.md` |
| AI/ML | `playbook/guides/ai-ml.md` |
| Data Architecture | `playbook/guides/data-architecture.md` |
| Infrastructure | `playbook/guides/infrastructure.md` |

Read the guide file. Extract specific rules, testing patterns, and observability patterns relevant to the user's stack.

Suggest concrete additions to these files in the target project:

- `<TARGET>/.claude/rules/coding-rules.md` -- language and framework-specific rules from the guide
- `<TARGET>/.claude/rules/testing-standards.md` -- domain-specific test categories from the guide

Present the suggested additions to the user. Ask: "Should I apply these additions? You can also edit them first."

If approved, write the additions into the respective files, replacing the `<!-- ADAPT: ... -->` placeholder blocks.

### Step 7 -- Quality gates

Check if required tools are available:

```bash
which just 2>/dev/null && echo "just: available" || echo "just: not found"
which pre-commit 2>/dev/null && echo "pre-commit: available" || echo "pre-commit: not found"
```

**If both are available:**

```bash
cd <TARGET> && just setup
```

**If either is missing**, tell the user what to install and skip this step:

```text
Missing tools:
- just: Install with `brew install just` or `cargo install just`
- pre-commit: Install with `pip install pre-commit` or `brew install pre-commit`

Skipping quality gate setup. Run `just setup` manually after installing.
```

### Step 8 -- Verification

Run this checklist and report pass/fail for each item:

1. **CLAUDE.md exists and is customized**: Read `<TARGET>/CLAUDE.md` and check that the project name section and tech stack section do NOT contain `<!-- ADAPT:` comments.
2. **`.claude/` directory is populated**: Verify these subdirectories/files exist:
   - `<TARGET>/.claude/settings.json`
   - `<TARGET>/.claude/rules/` (at least one .md file)
   - `<TARGET>/.claude/skills/` (at least one SKILL.md)
   - `<TARGET>/.claude/agents/` (at least one .md file)
   - `<TARGET>/.claude/commands/` (at least one .md file)
3. **Git repo initialized**: Check that `<TARGET>/.git/` exists.
4. **Pre-commit hooks installed**: Check if `<TARGET>/.git/hooks/pre-commit` exists (only if tools were available in Step 7).

Report in this format:

```text
Verification:
- [PASS] CLAUDE.md exists and customized
- [PASS] .claude/ directory populated (settings, rules, skills, agents, commands)
- [PASS] Git repo initialized
- [SKIP] Pre-commit hooks (tools not installed)
```

### Step 9 -- Next steps

Print this summary, filling in the project-specific values:

```text
Setup complete for <PROJECT_NAME> (<greenfield/brownfield>).

Next:
- Start claude in your project: cd <TARGET> && claude
- Verify: ask "What project is this? What conventions should you follow?"
- Read your domain guide: playbook/guides/<DOMAIN_GUIDE_FILE>
- Start with a Size-XS task to calibrate
```

---

## Adapt Mode

For projects that already have starter-pack files copied but not fully customized.

### Step 1 -- Detect uncustomized sections

Read `CLAUDE.md` and all files in `.claude/rules/`. Find sections still containing `<!-- ADAPT:` comments. Report:

```text
Found N sections that still need customization:
- CLAUDE.md: Project name, Tech stack, Boundaries
- .claude/rules/coding-rules.md: Language-specific rules
- .claude/rules/testing-standards.md: Domain-specific test categories
- ...
```

### Step 2 -- Walk through uncustomized sections

For each uncustomized section, follow the same interactive Q&A as Full Wizard Steps 5 and 6. Only touch sections that still have placeholder content. Do not overwrite sections the user has already customized.

### Step 3 -- Verification

Run the same verification checklist as Full Wizard Step 8.

---

## Domain Guide References

| Domain | Guide | Key additions |
|--------|-------|---------------|
| Data Engineering | `playbook/guides/data-engineering.md` | dbt testing, pipeline idempotency, schema safety |
| AI/ML | `playbook/guides/ai-ml.md` | Experiment tracking, model validation, reproducibility |
| Data Architecture | `playbook/guides/data-architecture.md` | Schema review, migration safety, lineage |
| Infrastructure | `playbook/guides/infrastructure.md` | Terraform plan review, cost control, IAM audit |
