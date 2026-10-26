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
Work limits remain unconfigured until the board supports storing them;
`null` is unknown, not zero. Confirm other boards return 404 for outsiders.

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
