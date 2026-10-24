## Claude Code and Codex sessions

Start with `/ship`, [CLAUDE.md](CLAUDE.md), and the skill map at [.claude/skills/INDEX.md](.claude/skills/INDEX.md).

Valentin's own Claude Code and Codex sessions follow the same workflow:

- Board writes go only through `vcc`, as the identity `ship-identity` picks: a session Valentin named after an identity in `~/.config/hypertask-agents/credentials/sessions/` writes as it, everyone else as "Valentins Claude Code" (Valentin, 2026-10-02). The plain `hypertask` CLI is for reads only. Never write in Valentin's name or copy another identity's token or credentials. Agents are human companions (Valentin, 2026-10-02): a ticket usually has a human assignee and an agent together, and agent-only is fine. Add only your own agent (`vcc task assign <TICKET> --self`); never remove or change a human assignee, and never add Valentin (userId 6) yourself.
- Board content goes only through approved CLI, MCP or app API surfaces. Never use Prisma, SQL, or a database client for ticket content, even for reads.
- Before coding on a ticket, claim it with `vcc comment add`, then move it to **In Progress** with `vcc task move`.
- The same session fixes, opens the PR, merges once required checks are green, watches the deploy, verifies live with `.claude/skills/verify-qa/SKILL.md`, and closes the ticket only after verification passes.
- Read [the CI reference](docs/ci.md) and `docs/ci-policy.yml` before changing workflows, runners, rulesets, previews, or deploy checks.
- Helpers follow the token ladder (Valentin, 2026-10-10): CODEX mode `hax --provider=codex --model=gpt-6.1-sol --effort=high --no-session -p "<task>"`, CLAUDE mode the Agent tool (`sonnet` builds, `haiku` lookups) inside the session. The owning session remains responsible through live verification and close. A helper never writes to a Hypertask board (no claim, comment, move, assign, page, activity); it reports to its runner, and vcc refuses its writes.

## CLI and MCP repositories

CLI tickets are fixed in a **different repository**; server-side MCP/API changes stay in this app repo:

