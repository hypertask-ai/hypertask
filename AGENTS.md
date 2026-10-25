# Hypertask agent map

Start with `/ship` and [.claude/skills/INDEX.md](.claude/skills/INDEX.md).
House rules stay in the shared, person-level source.
Read the relevant reference section before acting.
Paths in reference commands are repository-relative.

[HT Product Lead](.claude/agents/product-lead.md) and [Poteto Advisor](.claude/agents/poteto-advisor.md) have separate role references. Shared house rules remain authoritative.

## Always

- Board reads use `hypertask`; writes use `vcc`.
- Check `ship-identity` before writing. Never copy credentials.
- Never access ticket content through database tools.
- Claim before coding. Respect active claims and Abdul's assignments.
- Add only your agent. Preserve human assignees.
- Branch from `origin/production`; target `production`.
- One ticket, one PR. Leave auto-merge off.
- Never stash or discard another session's changes.
- Never use the archived `hypertask-ai/hypertasks` repository.
- Verify the successful production deployment and live behavior before Done.
- Clean only your own finished worktree and branch.
- No explanatory code comments. Express intent in code.

## Read X when Y

Read linked sections on demand, not every reference.

| When | Read |
|---|---|
| Starting, claiming, delegating, shipping | [Session rules](.claude/reference/workflow.md#claude-code-and-codex-sessions), [claim rules](.claude/reference/boards.md#claim-a-ticket-before-working-it-collision-avoidance), `/ship` |
| Reading tickets or writing board content | [Ticket access](.claude/reference/boards.md#hypertask-ticket-access), [comments](.claude/reference/boards.md#ticket-comments), [board exceptions](.claude/reference/boards.md#repo-board-exceptions) |
| CLI or MCP work | [Repositories and credentials](.claude/reference/cli.md#cli-and-mcp-repositories) |
| Branching, PRs, merging, deploying, cleanup | [Repository workflow](.claude/reference/workflow.md#repository-workflow), [workflow detail](.claude/reference/workflow.md#repo-workflow-detail), [cleanup safeguards](.claude/reference/workflow.md#worktree-cleanup), [.claude/skills/clean-up/SKILL.md](.claude/skills/clean-up/SKILL.md) |
| Workflows, runners, rulesets, checks, previews | [CI contract](.claude/reference/ci.md#ci-contract), [docs/ci.md](docs/ci.md), [docs/ci-policy.yml](docs/ci-policy.yml) |
| Preview creation, polling, or login | [.claude/reference/previews.md](.claude/reference/previews.md) |
| UI code, layout, choices, or selection | [Shared UI rules](.claude/reference/ui.md#reuse-existing-ui-enforced), [.claude/skills/reuse-existing-ui/SKILL.md](.claude/skills/reuse-existing-ui/SKILL.md) |
| Behavior, flags, premerge checks, failed live QA | [Feature flag rules](.claude/reference/flags.md#feature-flags-for-new-user-facing-behavior), [.claude/skills/verify-qa/SKILL.md](.claude/skills/verify-qa/SKILL.md) |
| New components or changed visible UI | [Design and approval rules](.claude/reference/flags.md), [.claude/skills/verify-on-phone/SKILL.md](.claude/skills/verify-on-phone/SKILL.md) |
| App architecture or tracing a feature | [Stack orientation](.claude/reference/architecture.md#stack-orientation) |
| pstack skills or model selection | [pstack rules](.claude/reference/architecture.md#pstack-in-hax-and-codex-sessions) |
| Changing AI models or saved model choices | [Model rules](.claude/reference/architecture.md#ai-models) |
| Access or security changes | [Still-allowed tests](.claude/reference/workflow.md#repo-workflow-detail) |

Access and security changes need still-allowed tests.
Flagged failures: authorized flag-owner agents switch Off immediately.
Revert second; other modes keep their approval rules.
`src/` enforces comment rules through `local/no-comments`.

Implementation lives in `src/app/`, `src/pages/api/`, `src/utils/controllers/`, `src/lib/auth/`, `src/pages/api/queues/`, and `src/lib/realtime/`.
