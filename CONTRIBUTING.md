# Contributing

Thanks for helping. This is a small project; keeping it small is a goal.

## Setup

```bash
git clone https://github.com/YohanGarcia/agent-taskboard
cd agent-taskboard
claude --plugin-dir .          # run Claude Code with the mod loaded from this folder
```

Claude Code lays the API types into `.claude-plugin/types/` each time it loads the mod
(they are git-ignored), so `tsc -p .` type-checks it once it has loaded.

## Before you open a pull request

```bash
claude plugin validate .
claude plugin test .
```

Both must pass. Add a test for the behaviour you change; the UI is covered by mounting the
pane in `tests/pane.test.ts`.

## Rules of the road

- **Only the official Mods API.** No MCP server, no network, no child processes, no file writes.
  The only file read is `.git/HEAD`, for the branch shown in the panel.
- **Hooks observe.** Do not rewrite a user's prompt or a tool call. The only refusals are the
  plan guard on `Edit`/`Write` and `done` on a task whose last check failed.
- **Never name a local variable `h`** in a `.tsx` file: JSX compiles to calls of a global `h`.
- **`$` is passed only to top-level function declarations** in `register.tsx`; keep pure logic
  in `logic.ts` and text in `i18n.ts`.
- **Every message exists in `es` and `en`.** `tests/en.test.ts` fails if the keys differ.
- Token numbers come from `turn.step`'s `usage` and cost from `$.session.usage()`; never read a
  request's content to count tokens.
- Keep the panel readable at 40 columns.

## Reporting bugs

Open an issue with your Claude Code version (`claude --version`), the `language` and `planMode`
options, and what the panel and the transcript showed. A hook that failed leaves a dim line in
the transcript naming it; include it.
