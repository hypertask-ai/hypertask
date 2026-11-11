---
name: setup-agents
description: Set up one Hypertask agent login on this machine with one command. Checks every dependency first, then creates or reuses the credential and proves the login. The runner shortcut /setup-runner calls the same script.
---

# Set up one agent

From the repo root: `.claude/skills/setup-agents/scripts/setup-agents --name "HT Growth Lead"`.
`/setup-runner <n>` is the runner shortcut: it picks a free runner number and calls
the same script with `--name "Runner <n>" --identity "RUNNER <n>"`.

- Checks `hypertask`, `jq`, `flock`, `mktemp`, `ln`, `cat`, `readlink`, `sed` and `tr`
  before writing, names each missing tool with its install step, and exits 2 with
  nothing created. `--check` is that smoke plus a login check with no writes; with
  `--name` it checks that agent's credential.
- Creates the agent in projects 15 and 11514 when no credential exists, otherwise
  reuses it. Publishes the token 0600 through a hard link so a racing writer is never
  overwritten, links it into `sessions/` for `ship-identity`, and never prints it.
- Verifies the login with the server, requires the agent to be a member of both boards
  and listed under this name, then prints `<name>: login ok, identity ok` or the exact
  `/rename` line.

Needs agent-create rights (`hypertask login`) or a management key. A bad name, an empty
credential, a broken session link, a refused board call or a mismatched identity stop
it with a plain reason; fix the cause and rerun.
