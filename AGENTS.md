## Universal agent onboarding

Start with the [OpenWiki quickstart](openwiki/quickstart.md), which is the repository entrypoint for every provider. The rendered human-readable guide is [https://hypertask.app/wiki/agents](https://hypertask.app/wiki/agents).

All agents follow the same operating contract, regardless of whether they run through Claude, OpenAI, DeepSeek, or another provider:

- Use an individual Hypertask agent identity. Never copy another agent's token or credentials.
- For board work, use the approved `hypertask` CLI, MCP surface, or product UI. Never use Prisma, SQL, or a database client for ticket content.
- Before coding on a ticket, assign it to Valentin, move it to **In Progress**, and leave a short working-session comment.
- Read [the CI contract](https://hypertask.app/wiki/deployment) before changing workflows, runners, rulesets, previews, or deploy checks. Lower-confidence producers must also read [`openwiki/low-trust-agents.md`](openwiki/low-trust-agents.md) before opening a PR.
- If the `/hypertask-agent` skill is available, use it as the Claude adapter. Other providers must follow the same board protocol directly.

## No specializations: every agent takes every ticket

There are no specialist agents any more (Valentin, 2026-08-27). All agents carry the same knowledge, so routing tickets by speciality only stalled them. Whatever you pick up is yours to finish, including CLI, MCP, and API tickets. Never hand a ticket off because it "belongs to" another agent.

A ticket about the `hypertask` CLI, the MCP server, or an `/api/mcp/*` route is fixed in a **different repository**, which is why these used to stall:

- CLI source: `~/projects/hypertask-cli-zig` (Zig `hypertask`), remote [`hypertask-ai/cli`](https://github.com/hypertask-ai/cli), PRs base `main`
- Tests: `zig build test` and `python3 scripts/parity_test.py`
- MCP/API in this app repo still applies for server-side `/api/mcp/*` changes

Work a CLI ticket in a worktree off `hypertask-ai/cli` the same way you would here: branch from `origin/main`, fix, test, PR, then comment the PR link on the ticket. Do not try to fix a CLI bug inside this repository, and do not park it as blocked. The Node CLI (`@hypertask/hypertask_cli`) is retired; do not extend it. A hidden `htz` symlink still points at `hypertask` for old scripts — do not use `htz` in new work.

Managed agent tokens work with the CLI as well as MCP. Use `hypertask --token "$AGENT_TOKEN" ...` or `HYPERTASKS_JWT_TOKEN="$AGENT_TOKEN" hypertask ...`; do not save an agent token with `hypertask login`.

For model and reasoning-effort selection, use Codex `/intensity` when available. It is a recommendation layer, not a required provider or board identity.

Sessions must clean up after shipping: after the PR is merged into `production`, production is health-checked, and the worktree is clean and unused, report `CLEANUP_READY` with its absolute path and branch. A supervisor removes the worktree and branch after the session exits. Never delete your own active cwd, another session's worktree, a dirty worktree, or an open-PR branch.

## OpenWiki

This repository has documentation located in the /openwiki directory.

Start here:
- [OpenWiki quickstart](openwiki/quickstart.md)
- [Claude project guide](CLAUDE.md)

OpenWiki includes repository overview, architecture notes, workflows, domain concepts, operations, integrations, testing guidance, and source maps.

When working in this repository, read the OpenWiki quickstart and `CLAUDE.md` first, then follow the relevant OpenWiki links for architecture, workflow, domain, operation, and testing notes.

## Hypertask Ticket Access

Hard rule: never read or write Hypertask ticket content directly through Prisma, raw SQL, database clients, or production database access. This includes "read-only" ticket lookups. Tickets, comments, inbox items, and task mutations must go through the product interface or approved CLIs/API surfaces so auth, permissions, activity, notifications, and side effects stay intact.

Use the Hypertask CLI for ticket work (prefer **`hypertask`** on this VPS — full native Zig CLI; see [openwiki/hypertask-cli.md](openwiki/hypertask-cli.md)):

```bash
hypertask status
hypertask tasks get HTPR-3976 --project 15
hypertask comment list HTPR-3976 --project 15
hypertask search "query" --project 15
hypertask capabilities --json
```

The CLI binaries currently available on the dev machine are:
- `hypertask` — native Hypertask CLI (Zig, `hypertask 0.2.0 (zig)`); talks to `/api/mcp/*` and reads `~/.hypertask/config.json`.
- `ht` — low-level MCP helper (`ht METHOD /mcp/path [json-body]`).
- `openwiki` — repo documentation CLI; use headless `openwiki -p "..."` / `openwiki --update -p "..."`.
- `zsb` — browser automation/debugging CLI for the active remote browser/tab.

A hidden `htz -> hypertask` symlink remains for old scripts. Do not use `htz` in new commands or docs.

When a user provides a URL like `https://app.hypertask.ai/detail/project-15/3976`, treat it as a Hypertask ticket and use the CLI/product surface first. If the CLI cannot access it, ask the user for the ticket text or authorization context; do not fall back to database inspection.

When referencing a Hypertask ticket in conversation, write the full clickable app URL every time, inline with the sentence. Do not rely on only `HTPR-3976`, `ticket 3976`, or a ticket key without the URL. Prefer the raw URL or a Markdown link whose visible text is the full URL, for example `https://app.hypertask.ai/detail/project-15/3976`. If asking the user to inspect something in the browser, provide the exact URL for use with ZSB or the app UI; if the user asks to open it, run `zsb open <url>` instead of only describing where to click.

## Ticket comments

- `--text` takes either plain text (auto-converted to `<p>`/`<ul>` HTML) **or** complete, well-formed HTML (passed through as-is). Don't mix them: once `--text` contains any HTML tag (e.g. an `<a>`), the backend stops converting markdown, so bare newlines won't render as paragraphs and the comment looks unformatted.
- For links (PRs, related tickets, commits), use HTML anchors — bare URLs and `#1234` are not auto-linked: `<a href="https://github.com/valentinyeo/hypertasks/pull/1288">PR #1288</a>`.
- Supported inline tags: `<p>`, `<strong>`, `<code>`, `<a>`, `<ul>`/`<li>`, `<h2>`.
- Edit in place with `hypertask comment update <id> --text ...` instead of deleting and reposting — keeps the thread tidy.
- Keep it short: one summary line, then **Gap / Fix / Status**. Skip the wall of explanation.
- Before moving a fixed ticket to **Done**, its final comment must explain **what changed in plain language**. In 1–2 sentences, state the user-visible problem, what now works differently, and what the user will notice. A PR link, file list, or technical-only explanation does not satisfy this rule.

## Claim a ticket before working it (collision avoidance)

The moment you actually start working a ticket (writing code / doing the fix, not just reading or triaging), make it visible on the board so no one else picks up the same work:

1. Assign Valentin (userId 6): `hypertask tasks assign <PREFIX-NNN> --assignee 6` (additive, do not replace existing assignees).
2. Move it to In Progress: `hypertask tasks move <PREFIX-NNN> --section "In Progress"`.
3. Leave a short comment saying a session is actively working it now.

Signal: **assigned to Valentin + In Progress = in flight, do not touch.** Abdul self-assigns tickets he picks up; **never work a ticket assigned to Abdul** — leave it and pick another.

## Repository Workflow

Follow the branch/deploy model from `CLAUDE.md` and `openwiki/deployment.md`:

- Production is Vercel project `hypertasks-prod`, deployed from the `production` branch to `app.hypertask.ai`.
- New work branches off `origin/production`; PRs target `production`, never `main`.
- After opening a PR, enable auto-merge: `gh pr merge --auto --squash`. The repo allows auto-merge, but it is **per-PR** — opening the PR alone does not turn it on. (Low-trust producers must leave it off; see [`openwiki/low-trust-agents.md`](openwiki/low-trust-agents.md).)
- `main` is frozen legacy and only feeds the EC2 warm-rollback box.
- Every pushed branch gets a Vercel preview. Previews are SSO-protected and share the live production database, so they are for visual verification only, not destructive testing.
- Branches older than 2026-07-06 should be rebased onto `origin/production` before preview work.
- Multiple agents and worktrees may be active at once. Never use `git stash`; it is shared across worktrees. Never reset, checkout, or revert files you did not intentionally change.
- Before committing, inspect `git status --short --branch` and separate your changes from pre-existing dirty worktree changes.
- While a Vercel preview is still building/queued, never poll it by repeatedly navigating/reloading a browser tab (zsb/agent-browser/Playwright) — on zsb that's Valentin's real Edge pane, and looping reloads a heavy React app for no gain. Poll headlessly instead (`curl -s -o /dev/null -w "%{http_code}" <preview-url>` or `gh pr checks`), and only open the browser once the deployment is actually ready to verify.

## CI contract

Read the [canonical CI contract](https://hypertask.app/wiki/deployment) before changing workflows, runner services, rulesets, required checks, or preview behavior. The fixed-cost model keeps substantive CI on the existing Contabo host, uses Vercel previews only when requested or justified by runtime risk, and bounds heavy-job concurrency to protect release speed. Do not add a VPN runner or another host implicitly.

## Stack Orientation

This is a Next.js 14 app with both App Router and legacy Pages Router surfaces. Business logic usually belongs in shared controllers under `src/utils/controllers/`, not only in route files. Important shared systems include Firebase/JWT auth, Prisma/Postgres, QStash background jobs, Pusher-protocol realtime, Turbopuffer search, SendGrid email, Stripe billing, and native AI routes under `src/app/api/ai/`.

Before changing a feature, trace the entry point through middleware, route handler, controller/service layer, queue side effects, auth/cookie behavior, and realtime/cache invalidation where relevant.

## Feature flags for new user-facing behavior

- Every new feature, screen, control, shortcut, API route, or user-visible behavior change requires one ticket-specific feature flag.
- Name the key after the ticket, for example `htpr-6091-feature-flags`; never reuse a flag for another feature.
- New flags always default to **Only me**. Developers never release them; Valentin changes the mode at `/admin/flags`.
- Gate protected behavior on the server. `useFlag` only hides client UI and never replaces API authorization.
- The label on the ticket does not decide this; the effect does. If a user will see, click, type, or read anything differently after the change ships, it needs a flag, even when the ticket is called a bug. Layout, wording, flow, timing, defaults, shortcuts, embeds, and autocomplete behaviour all count.
- Exempt only when nothing visible changes: a fix that makes a broken thing do exactly what it did before (crash, 500, wrong or lost data), performance work with identical output, security fixes, dependency or CI changes, spelling corrections, and tickets carrying the **AI CHAT 💬** label.
- When in doubt, add the flag. Removing an unneeded flag costs one ticket; shipping a UX change without one costs a rollback.
- The merge freeze for a required flag does not apply to tickets carrying the **AI CHAT 💬** label.
- Reviewers must block feature or UI pull requests that omit the required flag.
- After a flag has stayed on **Everyone** for 14 days, create a follow-up ticket to remove the flag and dead branch.
