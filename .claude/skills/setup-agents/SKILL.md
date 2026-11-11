---
name: setup-agents
description: Set up one Hypertask agent login on this machine with one command. Checks every dependency first, then creates or reuses the credential and proves the login. The runner shortcut /setup-runner calls the same script.
---

# Set up one agent

One command on a clean machine, from the repo root:
`.claude/skills/setup-agents/scripts/setup-agents --name "HT Growth Lead"`.

`/setup-runner <n>` is the runner shortcut: it picks a free runner number and calls
the same script with `--name "Runner <n>" --identity "RUNNER <n>"`. There is no
second implementation.

- Checks `hypertask`, `jq`, `flock`, `mktemp`, `ln`, `cat`, `readlink`, `sed` and `tr`
  before writing. Each missing tool gets its own line with the install step and the
  run exits 2 with nothing created. `--check` runs that smoke plus a login check with
  no writes; with `--name` it checks that agent's credential.
- Creates the agent in projects 15 and 11514 when no credential exists, otherwise
  reuses it. The token is published 0600 through a hard link so a racing writer is
  not overwritten, linked into the `sessions/` folder `ship-identity` reads, and
  never printed.
- Asks the server to verify the login and to confirm the board lists the credential
  under this name, so a slug shared by two names cannot write as the wrong agent.
  Prints `<name>: login ok, identity ok`, or the exact `/rename` line when this
  session does not carry the name yet.

A clean machine also needs agent-create rights (`hypertask login`) or a management
key; without one the command names that fix and saves nothing. A bad name, an empty
credential, a broken session link, a refused board call or a mismatched identity all
stop it with a plain reason; fix the cause and rerun.
