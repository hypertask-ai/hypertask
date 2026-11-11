---
name: setup-agents
description: Set up one Hypertask agent login on this machine with one command. Checks every dependency first, then creates or reuses the credential and proves the login. The runner shortcut /setup-runner calls the same script.
---

# Set up one agent

One command on a clean machine, from the repo root:

```sh
.claude/skills/setup-agents/scripts/setup-agents --name "HT Growth Lead"
```

`/setup-runner <n>` stays as the runner shortcut: it picks a free runner number and
calls this same script with `--name "Runner <n>" --identity "RUNNER <n>"`. There is
no second implementation.

What the command does:

1. Checks `hypertask`, `jq`, `flock`, `mktemp`, `ln`, `cat`, `readlink`, `sed`, `tr`
   before writing anything. Each missing tool gets its own line with the install
   step, and the run exits 2 with nothing created.
2. Parses the name: plain words, 64 characters at most. A name that looks like a
   credential, or holds a control character, a pipe or a template marker, is
   refused before any call.
3. Creates the agent in projects 15 and 11514 when no credential exists. An existing
   credential is reused, never replaced, and published 0600 through a hard link so a
   racing writer is not overwritten. The token is linked into the `sessions/` folder
   `ship-identity` reads, and never printed.
4. Asks the server to verify the login, so it works on any board the agent joins.
5. Prints `<name>: login ok, identity ok`, or the exact `/rename` line when this
   session does not yet carry the name.

A clean machine also needs agent-create rights (`hypertask login`) or a management
key; without one the command names that fix and saves nothing. `--check` runs only
the tool and login smoke: no writes, under five seconds, and with `--name` it checks
that agent's existing credential.

An empty or unreadable credential, a session link that is not a symlink, a name
that lands on a slug another agent name already owns, a refused board call, or an
identity that does not match all stop the command with a plain reason. Fix the cause and rerun; already-minted credentials are kept. Never replace
a credential by hand, never borrow another agent's login, and never run this with
shell tracing.
