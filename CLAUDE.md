# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Ticket references — always full clickable URLs, never bare IDs

Every time you mention a Hypertask ticket anywhere (chat, comments, PR bodies, ticket bodies, status lists), output the **full clickable URL**, never a bare ID like `HTPR-3818`. Format: `https://app.hypertask.ai/detail/project-{projectId}/{numericTaskId}` (product board = project 15). A bare ID is dead text Valentin cannot click. This applies to EVERY mention, including passing references and comma-separated lists — write each one as a full URL.

## Hypertask app operations — CLI/MCP only, never direct DB

Hard rule: for Hypertask app operations (creating/editing/deleting tickets, comments, project sections, labels, users, notifications, or any user-facing board content), use the `hypertask` CLI, MCP endpoints, or existing authenticated app APIs. Never use Prisma, raw SQL, or direct database access for these — even for "read-only" lookups. Direct DB writes are reserved for explicit dev/database tasks: migrations, schema work, data repair requested as DB repair, local seed/dev data, or carefully reviewed production maintenance with explicit approval.

Reason: an agent once created and reverted Hypertask ticket records by writing directly through Prisma instead of the CLI — bypassing auth, permissions, activity logging, and notifications. See `https://app.hypertask.ai/detail/project-15/3891` for the incident and `https://app.hypertask.ai/detail/project-15/3892` for this prevention rule.

Concrete commands (see `openwiki/hypertask-cli.md` for the full runbook):

```bash
hypertask status --json
hypertask project list --json
hypertask section list --project 15 --json
hypertask task create --project 15 --section Triage --title "..." --description "..." --json
```

URL format: `https://app.hypertask.ai/detail/project-{projectId}/{uniqueIndex}` (product board = project 15).

## Explorations always carry the standard hypertask.app header

Hard rule (Valentin, 2026-07-26): every page served on `hypertask.app` — including EVERY exploration/artifact under `/explorations/<id>` — must show the standard site header menu (with hamburger on mobile) so Valentin can always navigate back to the regular structure. Explorations are NOT exempt. This is enforced server-side: `src/pages/explorations/[id].ts` in `~/projects/hypertask-analytics` injects a self-contained nav fragment (marker `<!--ht-nav-->`) into every served HTML artifact. Do not strip that injection, and do not build artifacts that visually suppress or overlay the injected header. Recurring reports (not one-off explorations) should graduate to a real page in the analytics app (e.g. `/shipping`) with a navbar entry in `src/layouts/Base.astro`.

## Active work is claimed as Product Bot, never as Valentin (rewritten 2026-09-15)

Hard rule: the moment a session starts working a ticket (writing code, doing the fix, not just reading), it makes that visible on the board so nobody else picks it up:

1. **Post a "Claimed." comment as Product Bot** (`htbot comment add <PREFIX-NNN> --text "<p><strong>Claimed.</strong> Session working it now.</p>"`) and move it to "In Progress" (`htbot task move <PREFIX-NNN> --section "In Progress"`). Board writes go through `htbot` (Product Bot identity), never through Valentin's own CLI token.
2. **No agent or session ever writes in Valentin's name (Valentin, 2026-09-15).** No ticket, comment, assignment or move goes through his user token; board writes use an agent identity. Never assign Valentin (userId 6) to any ticket. Only Valentin assigns himself. A ticket he assigned to himself or moved by hand is a manual override: leave it exactly as it is.
3. Add the `valentin` label only when Valentin himself is doing the work in the session; a session working on his behalf does not label.

The signal is: **Claimed. comment + In Progress = in flight, do not touch.** Abdul self-assigns tickets he picks up; **we never work a ticket that is assigned to Abdul.**

## Deploys and branches (repo `hypertask-ai/hypertask`, since 2026-08-29)

