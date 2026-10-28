# Boards and views

## How a customer reaches it

`https://app.hypertask.ai/detail/project-<id>` for a board (real selector:
`.kanban-column-title`, `src/components/PageComponents/Kanban/KanbanSectionComponents/section.tsx`,
per `e2e/smoke/prod.spec.ts`), `/all-tasks` for the task list (`#users-list`),
or the board/table/calendar view switcher inside a board. Switching boards
from the sidebar is the `switch-boards` journey.

## How to drive it

`agent-browser`, headless, `?realtime=on` on the board URL. Open a board,
switch views, then switch to a second board and back, since the bugs below
cluster around what happens on that second switch, not the first load.

## What usually breaks

- Board switching leaving stale state behind ([HTPR-6627](https://app.hypertask.ai/detail/project-15/6627), "make shallow
  board switch permanent"), previously flagged behind a flag until proven
  stable.
- Realtime subscriptions silently dying after a switch ([HTPR-6565](https://app.hypertask.ai/detail/project-15/6565) shipped
  as #685, was reverted, and needs re-verifying if it lands again;
  [HTPR-6566](https://app.hypertask.ai/detail/project-15/6566) for the webhook-chat half, also reverted once).
- Filters not applying immediately ([HTPR-6595](https://app.hypertask.ai/detail/project-15/6595)).
- Column save-view retries looping on an empty column ([HTPR-6588](https://app.hypertask.ai/detail/project-15/6588),
  [HTPR-6550](https://app.hypertask.ai/detail/project-15/6550)).
- Focused card position resetting on board reload ([HTPR-6333](https://app.hypertask.ai/detail/project-15/6333), "snap board
  left when focused card still fits").

## What proof to collect

Before/after screenshot of the board in its normal state, plus a **reload
check**: after the action, reload the page and confirm the change (filter,
column state, focused card) survived the reload, not just the live DOM. Most
of the bugs above only showed up after a refresh or a second board switch.

## First agent connection

https://app.hypertask.ai/detail/project-15/7026 adds a compact Connect your agent card above the columns or table on the user's earliest active owned board (the seeded MyBoard, including after rename). The card shows for a never-connected, non-dismissed user when `htpr-7078-remove-connect-block` is false. The removal flag defaults to Everyone and suppresses this inline card. Read effective flags before running the card checks; if removed, record the inline path as unreachable rather than enabling it or failing for a missing card. Users with any previous CLI or MCP connection, or a server-persisted dismissal, do not see it.

On a disposable new-user fixture, confirm Claude Code, Cursor, Codex appear first. Select a tool and use the shared onboarding CLI or MCP instructions. While the card is in view, the status checks every four seconds; hidden tabs and offscreen cards stop polling. The first connection shows the actual recorded client or the onboarding choice, plus Ask your agent to pick up the top task. Dismiss and reload, then check another device: the card stays hidden. A connection also hides it on the next visit without needing dismissal. Confirm flag-off users cannot read first-run card state or save a dismissal.

Capture waiting and connected states at 1440x900 and 390x844. Confirm only the first connection gets Your agent is connected email, naming the client with one Open your board button. The existing unique `WebhookEvent(userId, eventType)` record, with type `agent_connected_email`, durably claims one send attempt, including concurrent connects. An uncertain or failed delivery retains that claim rather than risking duplicates; it never fails agent authentication. No schema migration is required.

## Calendar loading

https://app.hypertask.ai/detail/project-15/7397: Calendar is its own route (`/calendar`, rail button "Go to calendar"), so a view switch remounts the page. Behind `htpr-7397-calendar-loading-shell` (bugfix, Everyone) the hydration guard from HTPR-6664 shows the app rail and a muted "Loading calendar…" line instead of a bare full-page "Loading...". A screenshot timed by hand misses this window; install a `MutationObserver` before clicking the rail and record the rail count and position on every mutation, with an Inbox switch as the control. Also fetch the `/calendar` HTML (the server render must contain the rail) and watch the console for React hydration errors (#418, #423, #425), which is how a timezone mismatch from HTPR-6664 would come back. On a phone the server draws the rail and the client swaps to the mobile Calendar; check for no hydration errors there too. The reusable script is `~/.local/state/vcc-evidence/HTPR-7397/calendar-shell-check.mjs` (`BASE`, `STATE`, `OUT` env vars).

## Bulk selection on the board

https://app.hypertask.ai/detail/project-15/7260 adds board select all behind `htpr-7260-kanban-select-all`. With nothing editable focused, Ctrl/Cmd+A selects every visible card; X toggles the focused card and Shift-click selects a range inside one column. The bottom bar shows the count, Archive, Assign, Tags and Move icons (44px targets on phones), Open actions and Esc. Ctrl+K with a selection lists the "N selected tasks" group first: Move to column, Assign, Set tags, Archive, Select all on board, Select all in this column, Clear selection; no Frequently used group, and Delete board or Delete column never appear under Frequently used. Ctrl+A inside a text field must keep native text selection. Move a few cards on a disposable board and reload to prove the move saved; check the flag-off account still sees the old bar ("Open actions", "Esc to clear").

https://app.hypertask.ai/detail/project-15/7263 adds phone selection behind `htpr-7263-phone-hold-select`, on for Everyone by default. Hold a card for the existing 900 ms and release within 5 px to toggle its shared selection and show the existing checkboxes and action bar. With a selection, tapping another card toggles it; after deselecting the last card, taps open details again. Hold then move beyond 5 px to drag without changing selection. Scrolling before the hold, pinch, cancellation and column dragging must not select. Desktop and flag-Off behavior stay unchanged. Verify phone jitter, scrolling, hold-release, hold-move, checkbox taps and clearing the bar on a real touch device before release.

## Cleanup

None if you only viewed and switched. If you changed a saved filter or view
on the account's own board, revert it to the account's default state.

## Column limits and card age

https://app.hypertask.ai/detail/project-15/7975 is controlled by
`htpr-7975-column-work-limits`, default Everyone. Off hides the limit
editor and count denominator, refuses limit writes on the server, and
restores stale-only ages without deleting saved limits.

Open Commands, Manage board columns, then a column's settings. Set **Work
limit** to a positive whole number, leave the field, and reload the board.
The existing column count shows active tasks / limit. Above the limit it
turns red; its accessible label says **over limit**. It remains advisory:
creating or moving a task is never blocked. Archived and deleted tasks do
not count. A saved view or filter must not hide the board's total workload.
Clear the field to remove the limit; reload to prove it stayed cleared.

Settings → Board → Staleness controls the board's age display, warning
and hot thresholds, and stale reminders. With Staleness enabled, cards
show days on board and in column, including fresh cards in muted text;
warning and hot cards retain their existing amber and red treatment.
Check both desktop and phone in all four themes. Restore the QA board's
original limit and staleness settings after the run.

## Board hygiene report

On a board, Ctrl+K → Manage tags → Board hygiene. Check the report on
1440x900 and 390x844 in all four themes. Expanding the report must not
resize the modal or change the board, labels or saved views. Reload and
reopen; counts must match the read-only `/api/projects/hygiene?projectId=N`
response. Agents use `hypertask_projects` action `hygiene`, input
`{ "project_id": N }`, or GET `/api/mcp/projects/N/manifest?include=hygiene`.

Report all board tags, since project/category tag classification is not
stored. Only a public view filtering solely one tag covers that tag.
Private views and views with extra filters never hide missing shared views.
Open means Normal tickets outside done/deleted columns; null-column
tickets count toward untagged. Idle means no ticket update for seven days.
With `htpr-7975-column-work-limits` on, the report uses saved column
limits and counts how many columns exceed them. Off retains unknown
limits; `null` is unknown, not zero. Confirm other boards return 404 for outsiders.

Use a QA-owned scratch board for known labels and tickets. Compare label
and view lists before and after reading. This report never repairs data.

## MCP duplicate view titles

Creating a view with an existing title must return the same readable
400 refusal, without changing the existing view or board default.
For https://app.hypertask.ai/detail/project-15/7985, verify through both
`POST /api/mcp/view` and `hypertask_views` action `create` on `/mcp`.
Use a disposable QA-owned view, list it before and after, and remove only
that fixture. Duplicate refusals log warnings; unexpected storage failures
must still log errors. Local behavior coverage:
`node --test tests/htpr-7985-duplicate-view-logs.test.cjs`.

## MCP board-list sorting

For https://app.hypertask.ai/detail/project-15/8017, list boards through
`GET /api/mcp/projects` and `hypertask_projects` action `list` on `/mcp`.
Default/title and `createdAt` sorts must still return accessible boards;
check descending order and cursor continuation. Boards have no update-time
field: `sort_by=updatedAt`, `sort=updatedAt:desc`, and
`filter.updated_since` must return readable validation refusals, not server
errors. Check both JSON and dotted filter query parameters. Unsupported
sort directions must also fail before database access. These reads need
no fixtures or cleanup. Local behavior coverage:
`node --test tests/htpr-8017-project-list-sort.test.cjs`.

## Repeated keyboard archive stays in its column

For https://app.hypertask.ai/detail/project-15/8039, create two disposable
columns on QA 985's sandbox (7049). Put two prefixed fixtures in Done and
one in AI Review. Focus the first Done card after hydration settles.
Press Ctrl+E repeatedly, then hold it: only the Done fixtures may archive.
Focus must stop when Done empties, not jump to AI Review. Reload and read
`POST /api/projects/boardTasks`: the AI Review fixture must remain Normal.
Check a single archive and Undo restore the same fixture. Manual keyboard
navigation into AI Review must still work. Capture desktop and phone
shots, plus the main path video. Delete only the created fixtures and
columns afterward. Flag: `htpr-8039-archive-column-boundary` (bugfix, Everyone).

## MCP permanent board deletion

For https://app.hypertask.ai/detail/project-15/8075, the released deletion
path no longer depends on a feature flag. `POST /api/mcp/projects/archive`
with `{ "project_id": N, "status": "Deleted" }` still requires a write-capable,
board-scoped caller and the existing owner's/admin's deletion permission.
Archive (including omitted status) and Normal still use the quota-aware
status controller.

Run `npm run test:file -- tests/mcp-project-delete.test.cjs` for the actual
POST handler: deletion with flag services unavailable, unauthenticated and
out-of-scope refusals, controller permission refusals, archive and restore.
On production, use only invalid IDs or an inaccessible board to verify the
refused path, and reload an accessible board to prove it remains available.
Do not delete or archive shared production boards. Successful destructive
deletion is covered locally, not claimed as live verification.
## Blocked by me

Every board includes the built-in **Blocked by me** view, including an empty
board. Select it from the existing desktop tabs or phone view picker. It matches
`waitingOnUserId` to the signed-in viewer, not the task assignee or the
board owner. Tickets blocked by another person, unblocked tickets, and
blocking-task dependencies alone stay out. Set, clear, and reassign a
blocker on QA-owned fixtures; check the view and count after each change,
then reload and switch boards. Check a second account sees its own blockers.
Capture desktop and phone in all themes. With `htpr-7804-blocked-by-me`
Off, the view disappears and any active selection returns to the saved
view; resetting view order must not bring it back. Delete only the fixtures
created for this check.

## MCP missing view labels

For https://app.hypertask.ai/detail/project-15/8094, submit a unique view
name with an absent `filters.label_names` value through
`POST /api/mcp/view` and `hypertask_views` action `create` on `/mcp`.
Both must return the readable missing-label refusal. List views before and
after: no view or board-default change is allowed. Existing labels still
save their filter. Expected label refusals log warnings; unexpected storage
failures must still log errors. Local behavior coverage:
`node --test tests/htpr-7985-duplicate-view-logs.test.cjs`.