- CLI source: `~/projects/hypertask-cli-zig` (Zig `hypertask`), remote [`hypertask-ai/cli`](https://github.com/hypertask-ai/cli), PRs base `main`
- Tests: `zig build test` and `python3 scripts/parity_test.py`
- MCP/API in this app repo still applies for server-side `/api/mcp/*` changes

Work a CLI ticket in a worktree off `hypertask-ai/cli` the same way you would here: branch from `origin/main`, fix, test, PR, then comment the PR link on the ticket. Do not try to fix a CLI bug inside this repository, and do not park it as blocked. The Node CLI (`@hypertask/hypertask_cli`) is retired; do not extend it. A hidden `htz` symlink still points at `hypertask` for old scripts - do not use `htz` in new work.

The product's managed-agents feature, agents API, agent chat and MCP tokens remain supported. The following token guidance is for those product integrations, not an alternative board-write identity for sessions; session writes still go only through `vcc`.

Managed agent tokens work with the CLI as well as MCP. Use `hypertask --token "$AGENT_TOKEN" ...` or `HYPERTASKS_JWT_TOKEN="$AGENT_TOKEN" hypertask ...`; do not save an agent token with `hypertask login`.

For model and reasoning-effort selection, use Codex `/intensity` when available. It is a recommendation layer, not a required provider or board identity.

Sessions must clean up after shipping: after the PR is merged into `production`, production is health-checked, and the worktree is clean and unused, record its absolute path and branch and remove only your own unused worktree and merged branch from another cwd. Never delete your own active cwd, another session's worktree, a dirty worktree, or an open-PR branch.

## Hypertask Ticket Access

Hard rule: never read or write Hypertask ticket content directly through Prisma, raw SQL, database clients, or production database access. This includes "read-only" ticket lookups. Tickets, comments, inbox items, and task mutations must go through the product interface or approved CLIs/API surfaces so auth, permissions, activity, notifications, and side effects stay intact.

Use **`hypertask`** for ticket reads and **`vcc`** for all board writes on this VPS (full native Zig CLI; see the "Ticket comments" section below):

```bash
hypertask status
hypertask tasks get HTPR-3976 --project 15
hypertask comment list HTPR-3976 --project 15
hypertask search "query" --project 15
hypertask capabilities --json
```

The CLI binaries currently available on the dev machine are:
- `hypertask` - native Hypertask CLI (Zig, `hypertask 0.2.0 (zig)`); talks to `/api/mcp/*` and reads `~/.hypertask/config.json`.
- `vcc` - board-write command for Valentin's Claude Code and Codex sessions, using identity "Valentins Claude Code". Use it for every ticket, comment, assignment and move; the plain `hypertask` CLI is read-only for sessions.
- `ht` - low-level MCP helper (`ht METHOD /mcp/path [json-body]`).
- `zsb` - browser automation/debugging CLI for the active remote browser/tab.

A hidden `htz -> hypertask` symlink remains for old scripts. Do not use `htz` in new commands or docs.

When a user provides a URL like `https://app.hypertask.ai/detail/project-15/3976`, treat it as a Hypertask ticket and use the CLI/product surface first. If the CLI cannot access it, ask the user for the ticket text or authorization context; do not fall back to database inspection.

When referencing a Hypertask ticket in conversation, write the full clickable app URL every time, inline with the sentence. Do not rely on only `HTPR-3976`, `ticket 3976`, or a ticket key without the URL. Prefer the raw URL or a Markdown link whose visible text is the full URL, for example `https://app.hypertask.ai/detail/project-15/3976`. If asking the user to inspect something in the browser, provide the exact URL for use with ZSB or the app UI; if the user asks to open it, run `zsb open <url>` instead of only describing where to click.

## Ticket comments

- `--text` takes either plain text (auto-converted to `<p>`/`<ul>` HTML) **or** complete, well-formed HTML (passed through as-is). Don't mix them: once `--text` contains any HTML tag (e.g. an `<a>`), the backend stops converting markdown, so bare newlines won't render as paragraphs and the comment looks unformatted.
- For links (PRs, related tickets, commits), use HTML anchors - bare URLs and `#1234` are not auto-linked: `<a href="https://github.com/valentinyeo/hypertasks/pull/1288">PR #1288</a>`.
- Supported inline tags: `<p>`, `<strong>`, `<code>`, `<a>`, `<ul>`/`<li>`, `<h2>`.
- Write comments only via `vcc` (identity "Valentins Claude Code"), never in Valentin's name. Edit in place with `vcc comment update <id> --text ...` instead of deleting and reposting - keeps the thread tidy.
- Keep it short: one summary line, then **Gap / Fix / Status**. Skip the wall of explanation.
- Before moving a fixed ticket to **Done**, its final comment must explain **what changed in plain language**. In 1–2 sentences, state the user-visible problem, what now works differently, and what the user will notice. A PR link, file list, or technical-only explanation does not satisfy this rule.

## Claim a ticket before working it (collision avoidance)

The moment you actually start working a ticket (writing code / doing the fix, not just reading or triaging), make it visible on the board so no one else picks up the same work:

1. Claim via `vcc`: `vcc comment add <PREFIX-NNN> --text "<p><strong>Claimed.</strong> Session working it now.</p>"`. **No session ever writes in Valentin's name: no ticket, comment, assignment or move goes through his user token. All board writes use `vcc`, identity "Valentins Claude Code". Never assign userId 6. Only Valentin assigns himself. A ticket he assigned himself or moved by hand stays exactly as he left it.**
2. Move it to In Progress: `vcc task move <PREFIX-NNN> --section "In Progress"`.

Signal: **Claimed. comment + In Progress = in flight, do not touch.** Abdul self-assigns tickets he picks up; **never work a ticket assigned to Abdul** - leave it and pick another.

## Repository Workflow

Follow the branch/deploy model from `CLAUDE.md` and `docs/ci.md`:

- Production is Vercel project `hypertasks-prod`, deployed from the `production` branch to `app.hypertask.ai`.
- New work branches off `origin/production`; PRs target `production`, never `main`.
- One ticket, one PR; fix the open one instead of opening another. PR titles use `HTPR-NNNN [TYPE] ...`; supported ticket prefixes are `HTPR`, `HYFA` and `YPER4`.
- After opening a PR, leave auto-merge off; the repo setting `allow_auto_merge` is off (Valentin, 27 Sep 2026). The owning session merges once required checks are green, watches the deploy, verifies live with `.claude/skills/verify-qa/SKILL.md`, and closes the ticket only after verification passes.
- `main` is frozen legacy and only feeds the EC2 warm-rollback box.
- Every pushed branch gets a Vercel preview. Previews are SSO-protected and share the live production database, so they are for visual verification only, not destructive testing.
- Branches older than 2026-07-06 should be rebased onto `origin/production` before preview work.
- Multiple sessions and worktrees may be active at once. Never use `git stash`; it is shared across worktrees. Never reset, checkout, or revert files you did not intentionally change.
- Before committing, inspect `git status --short --branch` and separate your changes from pre-existing dirty worktree changes.
- While a Vercel preview is still building/queued, never poll it by repeatedly navigating/reloading a browser tab (zsb/agent-browser/Playwright) - on zsb that's Valentin's real Edge pane, and looping reloads a heavy React app for no gain. Poll headlessly instead (`curl -s -o /dev/null -w "%{http_code}" <preview-url>` or `gh pr checks`), and only open the browser once the deployment is actually ready to verify.

## CI contract

Read the [canonical CI contract](docs/ci.md) before changing workflows, runner services, rulesets, required checks, or preview behavior. App CI runs on GitHub-hosted `ubuntu-latest` runners (the repository is public, so hosted minutes are free). Preview verification is opt-in: use the automatic branch preview only when requested or justified by runtime risk. Do not treat it as a merge gate, and do not create extra preview deploys. Do not add a VPN runner or another host implicitly.

## Reuse existing UI (enforced)

Before UI code, follow `.claude/skills/reuse-existing-ui/SKILL.md`. The supported choice UI is the Ctrl+K command system, not a new dropdown. Shared kanban controls already support controlled callers; do not copy their markup.

| Rule | Supported implementation | Enforcement in required `ci-tests` |
|---|---|---|
| No new native selects, dropdowns or floating choice panels | Ctrl+K in `src/components/Modals/commands/HTC/commands.tsx`; `OptionPickerModal` for options, `AssignModal` for board scope, `TableColumnsPicker` for columns, `BoardPriorityMode` for board sort, existing filter modals for filters | `hypertask-ui/no-new-choice-menus` in `npm run lint` |
| No parallel Save, Reset or Save as view controls | `SaveView` from `src/components/PageComponents/Kanban/HeaderComponents/SaveViewHeaderKanban.tsx` and `SaveViewModal` from `src/components/Modals/ViewModals/SaveViewModal.tsx` | `hypertask-ui/no-new-view-save-actions` in `npm run lint` |
| No new native checkboxes/radios, custom CheckRow controls, check icons or checkmark glyphs | `OptionPickerModal` with `checked`, the existing scope/column pickers, or `SelectionCheckbox` from `src/components/Common/selection-checkbox.tsx` for bulk rows | `hypertask-ui/no-new-selection-styles` in `npm run lint` |
| Never move or resize existing UI the ticket did not ask to change (comment box at the bottom of a ticket, New Task window size, board, inbox, My Tasks, app frame) | Keep landmarks where `e2e/smoke/layout-lock.baseline.json` records them. A requested change updates the baseline, or `e2e/smoke/layout-lock.flag-changes.json` for a flagged change, with the ticket link and Valentin's quote in the PR | `e2e/smoke/layout-lock.spec.ts` in `browser-smoke`, run with live flag modes and again with every flag on |

`eslint-local-rules/ui-patterns-baseline.json` records existing production debt per file and rule. New files get zero allowance; unchanged debt and removals pass. When removing legacy controls, lower their baseline count in the same PR so the old allowance cannot be reused. Never raise counts or add a copied file to the baseline to pass lint. Only the exact shared implementation files own raw save/selection rendering. An exceptional new paradigm needs a human-approved reason and expiry date on its offending line, not a blanket lint disable. These syntax checks supplement semantic review; they do not prove that a custom drawing or dynamically named control reuses the house UI.

Run `npm run lint` and `node --test tests/ui-patterns.test.cjs`. The tests include historical reproductions from PRs #547, #571, #578 and #706, allowed shared imports, aliases and baseline overflow. See https://app.hypertask.ai/detail/project-4060/194.

## Stack Orientation

This is a Next.js 14 app with both App Router and legacy Pages Router surfaces. Business logic usually belongs in shared controllers under `src/utils/controllers/`, not only in route files. Important shared systems include Firebase/JWT auth, Prisma/Postgres, QStash background jobs, Pusher-protocol realtime, Turbopuffer search, SendGrid email, Stripe billing, and native AI routes under `src/app/api/ai/`.

Before changing a feature, trace the entry point through middleware, route handler, controller/service layer, queue side effects, auth/cookie behavior, and realtime/cache invalidation where relevant.

## AI models

One AI model per class: a new model version replaces the old one in the same change (old one leaves every picker, saved picks move to the new one). Enforced by tests/model-class-unique.test.cjs (Valentin, 2026-10-08).

## Feature flags for new user-facing behavior

- Every new feature, screen, control, shortcut, API route, or deliberate behavior/design change requires one ticket-specific feature flag.
- Add one client-safe file in `src/lib/flags/definitions/`, named `<flag-key>.ts`, exporting its key constant and a default definition (including `releaseRisk` with `risk` and `reason` for flags shipped from 2026-10-11). Add nothing to shared keys, definitions, risk maps or test lists. `npm` entry points generate the gitignored `index.generated.ts`; never commit it. Existing imports from `keys.ts`, `definitions.ts` and `flags.ts` stay unchanged. Put new per-flag tests in their own test file. See [the registry reference](docs/feature-flags.md).
- Name the key after the ticket, for example `htpr-6091-feature-flags`; never reuse a flag for another feature.
- New feature and improvement flags set `defaultMode: "EVERYONE"` in their definition file, so the change is live at once and can still be switched off in seconds (Valentin, 2026-10-20, HTPR-7389: "we set it to live right away for everyone by default unless there is a REAL STRONG reason not to"). Exceptions are `kind: "internal"` and a flag whose `releaseRisk.highRisk` names one of four high-risk kinds: `money`, `access` (login and access), `data-deletion` or `customer-email`. High-risk flags set `defaultMode: "OWNER_AND_QA"` and get an independent model review (Fable in CLAUDE mode, Codex gpt-6.1-sol in CODEX mode) plus one HT Product Lead check before anyone asks Valentin to release them. When unsure whether a ticket is high risk, ask that review model and HT Product Lead. Switching an existing flag still needs his thumbs up (Switching flags in /ship). Existing flags keep their current mode. `defaultFeatureFlagMode` in `src/lib/flags.ts` retains the legacy fallback.
- Only for Valentin's own explicit request, a new flag may instead use `defaultMode: "OWNER_ONLY"` with `releaseRisk.ownerRequest: { quote: "<his exact request>", ticketUrl: "<ticket link>" }`: the quote must be non-blank and the link must match `^https://app\.hypertask\.ai/detail/project-\d+/\d+$`. This exception permits only Owner only, not Owner + QA or Off, and does not replace required `releaseRisk.highRisk` metadata.
- When live QA FAILs on code behind a flag, switch that flag Off on /admin/flags first (seconds, no deploy), then repair. Only Valentin's login can open that page: a runner sends the flag key and the failure to the HT Product Lead session with SendMessage at once, and it switches the flag Off. A revert PR is the second step, not the first. (Valentin, 2026-10-03)
- Test click removed (Valentin 2026-10-21); safety is flags, revert, live QA after release and the YPER4-550 screenshot check.
- Gate protected behavior on the server. `useFlag` only hides client UI and never replaces API authorization.
- A real bug fix restores behavior that used to work or was clearly intended. Bug fixes ship behind a ticket-named flag with `kind: "bugfix"`, on for Everyone by default (Valentin, 2026-10-06). Fixes to saved data, security and crashes keep shipping with no flag. Those three are the only exceptions: legal, privacy, compliance and "urgent" are never reasons to skip a flag, and showing existing UI in new places or to more users is new behavior, not a fix (Valentin, 2026-10-16, YPER4-418, after HTPR-7274 showed the cookie banner to every signed-in user with no flag). Bugfix flags get the same cleanup after 14 days on Everyone. New feature and improvement flags set `defaultMode: "EVERYONE"` in their definition file unless `releaseRisk.highRisk` is set (`money`, `access`, `data-deletion`, `customer-email`) or kind is `internal`; existing flags keep their current mode. A `[BUGFIX]` title alone does not make a change a bug fix; reviewers check the diff. The optional registry `kind` is `feature` (default), `bugfix` or `improvement`.
- Reused UI needs no wireframe (Valentin, 2026-10-23, YPER4-627: "i think this stuff can go straight to live for everyone i don't want flag pile ups anymore" and "we just need to make sure its FAST REVERTABLE with a flag"). A PR that adds no new component file under `src/components/` passes `ux-signoff` without a wireframe or Question; its ticket flag is still required and `feature-flag-gate` checks it. A PR that adds a new component file still needs his yes on a wireframe naming it. Low-risk flags still on Owner + QA from before 2026-10-20 go to Everyone; high-risk flags keep their review.
- Anything visible always ships behind a flag, so it can be switched off in seconds. Keep the kind honest (`feature`, `improvement` or `bugfix`) and set `releaseRisk.highRisk` whenever the change touches money, login and access, data deletion or customer emails; never leave it out to get the Everyone default.
- Call a ticket or a dispatch line a "fix" only when it restores behavior that used to work or was clearly intended. New behavior, even when it reuses an existing component, is a feature or improvement and gets a flag.
- Infra tickets never get a feature flag (Valentin, 2026-10-03: "we don't need feature flags for infra tickets"): any ticket on the Agents & Infra board (project 4060, `YPER4-*`), and `[INFRA]` work such as agent and MCP plumbing, CI, monitoring and the Agent Kit. They ship live for everyone, and must not appear among the product flags.
- Performance work with identical output, security fixes, dependency or CI changes, spelling corrections, and tickets carrying the **AI CHAT 💬** label also do not require a flag.
- Swapping an existing AI model for its newer version from the same provider (same slots, same plan gating, automatic fallback to the previous version) is a dependency update and needs no flag.
- The merge freeze for a required flag does not apply to tickets carrying the **AI CHAT 💬** label.
- Reviewers must block feature and non-exempt bugfix pull requests that omit the required flag.
- The required `feature-flag-gate` check is a mechanical changed-UI check that supplements semantic review. API-only changes stay outside this mechanical check; reviewers still enforce the server-side flag rules above.
- For this mechanical check only, a valid `[BUGFIX]` or `[INFRA]` title may pass without a flag when the diff adds at most 150 lines to UI files and does not show an existing component in new places or to more users (a render condition or early return removed, or the component rendered more times) without a ticket flag gating it. A verified auto-revert has the same exemption. The title is only a hint to the gate, not proof of a bug fix: the reviewer must decide from the diff whether it restores intended behavior. These results still require owner merge and do not waive the bugfix flag rule: only saved-data, security and crash fixes are bugfix exemptions. Registry defaults are checked even for mechanically exempt titles; a flag with `releaseRisk.highRisk` may not default to Everyone.
- A valid `[REFACTOR]` title may skip the mechanical flag requirement only when the diff has at most 150 risky new UI lines (JSX or strings, excluding Pick-key union members) after matching normalized additions against removed lines in any file; moved code does not count toward that budget, and owner merge is still required. Valentin decided this on 2026-10-02 in https://app.hypertask.ai/detail/project-15/6506; the title alone is not proof of pure cleanup, and new behavior still needs a flag.
- After a flag has stayed on **Everyone** for 14 days, create a follow-up ticket to remove the flag and dead branch.
- The moment a flagged feature is live on production, post a ticket comment that @mentions Valentin (`<span data-type="mention" class="mention" data-id="Valentin Yeo" data-label="name-6">Valentin Yeo</span>`) with the flag key, one line on what it does, and the flag's own link https://app.hypertask.ai/admin/flags/<flag-key>, which is also the first line of every flagged ticket's description (Valentin, 2026-10-10, https://app.hypertask.ai/detail/project-15/7087). Without the mention he never learns the flag exists (Valentin, 2026-09-04, https://app.hypertask.ai/detail/project-15/6131).
- Every ticket carries one Flag line, in the description and again in the comment posted when it reaches QA: the flag key with its direct link https://app.hypertask.ai/admin/flags/<flag-key>, and the words Everyone: YES or Everyone: NO with the live mode read at that moment. A ticket with no flag writes `Flag: none (reason)` and `Everyone: n/a`. A ticket may move to a flag column only when the line matches its live mode, and only into Done with Everyone: YES (Valentin, 2026-10-24: "none of the tickets that we have in the done column tell me clearly if the flag is set or not. Can we make that a hard rule for everyone?"). The PR half is enforced by feature-flag-gate; the ticket half by the post-merge poster.
