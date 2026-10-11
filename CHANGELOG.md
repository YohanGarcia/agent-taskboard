# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-10-10

### Added
- Spanish and English messages with a `language` option (`auto`, `es`, `en`).
- `extraChecks` option: your own commands that count as a check.
- Checks recognised for `claude plugin test`, `claude plugin validate`, `make test`
  and `npm run check|validate|verify`.
- Subagents are attached to the task named at the start of their description
  (`t2: review types`).
- History detail and resuming a past plan from the panel.
- `planMode` option (`block`, `warn`, `off`) and a visible notice with a "skip plan" button.

### Changed
- A long request no longer counts as complex unless it names an action.
- Redesigned panel: title card, padding, status counters, highlighted active task.

### Fixed
- The panel drew nothing because a local variable named `h` shadowed the JSX factory.

## [0.1.0] - 2026-10-10

### Added
- First version: side panel, `plan` and `task` tools, plan-before-work guard,
  persistence per project and history.
