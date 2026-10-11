# Security

agent-taskboard observes your session (prompts, tool calls, subagents) and keeps short summaries
of plans and check commands in Claude Code's own per-plugin store on your machine. It makes no
network requests, runs no processes of its own and writes no files. The only file it reads is
`.git/HEAD` (or the `.git` file of a worktree), to show the branch.

What it can do to your session:

- add one section to the system prompt explaining the `plan` and `task` tools;
- refuse `Edit`/`Write` from the main loop while a complex request has no plan (`planMode: block`);
- refuse to mark a task done while its last check failed.

It never rewrites a prompt or a tool call.

## Reporting a vulnerability

Please report privately through GitHub: **Security → Report a vulnerability** on this repository,
rather than in a public issue. Include the Claude Code version and a minimal way to reproduce.
