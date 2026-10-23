# Hypertask app rules: hypertask-ai/hypertask

Start with /ship and .claude/skills/INDEX.md for each ticket.
Global rules apply here; repo procedures live below, not in a second copy.
Board content only through vcc, the CLI, MCP or app APIs; never Prisma, SQL or a database client, not even for reads.
Branch off origin/production; the PR targets production and merging deploys app.hypertask.ai; one ticket, one PR, titled `HTPR-NNNN [TYPE] ...`.
Never push to, base work on or mirror the archived hypertask-ai/hypertasks repo.
Access or security fix: add a "still allowed" test next to the "now refused" one (`.claude/reference/workflow.md`).
New or changed visible UI: wireframe and UX Sign-off before code (`.claude/reference/flags.md`).
Live QA fails on flagged code: get the flag switched Off first (HT Product Lead), revert second.
No explanatory code comments: say it in code (a clearer name, a smaller function, an assertion or log message); only tool-read comments stay, enforced in `src/` by `local/no-comments`.

## Read X when Y

| Read | When |
|---|---|
| `AGENTS.md` "Claude Code and Codex sessions", "Hypertask Ticket Access", "Ticket comments", "Claim a ticket before working it"; `.claude/reference/boards.md` | Reading or writing board content, claiming a ticket or requesting a decision |
| `AGENTS.md` "Repository Workflow"; `.claude/reference/workflow.md`; `.claude/skills/clean-up/SKILL.md` | Before branching, committing, opening or merging a PR, deploying or removing your worktree |
| `AGENTS.md` "Feature flags for new user-facing behavior"; `.claude/reference/flags.md`; `.claude/skills/verify-qa/SKILL.md` | Any bugfix, new behavior, flagged-code change, premerge check or failed live QA |
| `.claude/reference/previews.md`; `AGENTS.md` "Repository Workflow" | Any preview creation, use, polling or preview login |
| `.claude/reference/ci.md`; `AGENTS.md` "CI contract", "CLI and MCP repositories"; `docs/ci.md`; `docs/ci-policy.yml` | Any workflow, runner, ruleset, required check, preview or CLI/MCP change |
| `AGENTS.md` "AI models" | Changing an app AI model or saved model choices |
| `.claude/skills/INDEX.md`; `.claude/skills/verify-on-phone/SKILL.md`; `.claude/skills/verify-qa/SKILL.md`; `.claude/skills/reuse-existing-ui/SKILL.md` | Selecting a ticket workflow, checking UI reuse or proving desktop, phone and live behavior |
| `src/app/`, `src/pages/api/`, `src/utils/controllers/`, `src/lib/auth/`, `src/pages/api/queues/`, `src/lib/realtime/`; `docs/` | How the app is built: routes, controllers, auth, queues, realtime; not session rules |
