# Hypertask agent map

Start with `/ship` and [.claude/skills/INDEX.md](.claude/skills/INDEX.md).
House rules live in the shared source.
Load each skill when its step starts.
Read the relevant reference section before acting.
Reference command paths are repo-relative.

[HT Product Lead](.claude/agents/product-lead.md) and [Poteto Advisor](.claude/agents/poteto-advisor.md) have separate role references. Shared house rules remain authoritative.

## Always

- Board reads use `hypertask`; writes use `vcc`.
- Check `ship-identity` before writing. Never copy credentials.
- Never access ticket content through database tools.
- Claim before investigating or coding. Respect active claims.
- Add only your agent. Preserve human assignees.
- Branch from `origin/production`; target `production`.
- One ticket, one PR. Leave auto-merge off.
- Name the pull request author family: a bare `Author-Model:` line, or a matching commit trailer.
- Never stash or discard another session's changes.
- Never use the archived `hypertask-ai/hypertasks` repository.
- Verify the successful production deployment and live behavior before Done.
- Clean only your own finished worktree and branch.
- No explanatory code comments. Express intent in code.
- Hypertask board: 15 (https://app.hypertask.ai/project?id=15).
- Mobile tap targets >= 44x44 at 390x844 touch across all 4 themes.
- Mobile text inputs compute to >= 16px font size.
- Mobile surfaces use 0, 2, or 4px corners (avatars/status-dots exempt).
- Mobile screens have zero horizontal overflow or unellipsized clipping.
- Mobile non-AI elements use no purple.
- Mobile text fields expose the standard right-bound mic button.
- Mobile user journeys pass with real taps at 390x844 touch.

Each rule names the check that enforces it in [rule checks](.claude/reference/rule-checks.md).

## Read X when Y

Read linked sections on demand.


| When | Read |
|---|---|
| Checking what enforces an agent rule | [Rule checks](.claude/reference/rule-checks.md) |
| Starting, claiming, delegating, shipping | [Sessions](.claude/reference/workflow.md#claude-code-and-codex-sessions), [claims](.claude/reference/boards.md#claim-a-ticket-before-working-it-collision-avoidance), `/ship` |
| Reading tickets or writing board content | [Access](.claude/reference/boards.md#hypertask-ticket-access), [comments](.claude/reference/boards.md#ticket-comments), [exceptions](.claude/reference/boards.md#repo-board-exceptions), [template](docs/ticket-template.md) |
| CLI or MCP work | [Repositories and credentials](.claude/reference/cli.md#cli-and-mcp-repositories) |
| Branching, PRs, merging, deploying, cleanup | [Workflow](.claude/reference/workflow.md#repository-workflow), [detail](.claude/reference/workflow.md#repo-workflow-detail), [cleanup](.claude/reference/workflow.md#worktree-cleanup), [clean-up](.claude/skills/clean-up/SKILL.md) |
| Workflows, runners, checks, previews | [CI](.claude/reference/ci.md#ci-contract), [docs/ci.md](docs/ci.md), [docs/ci-policy.yml](docs/ci-policy.yml) |
| Preview creation, polling, login | [.claude/reference/previews.md](.claude/reference/previews.md) |
| UI code, layout, selection | [Shared UI](.claude/reference/ui.md#reuse-existing-ui-enforced), [reuse-existing-ui](.claude/skills/reuse-existing-ui/SKILL.md) |
| Behavior, flags, premerge, live QA | [Flags](.claude/reference/flags.md#feature-flags-for-new-user-facing-behavior), [verify-hypertask](.claude/skills/verify-hypertask/SKILL.md) |
| New components or visible UI | [Design/approval](.claude/reference/flags.md), [verify-hypertask](.claude/skills/verify-hypertask/SKILL.md) |
| App architecture | [Stack](.claude/reference/architecture.md#stack-orientation) |
| pstack skills or model selection | [pstack](.claude/reference/architecture.md#pstack-in-hax-and-codex-sessions) |
| AI models or saved choices | [Models](.claude/reference/architecture.md#ai-models) |
| Access or security changes | [Still-allowed tests](.claude/reference/workflow.md#repo-workflow-detail) |

Access and security changes need still-allowed tests.
Flagged failures: authorized flag-owner agents hold the flag at Owner + QA first.
Runners never switch a flag Off; Off is Valentin's own safety switch.
`src/` enforces comment rules through `local/no-comments`.

Implementation lives in `src/app/`, `src/pages/api/`, `src/utils/controllers/`, `src/lib/auth/`, `src/pages/api/queues/`, and `src/lib/realtime/`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
