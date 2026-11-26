# Hypertask agent map

Start with `/ship` and [.claude/skills/INDEX.md](.claude/skills/INDEX.md).
House rules live in the shared source.
Load each skill when its step starts.
Read the reference section before acting.
Command paths are repo-relative.

Shared house rules stay authoritative; [HT Product Lead](.claude/agents/product-lead.md) and [Poteto Advisor](.claude/agents/poteto-advisor.md) keep their own references.

## Always

- Board reads use `hypertask`; writes use `vcc`.
- Check `ship-identity` before writing. Never copy credentials.
- Never access ticket content through database tools.
- Claim before investigating or coding. Respect active claims.
- Add only your agent. Preserve human assignees.
- Branch from `origin/production`; target `production`.
- One ticket, one PR. Leave auto-merge off.
- Name the PR author family: a bare `Author-Model:` line or a matching commit trailer.
- Never stash or discard another session's changes.
- Never use the archived `hypertask-ai/hypertasks` repository.
- Verify the successful production deployment and live behavior before Done.
- Clean only your own finished worktree and branch.
- No explanatory code comments. Express intent in code.
- Assignment, mention, and lifecycle helpers keep agent and person ids distinct.
- Trashed rows never show in a read; only trash and restore reads spread `anyStatus`.
- Wireframes use only live app tokens.
- Wireframes need eight fresh theme captures.
- Sign-off needs a `/wireframes/` link.
- Hypertask board: 15 (https://app.hypertask.ai/project?id=15).

Each rule's enforcing check is in [rule checks](.claude/reference/rule-checks.md).

## Read X when Y

Read linked sections on demand.

| When | Read |
|---|---|
| Checking what enforces an agent rule | [Rule checks](.claude/reference/rule-checks.md) |
| Starting, claiming, delegating, shipping | [Session rules](.claude/reference/workflow.md#claude-code-and-codex-sessions), [claim rules](.claude/reference/boards.md#claim-a-ticket-before-working-it-collision-avoidance), `/ship` |
| Reading tickets or writing board content | [Ticket access](.claude/reference/boards.md#hypertask-ticket-access), [comments](.claude/reference/boards.md#ticket-comments), [board exceptions](.claude/reference/boards.md#repo-board-exceptions), [ticket template](docs/ticket-template.md) |
| CLI or MCP work | [Repositories and credentials](.claude/reference/cli.md#cli-and-mcp-repositories) |
| Branching, PRs, merging, deploying, cleanup | [Repository workflow](.claude/reference/workflow.md#repository-workflow), [workflow detail](.claude/reference/workflow.md#repo-workflow-detail), [cleanup safeguards](.claude/reference/workflow.md#worktree-cleanup) |
| Workflows, runners, rulesets, checks, previews | [CI contract](.claude/reference/ci.md#ci-contract), [docs/ci.md](docs/ci.md), [docs/ci-policy.yml](docs/ci-policy.yml) |
| Preview creation, polling, or login | [Previews](.claude/reference/previews.md) |
| UI code, layout, choices, or selection | [Shared UI rules](.claude/reference/ui.md#reuse-existing-ui-enforced), [.claude/skills/reuse-existing-ui/SKILL.md](.claude/skills/reuse-existing-ui/SKILL.md) |
| Behavior, flags, design, premerge checks, failed live QA | [Feature flag rules](.claude/reference/flags.md#feature-flags-for-new-user-facing-behavior), [design and approval rules](.claude/reference/flags.md), [verify-hypertask](.claude/skills/verify-hypertask/SKILL.md) |
| App architecture or tracing a feature | [Stack orientation](.claude/reference/architecture.md#stack-orientation) |
| pstack skills or model selection | [pstack rules](.claude/reference/architecture.md#pstack-in-hax-and-codex-sessions) |
| Changing AI models or saved model choices | [Model rules](.claude/reference/architecture.md#ai-models) |
| Access or security changes | [Still-allowed tests](.claude/reference/workflow.md#repo-workflow-detail) |

Flagged failures: authorized flag-owner agents hold the flag at Owner + QA first.
Runners never switch a flag Off; Off is Valentin's own safety switch.
`src/` enforces comment rules through `local/no-comments`.

Implementation lives in `src/app/`, `src/pages/api/` (queues too), `src/utils/controllers/`, `src/lib/auth/`, and `src/lib/realtime/`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
