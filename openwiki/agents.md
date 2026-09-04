# Universal agent onboarding

**Last updated:** 2026-08-30

This is the shared operating guide for every agent provider. The provider may change; the board, repository, and CI rules do not.

## Start here

1. Read `AGENTS.md` and this page before making changes.
2. Read the relevant OpenWiki page for the code you will touch.
3. Read the [CI contract](https://hypertask.app/wiki/deployment) before changing workflows, runners, rulesets, previews, or deploy checks.
4. Use an individual Hypertask agent identity. Never copy another agent's token or credentials.
5. For board ops on this VPS, prefer the native **`hypertask`** CLI — see [Hypertask CLI usage](hypertask-cli.md).

## Board protocol

Use the approved Zig CLI as **`hypertask`** or its **`hypertask`** symlink, the MCP surface, or product UI for tickets, comments, sections, labels, and agent membership. Never use Prisma, raw SQL, a database client, or an ad-hoc production script for board content.

Before writing code for a ticket:

- Assign the ticket to Valentin (user ID `6`) without replacing other assignees.
- Move it to **In Progress**.
- Leave a short comment saying the session is actively working it.

When finished, report the changed files, verification performed, remaining risks, and the pull request or deployment URL. Mention Hypertask tickets with their full clickable URLs.

## QA lane

The formal release flow is:

```text
Bugs → In Progress → AI Review → QA → Done
```

- The shipping agent fixes the ticket, merges its pull request, verifies production, adds the plain-language closing comment, moves the ticket to **QA**, and unassigns itself.
- The **QA** column is owned by the QA Agent as the only agent assignee. The QA Agent verifies the shipped change on production on desktop and mobile, including the reported behavior and regressions. When a ticket names a feature flag, QA verifies the flagged behavior is available in its allow-listed account and unavailable in a normal member account before release to Everyone.
- A passing check adds evidence and moves the ticket to **Done**.
- A failing check adds the exact reproduction steps, moves the ticket back to **Bugs**, and assigns it to the shipping agent for repair.
- Nothing moves to **Done** without QA evidence.

Before moving a fixed ticket to **QA**, add a final comment explaining **what changed in plain language**. In 1–2 sentences, state the user-visible problem, what now works differently, and what the user will notice. A PR link, file list, or technical-only explanation is not enough.

## Review lanes and Valentin's role

Every pull request must receive automated checks and an AI code review before it can merge. There is no human code-review gate in the default workflow. **Valentin Review is not a routine code-review queue.** Valentin is not expected to read diffs, interpret test failures, or perform a first-pass security review.

Use **Valentin Review** only when a trusted reviewer needs an owner decision that code review cannot answer, such as:

- whether the product should behave this way;
- a user-visible trade-off, scope choice, or priority decision;
- whether a business, cost, security, or rollback risk is acceptable; or
- an ambiguous requirement or explicit policy exception.

When escalating, the trusted reviewer must write one plain-language question, the relevant options, its recommendation, and the consequence of waiting. Do not send “please review the code” or an unexplained failing check to Valentin. Code-quality gaps return to **In Progress**; routine low-risk PRs stay in the AI workflow and may proceed to merge after trusted AI review and green CI.

The intended flow is:

```text
producer PR → DeepSeek PRs on Hold (if lower-trust)
  → trusted AI code review → AI Review → merge/deploy
  ↘ owner decision needed → Valentin Review → answer the question → resume the AI workflow
```

## Use a managed agent identity with the CLI

An agent association on a ticket is only a marker. The session acts as an agent only when its bearer JWT contains that agent's `agentId` claim.

The Zig CLI accepts the same managed-agent bearer token as MCP. **`hypertask`** is the native binary and **`hypertask`** is a symlink to it. Use the token per process:

```bash
export HYPERTASKS_AGENT_TOKEN='paste-the-agent-jwt-here'

hypertask --token "$HYPERTASKS_AGENT_TOKEN" status
hypertask --token "$HYPERTASKS_AGENT_TOKEN" context
hypertask --token "$HYPERTASKS_AGENT_TOKEN" tasks get HTPR-1234 --project 15
hypertask --token "$HYPERTASKS_AGENT_TOKEN" comment add HTPR-1234 --text "<p>Working as the managed agent.</p>"
```

The equivalent environment-based form is:

```bash
HYPERTASKS_JWT_TOKEN="$HYPERTASKS_AGENT_TOKEN" hypertask context
```

Do not run `hypertask login --token` / `hypertask login --token` with an agent JWT if the intent is to persist into `~/.hypertask/config.json`. Keep the token in the provider's secret store or process environment, and never commit it or paste it into a ticket.

`hypertask capabilities --json` is only command discovery. It is not required to authenticate as an agent. MCP and CLI identity are the same bearer-token decision:

- MCP: send `Authorization: Bearer <agent-jwt>`.
- CLI: pass `--token <agent-jwt>` or set `HYPERTASKS_JWT_TOKEN` / `HT_TOKEN`.
- Fast local helper: set `HT_TOKEN=<agent-jwt>` before `ht METHOD /mcp/path`; it overrides only that process's bearer token and does not alter the saved user session.

The managed agent must still be a member of board 15. Check access with `hypertask --token "$HYPERTASKS_AGENT_TOKEN" project members 15` before changing a ticket.

Full runbook (usage + how to extend the Zig CLI): [Hypertask CLI usage](hypertask-cli.md).

This only changes **Hypertask board operations**. It does not change the GitHub account used by `git`, `gh`, pull requests, commits, or pushes. Those use the coding session's separate GitHub credentials.

## Repository protocol

- Work from `/home/valentin/projects/hypertask-oss`, the clean-history clone of public `hypertask-ai/hypertask`.
- Branch from `origin/production`; open pull requests against `production`. `main` is kept in lockstep with production, not used as the PR base.
- The former private repo (`valentinyeo/hypertasks`, now `hypertask-ai/hypertasks`) is a frozen archive whose history contains a 2023 `.env` commit with live secrets. Never push to it, mirror it, or base public work on it.
- `AGENTS.md`, `CLAUDE.md`, `openwiki/`, and `.env.local` are untracked via `.git/info/exclude` and copied into fresh worktrees by the worker runtime.
- Preserve unrelated dirty worktree changes. Never use `git stash`, broad resets, or destructive cleanup.
- Read the relevant architecture and workflow docs before editing code.
- Run focused tests and inspect `git diff --check` before handing work off.
- Vercel previews are opt-in. If one was requested, do not repeatedly reload it while queued; poll deployment status headlessly, then verify once ready.

## Worktree and branch cleanup

Sessions are temporary. They must leave no merged feature worktree or branch behind.

The earliest safe cleanup point for a feature is:

1. The PR is **merged** into `production`; approval or a green PR is not enough.
2. The production deployment for that merge is **READY and health-checked**. A queued Vercel build is not live.
3. The worktree is clean: `git status --short` returns no output.
4. No process or other session is using the worktree.
5. The worktree is not `production`, `main`, or another session's active worktree.

At that point the merged commit is safely on the remote `production` branch and Vercel deploys from the remote branch, so the local worktree is no longer needed for rollback. A session should not delete its own current working directory. Instead, report `CLEANUP_READY` with the absolute worktree path and branch; a supervisor removes it after the session exits:

```bash
git worktree list
git -C /absolute/path/to/worktree status --short --branch
git worktree remove /absolute/path/to/worktree
git branch -d feature-branch
git push origin --delete feature-branch
```

Use `git branch -d`, not `-D`, and delete the remote branch only after the PR is merged or explicitly closed. Never remove a dirty worktree, an open-PR branch, or a path shown as another process's current directory. Never use `git stash` in this multi-session repository.

If a session stops before merge, it must push its branch and leave a handoff. It must not silently remove the only copy of unfinished work.

## Provider adapters

The `/hypertask-agent` skill is a Claude-specific convenience layer. It is not a separate policy and it is not required. OpenAI, DeepSeek, and other agents should follow this page directly with the CLI or approved API surface.

For model selection, Codex has the equivalent `/intensity` skill. It recommends the cheapest model and lowest effort that still fit the current task; it does not change board identity or CI behavior.

## Low-trust producer handoff

The full local directive is [`openwiki/low-trust-agents.md`](low-trust-agents.md). Read it before producing a pull request with DeepSeek/Pi or another lower-confidence session.

DeepSeek/Pi and other lower-confidence producer sessions may create code and pull requests, but they must not merge or enable auto-merge. After opening a PR, the producer itself must:

1. Add the GitHub `hold` or `valentin-review` label.
2. Verify that auto-merge is disabled.
3. Move the board 15 ticket to **DeepSeek PRs on Hold**.
4. Stop and report the PR URL, label, board status, and checks.

The board column is a queue, not a GitHub merge gate; both the board status and the PR hold label are required. A trusted reviewer session batch-reviews the queue and handles low-risk merges. **Valentin Review** is reserved for human/business escalations, not routine code review. If the hold column is missing, stop and report it rather than substituting another column.

## Canonical references

- Human-readable onboarding: [https://hypertask.app/wiki/agents](https://hypertask.app/wiki/agents)
- Human-readable CI contract: [https://hypertask.app/wiki/deployment](https://hypertask.app/wiki/deployment)
- Live runner and queue status: [https://hypertask.app/ci](https://hypertask.app/ci)
- Visual release flow: [https://hypertask.app/pipeline](https://hypertask.app/pipeline)
- Local CLI runbook: `openwiki/hypertask-cli.md`
- Model/effort recommendation: `/intensity` in Codex, or the provider's equivalent
- Low-trust producer directive: [`openwiki/low-trust-agents.md`](low-trust-agents.md)
