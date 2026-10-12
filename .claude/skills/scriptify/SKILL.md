---
name: scriptify
description: Weekly discovery of repeated agent shell routines, with one Codex helper producing tested scripts for a runner to ship.
---

# Scriptify

Run from the app checkout:

```bash
.claude/skills/scriptify/scripts/scriptify-weekly --scan-only
.claude/skills/scriptify/scripts/scriptify-scan --days 7 --json
python3 .claude/skills/scriptify/scripts/scriptify.test.py
```

The scanner reads recent Claude and Codex JSONL files, never executes transcript commands, and stores only normalized patterns and counts in `~/.local/state/scriptify/<date>/candidates.{md,json}`. It ranks 2 to 6 step routines repeated in at least three sessions. Already scripted routines stay marked in JSON and are excluded from the top ten markdown candidates. Activity is skipped because no cheap cross-session command read is available. Usage is apportioned when present; immediately repeated exact commands count as errors. Unknown arguments are placeholders, including quoted strings and potential secrets.

`scriptify-weekly` holds a user-wide lock, scans, then starts at most one high-effort Codex helper with the current ladder line and unlazy gates. No candidates means no helper. It creates a fresh `scriptify/<date>` worktree off fetched `origin/production`, retains it for the runner, and records committed clean work in `handoff.md`. It never pushes or writes to boards. Helper output is discarded so logs cannot persist secrets. Failures exit non-zero; inspect the retained worktree before a retry, never delete or reuse it implicitly.

The helper scripts only grounded routines, adds tests, points the original skill to the script, and updates [scoreboard.md](scoreboard.md). A runner ships the handoff with `/ship` under a new project 4060 ticket.

Install only after shipping, from a durable production checkout (not a disposable worktree):

```bash
.claude/skills/scriptify/scripts/scriptify-weekly install
```

This copies the wrapper, scanner and user units, records the durable checkout path, and enables `scriptify.timer`: Monday 03:30, persistent, idle priority, 2 GB memory and three-hour timeout. Requires Python 3, Git, systemd user services, `hax` on PATH and `~/projects/token-ladder/bin/token-ladder hook-prompt`. No new credentials or database access.
