# Feature map for QA verification

One file per customer-facing area. Each file uses four sections: Sub-features,
How to get to it (user POV), Driving it with agent-browser, and Gotchas, with
proof and cleanup as subsections of Gotchas. Read the file for the area a
ticket touches before verifying it; don't read them all for a one-line fix.

Pattern borrowed from
[poteto/verification-skill-example](https://github.com/poteto/verification-skill-example):
a short reference file per feature area beats one long QA checklist, because
each ticket only needs the one or two areas it touches.

Internal build, release and monitoring recipes: [Ops map](../ops-map/INDEX.md).

## Areas

<!-- shared-list rows: one file per row in rows/, rebuilt by node scripts/shared-lists/build.mjs --write -->
| Area | File | e2e/smoke id |
|---|---|---|
| Activation analytics | [activation-analytics.md](activation-analytics.md) | read-only flags and cron refusals; `feature-map-drive.mjs activation-analytics` |
| Admin and owner tools | [admin-and-owner-tools.md](admin-and-owner-tools.md) | `feature-map-drive.mjs admin-and-owner-tools` verified-unreachable for QA |
| Agent chat roster ordering | [agent-chat-roster.md](agent-chat-roster.md) | `feature-map-drive.mjs agent-chat-roster`; standalone roster at desktop and phone |
| Board agent rooms | [agent-rooms.md](agent-rooms.md) | `feature-map-drive.mjs agent-rooms`; read-only room listing with the auto-create blocked |
| Agent run lifecycle | [agent-runs.md](agent-runs.md) | `feature-map-drive.mjs agent-runs`; read-only lifecycle discovery, run reads and refusals |
| Agent board scope guard | [agent-scope-guard.md](agent-scope-guard.md) | `ci-checks` lane `agent-board-scope` log; throwaway PR negative control, no app writes |
| Agents and board access | [agents-board-access.md](agents-board-access.md) | `feature-map-drive.mjs agents-board-access`; 24/24 picker opens and the self-access 403 need throwaway agents |
| Agents directory | [agents-directory.md](agents-directory.md) | `feature-map-drive.mjs agents-directory` read-only |
| AI chat | [ai-chat.md](ai-chat.md) | `feature-map-drive.mjs ai-chat` read-only; `ai-chat-drive.mjs` hands-free write journey |
| Automatic AI feedback tickets | [ai-feedback-reports.md](ai-feedback-reports.md) | `feature-map-drive.mjs ai-feedback-reports`; MCP refusal with an invented field and the board-15 count |
| Team AI usage | [ai-usage.md](ai-usage.md) | `feature-map-drive.mjs ai-usage`; read-only key-error and successful report checks |
| All tasks | [all-tasks.md](all-tasks.md) | `feature-map-drive.mjs all-tasks` read-only |
| Announcements admin API | [announcements-admin-api.md](announcements-admin-api.md) | `feature-map-drive.mjs announcements-admin-api`; no-login 401 checks on the admin routes |
| Billing and plans | [billing-and-plans.md](billing-and-plans.md) | `feature-map-drive.mjs billing-and-plans`; open checkout and cancel without payment |
| Board invites | [board-invites.md](board-invites.md) | `feature-map-drive.mjs board-invites`; owner resend 200, outsider 403 |
| Board member list | [board-member-list.md](board-member-list.md) | `feature-map-drive.mjs board-member-list`; query `teamId` ignored |
| Board skills | [board-skills.md](board-skills.md) | `feature-map-drive.mjs board-skills`; create a throwaway skill, prove 201 and the reload, delete it |
| Boards and views | [boards-and-views.md](boards-and-views.md) | `open-board`, `switch-boards` (write); `feature-map-drive.mjs boards-and-views`; `board-drive-live.mjs` hands-free |
| Calendar | [calendar.md](calendar.md) | `feature-map-drive.mjs calendar` read-only |
| Chat sessions | [chat-sessions.md](chat-sessions.md) | `feature-map-drive.mjs chat-sessions` read-only |
| CI runner placement | [ci-runner-policy.md](ci-runner-policy.md) | `ci-runner-policy.cjs` on the production SHA, self-hosted negative control, `pr-title` status |
| Server feature-flag check | [ci-server-feature-flags.md](ci-server-feature-flags.md) | pinned PR-2034 replay with today's evaluator: first fails, final writes `feature-gated-ui` |
| Required-check settings | [ci-settings.md](ci-settings.md) | live ruleset read, hourly `verify`/`chain` run log, no settings step in `ci-tests` |
| CI tests and parallel checks | [ci-tests.md](ci-tests.md) | `ci-prepare` then 4 PR / 8 push shards, `Run independent static checks`, `shard-proof … duplicates=0` |
| CLI install commands and login | [cli-install.md](cli-install.md) | `feature-map-drive.mjs cli-install`; Settings > CLI commands and `llms.txt` |
| Command palette | [command-palette.md](command-palette.md) | `feature-map-drive.mjs command-palette`; Ctrl+K Search and Ctrl+J writer, never submitted |
| Comments and mentions | [comments-and-mentions.md](comments-and-mentions.md) | post, `@` picker, reload and delete on board 7049; `comments-drive-live.mjs` for loopback |
| Create task attachments | [create-task-attachments.md](create-task-attachments.md) | Ctrl+K Create task, attach file, `Save`, request chain 200, reload |
| Board custom instructions | [custom-instructions.md](custom-instructions.md) | `feature-map-drive.mjs custom-instructions`; read-only GET and the editor on the sandbox board |
| Demo board | [demo-board.md](demo-board.md) | `feature-map-drive.mjs demo-board`; one guest `/demo` board per run, `/learn` signed out |
| Desktop human CLI login | [desktop-login.md](desktop-login.md) | `feature-map-drive.mjs desktop-login`; consent screen and the signed-out redirects |
| Drafts | [drafts.md](drafts.md) | `feature-map-drive.mjs drafts` read-only |
| Drag and drop | [drag-and-drop.md](drag-and-drop.md) | `data-rfd-*` mouse steps, reload proof, restore column, delete fixture |
| Feature-flag and UX sign-off gates | [feature-flag-and-ux-gates.md](feature-flag-and-ux-gates.md) | PR vs schedule job selection, `evaluated N, skipped M`, UX dispatch log, cancelled-run census |
| Feature flag switch API | [feature-flags-api.md](feature-flags-api.md) | `feature-map-drive.mjs feature-flags-api`; `/api/flags` read and `/admin/flags` 404 for QA |
| Figma connect | [figma-connect.md](figma-connect.md) | `feature-map-drive.mjs figma-connect`; connection read and the Accounts row |
| In-app feedback | [in-app-feedback.md](in-app-feedback.md) | POST /api/feedback on board 15; brain-medium only when the flag is on |
| Inbox | [inbox.md](inbox.md) | `view-inbox` (load-only); no write journey for archive/undo |
| Integrations | [integrations.md](integrations.md) | `feature-map-drive.mjs integrations` read-only |
| Login | [login.md](login.md) | `login` (write journey) |
| Legacy MCP SSE transport | [mcp-legacy-sse.md](mcp-legacy-sse.md) | `feature-map-drive.mjs mcp-legacy-sse`; no-token JSON-RPC refusals |
| Next-task pick | [mcp-next-task.md](mcp-next-task.md) | read-only next-task and task context for project 15 |
| MCP and CLI project listing | [mcp-project-list.md](mcp-project-list.md) | read-only pagination, malformed-input refusals, metadata and scoped caller checks |
| MCP task lookup and hello | [mcp-task-lookup.md](mcp-task-lookup.md) | no smoke id; real `tools/call` lookups and read-only hello/catalog checks |
| MCP task moves | [mcp-task-moves.md](mcp-task-moves.md) | disposable fixture refusal, unchanged column, successful moves; delete fixture |
| MCP token revoke | [mcp-token-revoke.md](mcp-token-revoke.md) | no smoke id; single-token mint/revoke steps in the file; never revoke-all on QA 2343 (MCP watcher) or on 985 (shared agent token) |
| Mobile | [mobile.md](mobile.md) | `@mobile` journeys (`open-board`, `open-task`, `create-task`, `reply-inbox`, `ai-chat`, `switch-boards`, `switch-column`) and `e2e/smoke/mobile-design.spec.ts` |
| AI model canary | [model-canary.md](model-canary.md) | internal cron, dedicated internal-key request identity, read-only MCP status |
| My Tasks | [my-tasks.md](my-tasks.md) | `feature-map-drive.mjs my-tasks`; list shell at desktop and phone, plus `/scheduled` |
| OAuth and API clients | [oauth-and-api-clients.md](oauth-and-api-clients.md) | `feature-map-drive.mjs oauth-and-api-clients` read-only |
| Pages | [pages.md](pages.md) | `feature-map-drive.mjs pages`; list shell, board scopes and page search |
| Pinned and archived | [pinned-and-archived.md](pinned-and-archived.md) | `feature-map-drive.mjs pinned-and-archived` read-only |
| PR ticket binding | [pr-ticket-binding.md](pr-ticket-binding.md) | trusted workflow rerun and persisted CLI readback |
| Pricing and trial | [pricing-and-trial.md](pricing-and-trial.md) | `feature-map-drive.mjs pricing-and-trial` read-only |
| Public sites | [public-sites.md](public-sites.md) | `feature-map-drive.mjs public-sites`; three public hosts and the `/developers` redirect |
| Quick entry cards | [quick-entry-cards.md](quick-entry-cards.md) | `create-task` (column + inline box); N and drafts via the steps in quick-entry-cards.md; Table view needs a board view |
| Reminders | [reminders.md](reminders.md) | `feature-map-drive.mjs reminders` read-only |
| Board report agent doors | [reports-agent-doors.md](reports-agent-doors.md) | `feature-map-drive.mjs reports-agent-doors`; door refusals and the `/report` screen |
| Saved reports and velocity | [saved-reports-and-velocity.md](saved-reports-and-velocity.md) | `feature-map-drive.mjs saved-reports-and-velocity` read-only |
| Search and filters | [search-and-filters.md](search-and-filters.md) | `view-AI-search` (load-only); `ht-verify` filter icon > Tags > cycle Match ANY / Match ALL / Hide tags; flags EVERYONE |
| Search autocomplete | [search.md](search.md) | `view-AI-search` (load-only); `ht-verify` /search tips, type `fr` then Tab, full load of a `searchTerm` URL |
| Settings: account | [settings-account.md](settings-account.md) | `feature-map-drive.mjs settings-account` read-only |
| Settings: board | [settings-board.md](settings-board.md) | `feature-map-drive.mjs settings-board` read-only |
| Slack app | [slack-app.md](slack-app.md) | `feature-map-drive.mjs slack-app`; install, support and invalid-link pages |
| Snippets | [snippets.md](snippets.md) | `feature-map-drive.mjs snippets` read-only write+delete one fixture |
| Starred tasks and comments | [starred.md](starred.md) | `feature-map-drive.mjs starred`; `/starred` and `/pinned` tabs |
| Task detail and description | [task-detail-and-description.md](task-detail-and-description.md) | `node .claude/skills/verify-qa/scripts/task-drive-live.mjs`; `ht-verify` description PUT + reload, right column, /time empty |
| Task labels and followers | [task-labels-and-followers.md](task-labels-and-followers.md) | `feature-map-drive.mjs task-labels-and-followers` read-only API |
| Task share links | [task-share-links.md](task-share-links.md) | `ht-verify` createShareLink, 401 members/share, public /share HTML; agent door 401 without a token |
| Board task templates | [task-templates.md](task-templates.md) | `feature-map-drive.mjs task-templates` read-only API |
| Task writer quality eval | [task-writer-quality-eval.md](task-writer-quality-eval.md) | newest scheduled task-writer-eval run plus its score artifact; Ctrl+J window |
| Team credential database races | [team-credential-db-races.md](team-credential-db-races.md) | CI Tests run log with 62 `real PG` cases; `/my-tasks` and the core inbox cycle |
| Themes | [themes.md](themes.md) | `feature-map-drive.mjs themes`; Appearance list and the resolved `html[data-theme]` |
| Time tracking | [time-tracking.md](time-tracking.md) | `feature-map-drive.mjs time-tracking` read-only |
| Trash and permanent delete | [trash-and-permanent-delete.md](trash-and-permanent-delete.md) | `feature-map-drive.mjs trash-and-permanent-delete`; trash heading, archive tabs and the refusals |
| Webhooks | [webhooks.md](webhooks.md) | `feature-map-drive.mjs webhooks`; team endpoint and event list |
<!-- shared-list rows end -->

Load-only ids come from `prod.spec.ts`'s per-view smoke check (page loads,
no error, right selector present). Real, but shallower than a write journey.
Write-journey ids are tagged `@id:<name>`, tier-prefixed when `HT_QA_TIER` is
set (`lib/tier.ts`'s `tieredId`); load-only ids follow the same
`@id:view-<name>` shape from `prod.spec.ts`, case preserved from the view's
own `name` field. "No write journey" means don't invent a test id that
doesn't exist; verify that action by hand.

## Driving the app for verification

One read-only production drive covers the whole map:

```bash
node .claude/skills/verify-qa/scripts/feature-map-drive.mjs all --dir /tmp/feature-map-drive
```

It takes one feature slug or `all`, refuses any base except `https://app.hypertask.ai`, uses the
`qa-login` identities, prints `PASS`/`FAIL` per step, and writes `result.json` plus screenshots.
It creates only what its own cleanup removes: one board skill on 7049 and one invite on 7283.
Each area file repeats its own one-line invocation. Writes that spend money (AI chat messages,
key tests) and destructive bulk actions stay with the loopback drives named per area.

Prefer `agent-browser`, headless, straight against production:
`https://app.hypertask.ai/...?realtime=on`, the same param
`e2e/smoke/lib/realtime.ts` appends. Against production it does **not** turn on
live push under automation: `src/lib/realtime/client.ts` checks
`navigator.webdriver` before it reads a param that is not on a loopback origin,
and `agent-browser` reports `navigator.webdriver === true` like any automated
Chromium. So production proof is always reload-and-re-read-from-the-server,
never "watch it update live" (see each area file's "what proof to collect").
On a loopback stack the same `?realtime=on` does open live push for an
automated browser, and the tab keeps it through in-app navigation until
`?realtime=off`. That is where live-update proof belongs. Pass `--state` explicitly:
`~/.config/hypertask-videos/storageState-qa.json` (user 985) for a flagged
path, `storageState-qa-normal.json` (user 2343) for the flag-off path.
**Runner browser policy.** A runner (any session not named HT Product Lead) never opens pages in Valentin's browser: no `zsb` navigate/open/activate. Links to tickets, pages, reports and wireframes go in ticket comments only. Browser QA and checks use headless Playwright with QA account 985, following `verify-qa`, never his browser. Only the session he talks to (HT Product Lead) opens a page for him, and only when it mentions that page to him in chat. (Valentin, 2026-10-12): "i never look a the runner sessoins they don't need to do that i reply to ticket in the inbox and via you thats it" and "but should the even try to open pages?"

## Plan accounts

Three tiered accounts, state files at `~/.config/ht-qa/state-{free,byok,pro}.json`.
`e2e/smoke/lib/tier.ts` uses `free`/`byok`/`pro` as the tier labels, confirmed
mapped to plans `Free`/`BYOK`/`Pro`. There is no light or premium tier. Free
is free forever and has AI chat on `gpt-6-luna`. Keep the account names in
this one file so renaming them is a one-line edit, not a grep-and-replace:

- `free` → `~/.config/ht-qa/state-free.json`
- `byok` → `~/.config/ht-qa/state-byok.json`
- `pro` → `~/.config/ht-qa/state-pro.json`

Each account writes only to its own private board. The smoke setup names
that board and prefixes its tasks in `e2e/smoke/lib/boardSetup.ts`
(`QA_TASK_PREFIX`). Never write to a board you don't own, and never use
another account's state file. Pass the state file with `--state`.

`HT_QA_EXPECTED_PLAN` gates pass/fail on the confirmed plan mapping above:
`free` → `Free`, `byok` → `BYOK`, `pro` → `Pro`.

**These tiered accounts are plain customer accounts, not `OWNER_AND_QA`
flagged accounts.** A flag-gated ticket still needs the existing flagged
pair from `RULES-product.md`: `storageState-qa.json` (userId 985) and
`storageState-qa-normal.json` (userId 2343). Use the tiered accounts for
plan-specific behavior, the flagged pair for anything behind a feature flag.

## Before/after for a fixed ticket

1. Read the ticket. Pick the area file(s) it touches from the table above.
2. **When the PR opens**, capture a "before" screenshot on production
   (`app.hypertask.ai`, the bug as it exists today) per that area's proof
   section.
3. **Once the fix is live**, capture the matching "after" screenshot the same
   way.
4. Attach both to the ticket with `--attach` (never embed as markdown
   images). Say in the comment what changed between the two.
5. Run the area's cleanup step so the QA account boards stay clean for the
   next run.