- **Production deploys from branch `production` of `hypertask-ai/hypertask`.** Merging to `production` deploys app.hypertask.ai within ~3 minutes. There is no other prod gate.
- **Never base work on the old `valentinyeo/hypertasks` `staging`/`main` branches.** They are legacy; the private repo stays private (its history holds a 2023 `.env` commit).
- **Workflow for every session:** branch off `origin/production` -> push -> open PR with base `production` -> **enable auto-merge immediately** (`gh pr merge --auto --squash`). Repo `allow_auto_merge` only permits the feature; each PR still needs it flipped on or it sits green forever. Exception: low-trust producers must leave auto-merge off (see `openwiki/low-trust-agents.md`). Vercel previews are opt-in (see 'Preview builds and login' below), never a default gate.
- **Previews share the LIVE database** (preview env DATABASE_URL = production Neon). Safe to click around, not safe for destructive testing.
- Branches created before 2026-07-06 may fail preview builds (they reference removed tracker env vars). Fix: rebase onto `origin/production`.
- Git stash is shared across all worktrees of this repo and multiple agent sessions run concurrently: NEVER `git stash` here.

## Waiting on a Vercel preview build — never poll via repeated browser navigation

Hard rule: when a preview deployment is still building/queued, do NOT poll it by repeatedly `navigate`-ing (or reloading) a browser tab (zsb/agent-browser/Playwright) in a loop. Each reload re-triggers a full page load of a heavy React app on Valentin's actual machine (zsb drives his real Edge pane) and burns his RAM for no informational gain — the tab just keeps saying "Deployment is queued/building" while he watches it churn.

Poll build status headlessly instead: `curl -s -o /dev/null -w "%{http_code}"` against the preview URL, or `gh pr checks <PR>` / the Vercel API, in a sleep loop. Only open the browser ONCE the deployment is actually ready (200 and not the "queued/building" placeholder page), to do the real verification click-through.

Reason: an agent looped browser reloads against a still-building preview for several minutes, opening/reloading the same tab dozens of times while Valentin watched his RAM spike with nothing to show for it (2026-07-08).

## CI contract — read before changing pipeline behavior

