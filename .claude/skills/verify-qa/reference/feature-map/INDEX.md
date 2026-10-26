# Feature map for QA verification

One file per customer-facing area. Each file says how a customer reaches the
area, how to drive it, what usually breaks there, what proof to collect, and
the cleanup. Read the file for the area a ticket touches before verifying it;
don't read them all for a one-line fix.

Pattern borrowed from
[poteto/verification-skill-example](https://github.com/poteto/verification-skill-example):
a short reference file per feature area beats one long QA checklist, because
each ticket only needs the one or two areas it touches.

Internal build, release and monitoring recipes: [Ops map](../ops-map/INDEX.md).

## Areas

<!-- shared-list rows: one file per row in rows/, rebuilt by node scripts/shared-lists/build.mjs --write -->
| Area | File | e2e/smoke id |
|---|---|---|
| Activation analytics | [activation-analytics.md](activation-analytics.md) | read-only flags, core inbox; synthetic accounts excluded |
| Agent chat roster ordering | [agent-chat-roster.md](agent-chat-roster.md) | standalone roster, owned API recency, desktop/phone reload |
| Board agent rooms | [agent-rooms.md](agent-rooms.md) | read-only room listing, authentication, desktop/phone reload |
| Agent run lifecycle | [agent-runs.md](agent-runs.md) | read-only QA 985 lifecycle discovery, run reads and authentication refusals |
| Agent board scope guard | [agent-scope-guard.md](agent-scope-guard.md) | throwaway PR negative control, no app writes |
| Agents and board access | [agents-board-access.md](agents-board-access.md) | QA 985 throwaway agents on sandbox 7049; self-access 403 text, /mcp safe reason, 24/24 invite picker opens; delete fixtures |
| AI chat | [ai-chat.md](ai-chat.md) | `ai-chat` (write journey) |
| Automatic AI feedback tickets | [ai-feedback-reports.md](ai-feedback-reports.md) | live MCP call with an invented field, board count before and after, no ticket |
| Team AI usage | [ai-usage.md](ai-usage.md) | read-only customer key error and successful report checks |
| Announcements admin API | [announcements-admin-api.md](announcements-admin-api.md) | no smoke id; no-login 401 checks on the three admin routes |
| Billing and plans | [billing-and-plans.md](billing-and-plans.md) | no payment journey; open checkout and cancel without payment |
| Board invites | [board-invites.md](board-invites.md) | no smoke id; owner resend 200, outsider 403 on `/api/invite/reSendInvite` and `cancelInvite` |
| Board member list | [board-member-list.md](board-member-list.md) | no smoke id; query `teamId` ignored on `/api/members/getAll` |
| Board skills | [board-skills.md](board-skills.md) | no smoke id; create one skill from the textarea, prove POST /api/ai/skills 201 and the reload, delete it |
| Boards and views | [boards-and-views.md](boards-and-views.md) | `open-board`, `switch-boards` (write); `view-board-list`, `view-kanban-board` (load-only, `prod.spec.ts`) |
| CI runner placement | [ci-runner-policy.md](ci-runner-policy.md) | live repository visibility, trusted workflow rejection, title binding |
| Server feature-flag check | [ci-server-feature-flags.md](ci-server-feature-flags.md) | historical first/final CLI replay, server helper and owner-review routing |
| Required-check settings | [ci-settings.md](ci-settings.md) | hourly monitor, production dispatch, 48-hour failure census |
| CI tests and parallel checks | [ci-tests.md](ci-tests.md) | hosted job overlap, fail-closed summary, shard execution proof |
| CLI install commands and login | [cli-install.md](cli-install.md) | no smoke id; Settings CLI shots, real install and read-only token-login guided start |
| Command palette | [command-palette.md](command-palette.md) | no smoke id; read-only shots of the palette rows, the help list and a Share Task tooltip |
| Comments and mentions | [comments-and-mentions.md](comments-and-mentions.md) | `add-comment` (write journey) |
| Create task attachments | [create-task-attachments.md](create-task-attachments.md) | `create-task` covers save only; attachments verify by hand |
| Demo board | [demo-board.md](demo-board.md) | `demo` (tag `@demo`, `demo.spec.ts`) |
| Desktop human CLI login | [desktop-login.md](desktop-login.md) | QA 985 bearer exchange, shared and legacy route checks, isolated task save, cookie/flag-off/permission controls |
| Drag and drop | [drag-and-drop.md](drag-and-drop.md) | `drag-card` (write journey) |
| Feature-flag and UX sign-off gates | [feature-flag-and-ux-gates.md](feature-flag-and-ux-gates.md) | reconcile job logs of two consecutive production runs, no app writes |
| Feature flag switch API | [feature-flags-api.md](feature-flags-api.md) | no smoke id; agent `ht-flag get` and a refused `ht-flag set` |
| Figma connect | [figma-connect.md](figma-connect.md) | none; verify by hand on Settings > Accounts |
| Inbox | [inbox.md](inbox.md) | `view-inbox` (load-only); no write journey for archive/undo |
| Login | [login.md](login.md) | `login` (write journey) |
| Legacy MCP SSE transport | [mcp-legacy-sse.md](mcp-legacy-sse.md) | no smoke id; verify requests and PostHog ingestion directly |
| MCP and CLI project listing | [mcp-project-list.md](mcp-project-list.md) | read-only pagination, malformed-input refusals, metadata and scoped caller checks |
| MCP task lookup and hello | [mcp-task-lookup.md](mcp-task-lookup.md) | no smoke id; real `tools/call` lookups and read-only hello/catalog checks |
| MCP task moves | [mcp-task-moves.md](mcp-task-moves.md) | disposable fixture refusal, unchanged column, successful moves; delete fixture |
| MCP token revoke | [mcp-token-revoke.md](mcp-token-revoke.md) | no smoke id; never revoke-all on QA 2343 (it runs the MCP watcher) |
| Mobile | [mobile.md](mobile.md) | any id above tagged `@mobile` (`open-board`, `open-task`, `create-task`) |
| AI model canary | [model-canary.md](model-canary.md) | internal cron, dedicated internal-key request identity, read-only MCP status |
| My Tasks | [my-tasks.md](my-tasks.md) | no write journey; verify by hand |
| Pages | [pages.md](pages.md) | no write journey; verify by hand (flagged standalone parts through the session API) |
| PR ticket binding | [pr-ticket-binding.md](pr-ticket-binding.md) | trusted workflow rerun and persisted CLI readback |
| Quick entry cards | [quick-entry-cards.md](quick-entry-cards.md) | `create-task` (column + inline box); N and table New task verify by hand |
| Board report agent doors | [reports-agent-doors.md](reports-agent-doors.md) | MCP velocity numbers and status update draft match /report/<slug>/velocity |
| Search and filters | [search-and-filters.md](search-and-filters.md) | `view-AI-search` (load-only, capital AI); no write journey for filters |
| Search autocomplete | [search.md](search.md) | `view-AI-search` (load-only); suggestions verify by hand |
| Slack app | [slack-app.md](slack-app.md) | read-only install/support pages and redirects; real workspace parity needs a human |
| Starred tasks and comments | [starred.md](starred.md) | real document shortcut regression; live tab change, unstar and reload |
| Task detail and description | [task-detail-and-description.md](task-detail-and-description.md) | `open-task`, `edit-description` (write); `view-task-detail` (load-only) |
| Task share links | [task-share-links.md](task-share-links.md) | no smoke id; no-login 401 and signed-in join checks on `/api/members/share` |
| Board task templates | [task-templates.md](task-templates.md) | QA 985 settings edit, authoring, saved reload and permission controls |
| Task writer quality eval | [task-writer-quality-eval.md](task-writer-quality-eval.md) | production workflow dispatch, QA-only fixtures and score artifacts |
| Team credential database races | [team-credential-db-races.md](team-credential-db-races.md) | 62 real PostgreSQL cases in CI; live doctor, MCP reads and core inbox only |
| Webhooks | [webhooks.md](webhooks.md) | no smoke id; QA 985 team-wide endpoint on team 9bca4a7c via /api/settings/webhooks, test delivery to a 2xx receiver, hint vs one-time key; delete fixtures |
<!-- shared-list rows end -->

Load-only ids come from `prod.spec.ts`'s per-view smoke check (page loads,
no error, right selector present). Real, but shallower than a write journey.
Write-journey ids are tagged `@id:<name>`, tier-prefixed when `HT_QA_TIER` is
set (`lib/tier.ts`'s `tieredId`); load-only ids follow the same
`@id:view-<name>` shape from `prod.spec.ts`, case preserved from the view's
own `name` field. "No write journey" means don't invent a test id that
doesn't exist; verify that action by hand.

## Driving the app for verification

Prefer `agent-browser`, headless, straight against production:
`https://app.hypertask.ai/...?realtime=on`, the same param
`e2e/smoke/lib/realtime.ts` appends. **It does not turn on live push under
automation**: `src/lib/realtime/client.ts` checks `navigator.webdriver`
before it even reads the param, and `agent-browser` reports
`navigator.webdriver === true` like any automated Chromium. So proof is
always reload-and-re-read-from-the-server, never "watch it update live" (see
each area file's "what proof to collect"). Pass `--state` explicitly:
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

| Themes | [themes.md](themes.md) | Settings and Ctrl+K selection, reload, all-theme desktop/phone comparison |
