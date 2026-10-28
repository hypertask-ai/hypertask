# Hypertask repository rules

Start with [CLAUDE.md](CLAUDE.md), [/ship](.claude/skills/ship/SKILL.md), and the [skill map](.claude/skills/INDEX.md). Load each skill when its step starts. Shared house rules remain authoritative. [HT Product Lead](.claude/agents/product-lead.md) and [Poteto Advisor](.claude/agents/poteto-advisor.md) use their own role references.

## Claude Code and Codex sessions

- Claim before investigating or coding. Use `ship-claim` with the session's resume command; a competing claim means step back. Never work Abdul's tickets.
- Keep the ticket In Progress through coding, review, merge, deployment, and live QA. The same session owns the whole path. Close only with production proof.
- Use the current token ladder and explicit role models. Helpers never write to boards; the owner remains responsible for their work. Follow house rules for provider and delegation limits.
- Check `ship-identity` before board writes. Use only that identity through `vcc`; never copy credentials or write as Valentin. Read through `hypertask`, approved MCP, or product APIs. Never use Prisma, SQL, or database clients for ticket content, even for reads.
- Add only your own agent. Never replace assignees, remove a human, or assign Valentin, userId 6. Preserve his manual assignments and moves.

## CLI and MCP repositories

Fix native CLI tickets in `~/projects/hypertask-cli-zig`, remote [hypertask-ai/cli](https://github.com/hypertask-ai/cli), base `main`. Run its Zig tests and parity tests. Server-side MCP/API work stays here. Never extend the retired Node CLI or use its `htz` alias in new work.

Managed agents, agent chat, and product MCP tokens remain supported. Pass integration tokens per invocation or environment; never save an agent token through human login. These integrations do not change session board-write identity. Codex intensity recommendations do not change identity or provider rules.

## Hypertask ticket access

Treat app detail URLs as tickets. Read through the CLI or product interface first. If access fails, obtain the ticket text or authorization context; never inspect the database.

Use full clickable ticket URLs in human communication. Runners never navigate Valentin's browser. Use headless QA accounts, never his login or cookies.

## Ticket comments

Use the shared `tickets` skill. Human comments use `question`, `qa`, or `done`, plain words, and short sentences. Plans, retries, logs, and handoffs belong in agent activity. Keep people comments to an answer, then Gap / Fix / Status.

Use either plain text or complete HTML, not mixed formatting. Links need HTML anchors. Edit an owned comment in place instead of reposting it. Before Done, explain the user-visible problem and changed result; links and file lists alone are insufficient.

## Repository workflow

- Branch from `origin/production` in your own worktree. Target `production`; `main` is frozen rollback history. Never base work on or push to archived `hypertask-ai/hypertasks`.
- One ticket, one PR. Recover an existing PR instead of duplicating it. Titles use a real HTPR, HYFA, or YPER4 ticket and an accepted type. Leave auto-merge off.
- Inspect existing worktree changes before committing. Never stash, discard, reset, or revert another session's work.
- Merge only after required checks pass on the current head. Resolve conflicts before diagnosing checks. Protected Agent Kit changes require HT Product Lead review and merge; see /ship.
- Production is Vercel `hypertasks-prod`, deploying `production` to `app.hypertask.ai`. Require successful deployment for the merge SHA, then live QA.
- Previews share production data and are visual-only. Use them only when requested or justified by runtime risk. Never create extra previews or treat them as a merge gate. Check readiness headlessly, never with repeated browser reloads.
- After Done, remove only this session's clean, unused worktree and merged branch from another directory. Keep dirty worktrees, open-PR branches, and other sessions' work. Follow [clean-up](.claude/skills/clean-up/SKILL.md).

## CI contract

Read [docs/ci.md](docs/ci.md) and [docs/ci-policy.yml](docs/ci-policy.yml) before changing workflows, runners, rulesets, required checks, previews, or deploy behavior. App CI uses GitHub-hosted Ubuntu. Never add a VPN runner or another host implicitly. Full CI belongs on hosted runners; run only the targeted checks permitted by the current task and host policy.

## Reuse existing UI (enforced)

Before UI work, follow [reuse-existing-ui](.claude/skills/reuse-existing-ui/SKILL.md). Use the Ctrl+K command system and existing shared pickers, view-save controls, and selection components. Do not copy markup or invent a parallel control.

| Rule | Enforcement |
|---|---|
| No new selects, dropdowns, or floating choice panels | `hypertask-ui/no-new-choice-menus` |
| No parallel Save, Reset, or Save as view controls | `hypertask-ui/no-new-view-save-actions` |
| No new checkbox, radio, or checkmark styles | `hypertask-ui/no-new-selection-styles` |
| Keep unrelated layouts and sizes unchanged | `e2e/smoke/layout-lock.spec.ts`, live flags and every flag on |
| One AI model per class; replace old picks together | `tests/model-class-unique.test.cjs` |
| No explanatory code comments | `local/no-comments`; use clearer code instead |

Never increase UI baseline allowances. Lower counts when removing debt. New files have zero allowance. Only shared implementation files own raw controls. An exceptional paradigm requires a human-approved reason and expiry on the offending line, never a blanket lint disable. Syntax checks do not replace semantic review. Requested layout changes update the baseline or flagged-change record with the ticket and Valentin's quote. Run UI lint and `tests/ui-patterns.test.cjs` when touching these rules or UI.

## Stack orientation

Next.js uses App and Pages routers. Trace affected middleware, routes, shared controllers/services, auth/cookies, queues, realtime, and cache invalidation before editing. Business logic usually belongs in shared controllers, not only route files. Add a legitimate "still allowed" case alongside every access or security refusal test.

## Feature flags for new user-facing behavior

Use one ticket-specific flag for new features, deliberate behavior/design changes, and ordinary bug fixes. A bug fix restores intended behavior; showing existing UI in new places or to more people is new behavior. Review the actual diff, not just its title.

- Add one client-safe definition file and its own tests. Never edit shared registry lists or commit generated indexes. Follow [the registry reference](docs/feature-flags.md).
- Keep kind honest: feature, improvement, bugfix, or internal. New feature, improvement, and bugfix flags default to Everyone unless high-risk or internal. Existing modes stay unchanged.
- Money, login/access, deletion, and customer-email work must declare high-risk metadata, default Owner + QA, and receive independent review plus an HT Product Lead check before release approval. Never omit risk to obtain Everyone.
- Owner only requires Valentin's explicit request, exact quote, and matching ticket URL in owner-request metadata. It does not waive high-risk metadata.
- Saved-data, security, and crash fixes need no bugfix flag. Other exemptions: identical-output performance work, dependencies, CI, spelling, and tickets labeled **AI CHAT 💬**. Same-provider model replacements with unchanged slots, plan gating, and fallback are dependency updates. Urgency, legal, privacy, and compliance are not exemptions.
- Infra/plumbing work, including the Agent Kit, has no product flag. Product-visible work discovered on board 4060 needs a linked board-15 ticket and its flag.
- Gate protected behavior on the server. A hidden client control is not authorization. API-only changes still need semantic flag review even when outside the mechanical gate.
- Reused UI needs no wireframe. A new component file still needs Valentin's design approval naming it. Follow current house rules for Figma proposals.
- Existing flag switches follow /ship approval rules. When flagged behavior fails, a flag-owner write/admin agent switches it Off with a failure reason first, then repairs. This emergency path includes high-risk and bugfix flags; never re-enable automatically after reverting.
- After release, post the flag's dedicated link, key, purpose, and required Valentin mention on the ticket. Keep its flag link in the description.
- A flagged ticket reaches Done after live QA passes in its declared mode. Do not request release permission by parking it in Valentin Review.

| Rule | Enforcement |
|---|---|
| Ticket-named flag, valid defaults, and changed-UI coverage | `feature-flag-gate`; semantic review still required |
| New component design approval | `ux-signoff`, advisory status plus owner policy |
| Mechanical BUGFIX/INFRA/REFACTOR exemptions do not waive policy | Flag gate plus owner review |
| Cleanup after 7 days for bugfixes, otherwise 14; money/access/deletion stay 14 | Feature-flag-removals cron files up to 10 tickets daily; never switches flags |

Mechanical title exemptions are bounded heuristics, not permission to omit a required flag. Never retitle a PR or weaken a check to pass it. See [flag-release detail](.claude/reference/flags.md) and the gate implementation for syntax and thresholds.

## pstack in hax and Codex sessions

Use the official shared pstack installation and its harness adapter. Read the matching skill when needed. Follow the house-rule model table and project model rules; use explicit models, subscription auth, and no fast mode. Claude Code model choices live in `.claude/rules/pstack-models.md`.
