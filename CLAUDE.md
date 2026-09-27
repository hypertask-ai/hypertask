# CLAUDE.md (Hypertask app, `hypertask-ai/hypertask`)

Precedence: board-15 process (merging, QA, columns, who does what) lives only in the contracts at `hypertask-ai/company-skills`, folder `agents/Hypertask Product/`. This file and every skill must match them; when they differ, the contract wins and the other file gets fixed. The wiki at https://hypertask.app/wiki and `openwiki/` are technical reference only. Rules marked (enforced) are held by a hook, a check or a repo setting.

## Layer 1: always true

### Valentin
1. **Valentin is a product owner.** He cannot read code, cannot merge and does not use GitHub. No step in this repo may need him to merge, review code, add a GitHub label or write in a pull request. Human steps on GitHub are done by his Claude session on his plain-language go, or automated.
2. **The ticket is the single source of truth** (Ticket Communication Contract). Everything he should read is a plain-language comment on the ticket; logs and agent notes go to run activity. When you need his decision, post one comment that @mentions him with a yes/no product question and move the ticket to Valentin Review. Never ask him in chat or in a pull request.
3. **Ticket references are full URLs** (`https://app.hypertask.ai/detail/project-15/<number>`), never a bare id, everywhere.

### Board writes
4. **Never write in Valentin's name.** Board writes go through `htbot` (Product Bot) or the agent's own identity, never his user token (the plain `hypertask` CLI on this machine is his). A session's comment ends with "Requested by Valentin in a Claude session" plus the date. Never assign userId 6. A ticket he assigned himself or moved by hand stays exactly as he left it.
5. **Claim before coding:** `htbot comment add <PREFIX-NNN> --text "<p><strong>Claimed.</strong> Session working it now.</p>"`, then `htbot task move <PREFIX-NNN> --section "In Progress"`. "Claimed." plus In Progress means in flight: do not touch. Never work a ticket assigned to Abdul.
6. **Board content only through the CLI, MCP or app APIs, never Prisma, SQL or a database client**, not even for reads. Direct database writes are only for migrations, schema work, requested data repair or local seed data. Why: https://app.hypertask.ai/detail/project-15/3891 and https://app.hypertask.ai/detail/project-15/3892.

### Merging and branches
7. **Agents never merge and never turn on auto-merge.** (enforced: repo `allow_auto_merge` is off and the `hypertask-agents` App cannot merge or push to `production`.) Valentin's Claude session merges setup and infrastructure changes on its own once checks are green. App changes follow the Merge Rules and QA and Safety contracts; until the merge gate exists, only his Claude session merges.
8. **Branch off `origin/production` of `hypertask-ai/hypertask`; the pull request targets `production`.** Merging to `production` deploys app.hypertask.ai in about 3 minutes. One ticket, one pull request; fix the open one instead of opening another. Title and type rules: developer contract, `doing-the-work.md`.
9. **The old private repo is archived.** `valentinyeo/hypertasks`, now `hypertask-ai/hypertasks`, is read-only history with a 2023 `.env` commit: never push to it, base work on it, mirror it or make it public. Its `staging` and `main` branches are dead.
10. **Never `git stash`** (shared across every worktree and session). Never reset, check out or revert files you did not change; check `git status --short --branch` before committing.
11. **Clean up after shipping:** once the pull request is merged, production is health-checked and the worktree is clean, report `CLEANUP_READY` with its path and branch. Never delete your own cwd, another session's worktree, a dirty worktree or an open-PR branch.

### Flags and previews
12. **Bug fix: no flag, live for everyone. New behaviour: a flag named after the ticket, default Owner + QA.** Gate protected behaviour on the server; `useFlag` only hides UI. Developers never open a flag to Everyone: Valentin decides on the ticket and his Claude session switches it. Details: QA and Safety contract, `change-types.md`, and Layer 2 below.
13. **Previews share the live database** and are for looking only. Every pushed branch already gets one; never create another (enforced: `.claude/hooks/preview-guard.sh`; an exception needs Valentin's recorded yes on the ticket, then `touch /tmp/ht-preview-approved`, removed when done). Never mint, inject or print login credentials for Valentin's account. When an approved preview is ready, open it in zsb with your own identity or the QA account and confirm you are in the app, not on the login page.
14. **Never poll a building preview by reloading a browser tab** (zsb drives Valentin's real Edge). Poll with `curl` or `gh pr checks`; open the browser once it is ready.

### CI and other repos
15. **Read the CI reference before changing workflows, runners, rulesets, required checks or previews:** https://hypertask.app/wiki/deployment and `docs/ci-policy.yml`. App CI runs on GitHub-hosted runners. No VPN runner, new host or default preview gate without a recorded decision.
16. **Any agent takes any ticket; there are no specialist agents.** File a CLI, MCP or `/api/mcp/*` bug unassigned on board 15 with the exact command, error and expected result. CLI tickets are fixed in `hypertask-ai/cli` (`~/projects/hypertask-cli-zig`, PRs to `main`, tests `zig build test` and `python3 scripts/parity_test.py`). The Node CLI is retired. `/api/mcp/*` server changes stay in this repo.

## Layer 2: read X when Y

| Read | When |
|---|---|
| company-skills `agents/Hypertask Product/README.md` | Which agents exist on board 15, their model and state, and which contract covers them. This is the only list of agents this repo owns. |
| Ticket Communication Contract (`tickets/CONTRACT.md`) | Writing on a ticket: the two lanes, comment shape, how to reach Valentin |
| QA and Safety Contract (`qa-and-safety/CONTRACT.md` and its detail files) | Opening, reviewing, merging or verifying any change to app.hypertask.ai |
| Merge Rules Contract (`merge-rules/CONTRACT.md`) | Deciding whether a change merges on its own or goes to Valentin Review |
| Developer contract (`developer/`) | Picking a ticket, branch and PR shape, comment filter, handing off, when stuck |
| Supervisor contract, `supervisor/columns.md` | What each board-15 column means and who owns it |
| company-skills skills: `ticket-lifecycle`, `hypertask-conventions`, `talk-to-valentin`, `keep-docs-current` | Every ticket, every comment, every PR text |
| `.claude/skills/INDEX.md` in this repo | Repo how-tos: `fix-bug`, `ship-feature-behind-flag`, `verify-on-phone`, `verify-qa`, `reuse-existing-ui` |
| AGENTS.md "Feature flags" section | Exact flag rules: naming, `DEFAULT_FEATURE_FLAG_MODE` in `src/lib/flags.ts`, `feature-flag-gate` check, 14-day cleanup |
| AGENTS.md "Ticket comments" section and wiki `hypertask-cli` | CLI command shapes, comment HTML, managed agent tokens |
| wiki `architecture`, `auth`, `routing-and-controllers`, `queues` and `openwiki/` | How the app is built: routes, controllers, auth (JWT, email links, Better Auth), queues, realtime |
| `/create-agent` skill | Adding an agent identity. It is not added until it answers a message at `https://app.hypertask.ai/agents/chat?agent=<slug>`; quote the reply as evidence |
