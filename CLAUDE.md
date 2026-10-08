# CLAUDE.md (Hypertask app, `hypertask-ai/hypertask`)

Start with `/ship`: Valentin's own Claude Code or Codex session takes one ticket from claim through fix, PR, merge, deploy, live verification and close. `.claude/skills/INDEX.md` is the skill map. The wiki at https://hypertask.app/wiki and `openwiki/` are technical reference only. Rules marked (enforced) are held by a hook, a check or a repo setting.

## Layer 1: always true

### Valentin
1. **Valentin is a product owner.** He cannot read code, cannot merge and does not use GitHub. No step in this repo may need him to merge, review code, add a GitHub label or write in a pull request. Human steps on GitHub are done by his Claude session on his plain-language go, or automated.
2. **The ticket is the single source of truth.** Everything he should read is a plain-language comment on the ticket; logs and session notes go to run activity. When you need his decision, post one comment that @mentions him with a yes/no product question and move the ticket to Valentin Review. Never ask him in chat or in a pull request.
3. **Ticket references are full URLs** (`https://app.hypertask.ai/detail/project-15/<number>`), never a bare id, everywhere.

### Board writes
4. **Never write in Valentin's name.** Board writes go only through `vcc` (identity "Valentins Claude Code"), never his user token (the plain `hypertask` CLI on this machine is his and is for reads only). Never add or remove him as assignee: Agents are human companions (Valentin, 2026-10-02): a ticket usually has a human assignee and an agent together, and agent-only is fine. Add only your own agent (`vcc task assign <TICKET> --self`); never remove or change a human assignee, and never add Valentin (userId 6) yourself. A ticket he assigned himself or moved by hand stays exactly as he left it.
5. **Claim before coding:** `vcc comment add <PREFIX-NNN> --text "<p><strong>Claimed.</strong> Session working it now.</p>"`, then `vcc task move <PREFIX-NNN> --section "In Progress"`. "Claimed." plus In Progress means in flight: do not touch. Never work a ticket assigned to Abdul.
6. **Board content only through the CLI, MCP or app APIs, never Prisma, SQL or a database client**, not even for reads. Direct database writes are only for migrations, schema work, requested data repair or local seed data. Why: https://app.hypertask.ai/detail/project-15/3891 and https://app.hypertask.ai/detail/project-15/3892.

### Merging and branches
7. **The session merges once required checks are green.** Leave auto-merge off (enforced: repo `allow_auto_merge` is off). The same session watches the deploy, verifies live with `.claude/skills/verify-qa/SKILL.md`, and closes the ticket only after verification passes.
8. **Branch off `origin/production` of `hypertask-ai/hypertask`; the pull request targets `production`.** Merging to `production` deploys app.hypertask.ai in about 3 minutes. One ticket, one pull request; fix the open one instead of opening another. PR titles use `HTPR-NNNN [TYPE] ...`; supported ticket prefixes are `HTPR`, `HYFA` and `YPER4`.
9. **The old private repo is archived.** `valentinyeo/hypertasks`, now `hypertask-ai/hypertasks`, is read-only history with a 2023 `.env` commit: never push to it, base work on it, mirror it or make it public. Its `staging` and `main` branches are dead.
10. **Never `git stash`** (shared across every worktree and session). Never reset, check out or revert files you did not change; check `git status --short --branch` before committing.
11. **Clean up after shipping:** once the pull request is merged, production is health-checked and the worktree is clean, record its path and branch and remove only your own unused worktree and merged branch from another cwd. Never delete your own cwd, another session's worktree, a dirty worktree or an open-PR branch.

### Flags and previews
12. **Bug fix: a ticket-named flag on for Everyone by default, except fixes to saved data, security and crashes, which need no flag (Valentin, 2026-10-06). New product behaviour: a ticket-named flag, default Owner + QA.** Bugfix flags use `kind: "bugfix"` and get the same 14-day cleanup. Infra tickets (board 4060, `YPER4-*`) never get a flag (Valentin, 2026-10-03). Gate protected behaviour on the server; `useFlag` only hides UI. Developers never switch a feature flag to Everyone: Valentin decides on the ticket and his Claude session switches it. Details: AGENTS.md "Feature flags" section and Layer 2 below.
13. **Previews share the live database** and are for looking only. Every pushed branch already gets one; never create another (enforced: `.claude/hooks/preview-guard.sh`; an exception needs Valentin's recorded yes on the ticket, then `touch /tmp/ht-preview-approved`, removed when done). Never mint, inject or print login credentials for Valentin's account. When an approved preview is ready, open it in zsb with your own identity or the QA account and confirm you are in the app, not on the login page.
14. **Never poll a building preview by reloading a browser tab** (zsb drives Valentin's real Edge). Poll with `curl` or `gh pr checks`; open the browser once it is ready.

- When live QA FAILs on code behind a flag, switch that flag Off on /admin/flags first (seconds, no deploy), then repair. Only Valentin's login can open that page: a runner sends the flag key and the failure to the INFRA MANAGER session with SendMessage at once, and it switches the flag Off. A revert PR is the second step, not the first. (Valentin, 2026-10-03)
- Any change to code inside a flag that is already on for Everyone, whatever its PR type ([BUGFIX] included), needs one recorded browser click-through of the changed path on a real board before merge, on the preview or locally against the PR build, with the live flag states. Record commit, account and flag state in ~/.local/state/vcc-evidence/<TICKET>/premerge.md.

### CI and other repos
15. **Read the CI reference before changing workflows, runners, rulesets, required checks or previews:** https://hypertask.app/wiki/deployment and `docs/ci-policy.yml`. App CI runs on GitHub-hosted runners. No VPN runner, new host or default preview gate without a recorded decision.
16. **CLI and MCP tickets:** File a CLI, MCP or `/api/mcp/*` bug unassigned on board 15 with the exact command, error and expected result. CLI tickets are fixed in `hypertask-ai/cli` (`~/projects/hypertask-cli-zig`, PRs to `main`, tests `zig build test` and `python3 scripts/parity_test.py`). The Node CLI is retired. `/api/mcp/*` server changes stay in this repo.

### AI models
17. One AI model per class: a new model version replaces the old one in the same change (old one leaves every picker, saved picks move to the new one). Enforced by tests/model-class-unique.test.cjs (Valentin, 2026-10-08).

### Helpers
Use Codex sub-sessions when helpers are needed: `hax --provider=codex --model=gpt-6.1-sol --effort=high --no-session -p "<task>"`. The owning session remains responsible for the ticket through live verification and close.

## Layer 2: read X when Y

| Read | When |
|---|---|
| `.claude/skills/INDEX.md` in this repo | Skill map for `/ship`: `fix-bug`, `ship-feature-behind-flag`, `verify-on-phone`, `verify-qa`, `reuse-existing-ui` |
| AGENTS.md "Feature flags" section | Exact flag rules: naming, `DEFAULT_FEATURE_FLAG_MODE` in `src/lib/flags.ts`, `feature-flag-gate` check, 14-day cleanup |
| AGENTS.md "Ticket comments" section and wiki `hypertask-cli` | CLI command shapes, comment HTML, managed agent tokens |
| wiki `architecture`, `auth`, `routing-and-controllers`, `queues` and `openwiki/` | How the app is built: routes, controllers, auth (JWT, email links, Better Auth), queues, realtime |
