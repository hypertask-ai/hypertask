---
name: setup-agents
description: Set up one Hypertask agent login on this machine with one command. Checks every dependency first, then creates or reuses the credential and proves the login. The runner shortcut /setup-runner calls the same script.
---

# Set up one agent

One command on a clean machine, from the repo root:

```sh
.claude/skills/setup-agents/scripts/setup-agents --name "HT Growth Lead"
```

`/setup-runner <n>` stays as the runner shortcut. It picks a free runner number and
calls this same script (`--name "Runner <n>" --identity "RUNNER <n>"`); there is no
second implementation.

## Prerequisites

Declared and checked before anything is written: `hypertask`, `jq`, `flock`,
`mktemp`, `ln`, `cat`, `readlink`. Each missing tool gets its own line naming the
tool and the install step, and the command exits 2 without creating a file.

A clean machine also needs a Hypertask login with agent-create rights
(`hypertask login`) or a management key. Without one the command names that fix
and saves nothing.

## What the command does

1. Checks the tools, then parses the name. Plain words, 64 characters at most.
   A name that looks like a credential, holds a control character, a pipe or a
   template marker is refused before any call.
2. Creates the agent on the board, in projects 15 and 11514 by default
   (`--project` repeated overrides that), when no credential exists. An existing
   credential is reused and never replaced.
3. Publishes the token under `~/.config/hypertask-agents/credentials/` with mode
   0600, through a hard link so a racing writer is never overwritten, and links it
   into the `sessions/` folder that `ship-identity` reads. No token is printed.
4. Proves the login by asking the server to verify the new token, so it works on any board the agent belongs to.
5. Prints `<name>: login ok, identity ok`, or the exact `/rename` line when this
   session does not yet carry the name.

`--check` runs only the tool and login smoke: no writes, under five seconds.
Pass `--name` to check that agent's existing credential instead of the ambient
one. Use it after an install or when a session cannot write to the board.

## When it stops

An empty or unreadable credential, a session link that is not a symlink, a refused
board call, or an identity that does not match the credential all stop the command
with a plain reason. Fix the cause and rerun the same command; already-minted
credentials are kept. Never replace a credential by hand, never reuse another
agent's login, and never run this with shell tracing.
