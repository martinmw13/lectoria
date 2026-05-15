# Changelog

All notable changes to **Lectoria** are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Project is pre-1.0 — minor versions may include breaking changes until the first
tagged release.

## [Unreleased]

### Added

- Engineering harness: `justfile`, scoped Claude rules in `.claude/rules/`, PR
  template, Dependabot config, and CI workflow with three required checks
  (`Backend`, `Frontend`, `Pre-commit hooks`) (#2).
- `CHANGELOG.md` following Keep a Changelog.

### Changed

- Bumped GitHub Actions group (4 updates) (#3).
- Bumped `@types/node` from 24.12.0 to 25.8.0 (#9).
- Bumped Python minor/patch group (11 updates) (#10).
- Bumped `google-genai` from 1.68.0 to 2.3.0; upstream breaking changes are
  limited to Interactions, which we don't use (#11).
- Upgraded frontend tooling: ESLint 9 → 10, TypeScript 5.9 → 6.0,
  `typescript-eslint` 8.56 → 8.59, `eslint-plugin-react-hooks` 7.0 → 7.1, plus
  the npm minor/patch group (react/react-dom, react-router-dom, vite,
  `@vitejs/plugin-react`, globals). Consolidates Dependabot PRs #4, #6, #7, #8.

### Fixed

- Resolved both `react-hooks/exhaustive-deps` warnings in `MusicPlayer.tsx`
  and `ReaderPage.tsx`; frontend now lints with 0 errors / 0 warnings (#5, #12).
- Removed redundant state-reset block from `PageView` effect to satisfy the new
  `react-hooks/set-state-in-effect` rule introduced in
  `eslint-plugin-react-hooks` 7.1; state is already reset on page navigation
  via the parent's `key` prop.

[Unreleased]: https://github.com/martinmw13/lectoria/compare/main...HEAD
