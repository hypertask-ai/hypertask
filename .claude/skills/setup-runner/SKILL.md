---
name: setup-runner
description: Turn a fresh Claude Code session into a neutral runner with /setup-runner, optionally followed by a runner number. Set up its own login, verify its identity, then follow /ship to pick the top free ticket of any type.
---

# Set up a runner

Valentin types `/setup-runner` or `/setup-runner 5` in a fresh session in `~/projects/hypertask`.

1. Run `.claude/skills/setup-runner/scripts/setup-runner` from the repo root, passing the optional number as one argument. A session already named `RUNNER <n>` keeps its number. Otherwise the script uses the requested number or picks the first number without a token or another live runner. It creates a login for boards 15 and 4060 only if needed, keeps existing tokens, and verifies a ticket read. Never display a token or run this with shell tracing.
2. If it prints `/rename RUNNER <n>`, that is the one thing Valentin types. Wait for him, then rerun the script with that same number. Claude's `--name` sets a name at startup, not safely on the running parent session. Do not edit session JSON or resume a second Claude process to rename it. Do not start board work until the script reports `identity ok`. On any failure, stop and fix the cause, never continue as the fallback identity.
3. Tell Valentin in one line: `I am RUNNER <n>, logged in and ready to follow /ship.`
4. Read `.claude/skills/ship/SKILL.md` fully and follow it from **Before anything else**, with no ticket given. Run its board check, respect claims and stale-ticket decisions, then pick the top free ticket of any type. Keep the runner name. `/ship` owns the ledger, claim, fix, review, deploy, live QA and cleanup. Do not replace it with your own workflow.

## Codex execution only

Valentin, 2026-10-03: all delegated execution goes to Codex so we use the Codex account's tokens. Coding, tests, research and big-file reading run in background helpers with `hax --provider=codex --model=gpt-6.1-sol --effort=high --no-session -p "<task>"`. Never use the Agent tool or Claude subagents for delegated work. The runner's Claude session only plans, judges, reviews and talks to Valentin, apart from the setup and /ship coordination commands above. Give each helper an unlazy ledger and reverify its gates as /ship requires.
