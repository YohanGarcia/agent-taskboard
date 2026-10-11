# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.6.0] - 2026-10-11

### Added
- Delete from the history: `/taskboard history drop <n>`, `/taskboard history clear` and an `x` action in the
  detail of an entry. The history list is numbered, 1 being the most recent.

## [0.5.0] - 2026-10-11

### Added
- Claude Code's own plan is mirrored on the board: the plan approved in plan mode (`ExitPlanMode`) and the
  `TodoWrite` list become tasks, with their statuses, without the model calling `plan`.

### Changed
- A plan's duration is the time spent working on it (the union of its tasks' running stretches), not the clock time since it was created: a plan left open overnight no longer reads as 12 hours.
- Check commands are shown without the leading `cd <folder> &&`, so a clipped command still says what ran.
- The README shows the panel (`docs/panel.png`).

### Fixed
- A plan approved in plan mode or a `TodoWrite` list now lifts the "no plan yet" guard on `Edit`/`Write`.
- The plan-guard no longer blocks writing the plan file (`.claude/plans/`), which made plan mode impossible to finish while a complex request was pending.
- A board fed by `TodoWrite` is no longer auto-started by the first tool call: the list's statuses are the truth.

## [0.4.0] - 2026-10-10

### Added
- Tokens per task: the main agent's and its subagents', split into fresh input, output and cache.
- Session cost per task and a plan total, also kept in the history.
- `/taskboard stats`: the detail per task and an estimate of the mod's own per-request overhead.

### Changed
- Stored plans from older versions are brought up to the new shape when they are restored.
- Option titles and descriptions in the manifest are bilingual (Spanish / English).

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
- The panel footer shows the project root and the git branch (read from `.git/HEAD`, no process), pinned to the bottom edge of the panel.

### Changed
- A long request no longer counts as complex unless it names an action.
- Redesigned panel: title card, padding, status counters, highlighted active task.

### Fixed
- The panel drew nothing because a local variable named `h` shadowed the JSX factory.

## [0.1.0] - 2026-10-10

### Added
- First version: side panel, `plan` and `task` tools, plan-before-work guard,
  persistence per project and history.
