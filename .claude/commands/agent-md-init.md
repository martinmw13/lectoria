# CLAUDE.md Initialize

Initialize a new CLAUDE.md file with AI-generated, context-aware content for a subdirectory.

## Usage

```bash
claude agent-md-init [options] <target_directory>
```

## Arguments

- `target_directory` (required): Directory path where CLAUDE.md should be created (relative to project root)

## Options

- `--type <type>`: Type of CLAUDE.md to create (default: auto-detect)
  - `service`: Service/application module
  - `package`: Library/package
  - `feature`: General feature directory
  - `tool`: Development tool or utility
- `--name <name>`: Human-readable name for the component (optional, inferred from directory)
- `--force`: Overwrite existing CLAUDE.md file

## What This Command Does

1. **Analyzes Target Directory**: Examines existing code structure, file patterns, and dependencies
2. **Detects Context Type**: Automatically determines the component type
3. **Generates AI Content**: Creates context-appropriate CLAUDE.md using AI analysis
4. **Follows Project Patterns**: Applies conventions from the root CLAUDE.md
5. **Creates Relevant Sections**: Adds testing strategies, commands, and dependency information

## Generated Sections

Based on detected context:

- **Component Context**: Purpose and scope
- **Architecture**: Design patterns specific to the component
- **Key Files**: Important files and their purposes
- **Testing Strategy**: Component-specific testing approaches
- **Commands**: Useful development commands
- **Dependencies**: Integration points and requirements

## Auto-Detection Logic

- **Python Service**: Detects `__init__.py`, service modules
- **Package**: Detects `package.json`, `pyproject.toml`
- **Feature Directory**: General-purpose directory without specific patterns