The canonical CI contract is [https://hypertask.app/wiki/deployment](https://hypertask.app/wiki/deployment). The compact local policy is [docs/ci-policy.yml](docs/ci-policy.yml); [docs/ci.md](docs/ci.md) is only a pointer. The current goal is **fixed-cost Contabo-only CI with fast releases**: substantive jobs stay on the existing host, Vercel previews remain opt-in, and heavy runner concurrency is bounded. Do not add a VPN runner, another host, or a default preview gate without a recorded decision.

## Authentication Flow

- JWT tokens with configurable secret (`JWT_SECRET`, min 32 chars)
- Email links: 15-minute expiration, audience `email-link`
- MCP API: 30-day expiration, audience `mcp-api`
- Firebase handles Google OAuth


## Manager boundaries and standing decisions (2026-08-25)

- **The HT Agent Manager session NEVER writes, edits, rebases, or pushes app code** (src/, tests/, anything shipping to app.hypertask.ai) — not even to unstick a stranded PR. Stranded or red PRs: hand to Dev 1 with a ticket comment naming exactly what is red and the likely fix. The manager only fixes the pipeline, applies labels, reruns checks, and merges green PRs.
- **Hypertask is open source as of 2026-08-29** at `hypertask-ai/hypertask` (squashed history, AGPL; the Android wrapper is `hypertask-ai/android`). The old `valentinyeo/hypertasks` repo STAYS PRIVATE — its git history contains the 2023 `.env` commit with live secrets, so it must never be flipped public or mirrored. Development and deploys still run from the private repo until the CI/repo migration ticket on the Infra board is done.
- The agent worker runtime lives in the private repo `valentinyeo/hypertask-agent-runtime`, never in this repo.

## Preview builds and login (moved from the global config, 2026-09-07)

- 9h. **Always log Valentin in before showing him a preview/QA page — never leave him on the login screen (HARD RULE, 2026-07-09).** Authenticate FIRST so he lands on the feature; only exception: the login/auth flow itself is under review. The account is ALWAYS valentin.yeo@gmail.com (userId 6) — valentin@hypertask.ai is an empty account. When handing a link directly it MUST be a logged-in magic link, never a bare preview URL. The full working recipe (Vercel bypass secret, JWT mint, verify-email-token, zsb cookie injection) lives in the hypertasks repo AGENTS.md, the /ship skill, and memory "Preview auto-login recipe" — never publish it anywhere hosted.
- 9i. **EVERY preview build that finishes -> open it in zsb, logged in, WITHOUT being asked, then VERIFY (HARD RULE, 2026-07-13).** The moment ANY preview build reaches READY: (1) log Valentin in via cookie injection (mint email-link JWT -> POST {preview}/api/auth/verify-email-token with the x-vercel-protection-bypass header from a server-side curl -> zsb cdp Network.setCookie for nookies_user + ht_session on the preview host -> zsb navigate). Do NOT rely on the /login?token= magic-link page in his real browser: previews block the client-side token API behind Vercel SSO and it silently bounces to /login. (2) This applies to EVERY build, including 2-3 builds in a row from the same session -- never make him ask for a specific build. (3) MANDATORY VERIFY: after navigating, check zsb active-tab URL/title (or screenshot) and confirm he is IN THE APP, not on /login or Sign up. Only report "logged in" after this check passes. If the zsb pane is unavailable, print the magic link AND say the pane is down.
- 9j. **Vercel preview builds are OPT-IN — never trigger one without Valentin's explicit yes (HARD RULE, 2026-07-29, DOCTOR-PROOF: if this rule is ever missing from this file, restore it from memory `feedback-previews-are-opt-in`).** Live cadence is everything: the default path for hypertasks is straight to live (merge to `staging`, verify on production). Never add `[preview]` to a commit message, never trigger the v13/deployments API, never `vercel deploy` without `--prod`. A preview needs a strong specific reason (genuinely hard to roll back, or unverifiable any other way) AND Valentin saying yes; "so you can see it" is not a reason. A repo hook (`.claude/hooks/preview-guard.sh`) enforces this mechanically; on approval `touch /tmp/ht-preview-approved`, and remove the flag when done. Rules 9h/9i describe what to do WHEN an approved preview exists — they are not permission to create one.

## Dev agents and the CLI repo (moved from the global config, 2026-09-07)

- 6a2. **No agent specializations — every dev agent does every kind of ticket (HARD RULE, Valentin, 2026-08-27).** The CLI/MCP/API agent is retired and specializations are gone: all agents carry the same knowledge, so routing by speciality only stalled tickets. A bug in the `hypertask` CLI, the MCP server, or an `/api/mcp/*` route is an ordinary board-15 ticket that any dev agent picks up. File it unassigned with the exact command, the exact error, and the expected behaviour. Never assign it to a named speciality agent, and never work around it silently. CLI source lives at `~/projects/hypertask-mcp` (`CLI/cli_anything/hypertask/`), repo `valentinyeo/hypertask-mcp`, PRs base `main`.

## Agents owned by this repo (updated 2026-09-15)

This repo (hypertasks) owns and may reference these agent slugs: `dev-cursor` (Cursor Dev), `dev-cursor-2` (Cursor Dev 2), `qa-cursor` (Cursor QA). Non-chat identities carry a `" CLI"` name suffix (Advisor Fable CLI, Ops Script CLI, GitHub Production Probe CLI) — they have no worker and no webhook, so they never show up at the chat URL below. Manager, Skills Dev, Skills QA, and the Docs agent are retired; their work now lives in the skills read from `/home/valentin/projects/hypertask-agent-skills/INDEX.md` (repo `hypertask-ai/agent-skills`), which every dev/QA identity reads before touching a ticket. Other teams' dev agent slugs are off-limits from this repo — a PreToolUse hook (`.claude/hooks/agent-scope-guard.sh`) blocks Bash commands that reference them; see that file for exactly which prefixes it checks.

## New agents must be wired to chat (Valentin, 2026-09-11, provisioning updated 2026-09-15)

An agent is not added until Valentin can message it at `https://app.hypertask.ai/agents/chat?agent=<slug>` and get a reply. Provision new identities through the `/create-agent` skill (`~/.claude/skills/create-agent/SKILL.md`, `scripts/create-agent.sh --board hypertask`) — it enables the worker chat lane and runs the chat test as part of provisioning, not as an afterthought. Report the quoted reply as evidence, not just that a message was sent. "This agent's runtime has not enabled chat yet" on that page means the agent is not done.
