# Boards and views

## How a customer reaches it

`https://app.hypertask.ai/detail/project-<id>` for a board (real selector:
`.kanban-column-title`, `src/components/PageComponents/Kanban/KanbanSectionComponents/section.tsx`,
per `e2e/smoke/prod.spec.ts`), `/all-tasks` for the board list (`#users-list`),
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

https://app.hypertask.ai/detail/project-15/7026 adds a compact Connect your agent card above the columns or table on the user's earliest active owned board (the seeded MyBoard, including after rename). It is behind `htpr-7026-agent-connect-check`, default Owner + QA. Users with any previous CLI or MCP connection, or a server-persisted dismissal, do not see it.

On a disposable new-user fixture, confirm Claude Code, Cursor, Codex appear first. Select a tool and use the shared onboarding CLI or MCP instructions. While the card is in view, the status checks every four seconds; hidden tabs and offscreen cards stop polling. The first connection shows the actual recorded client or the onboarding choice, plus Ask your agent to pick up the top task. Dismiss and reload, then check another device: the card stays hidden. A connection also hides it on the next visit without needing dismissal. Confirm flag-off users cannot read first-run card state or save a dismissal.

Capture waiting and connected states at 1440x900 and 390x844. Confirm only the first connection gets Your agent is connected email, naming the client with one Open your board button. The existing unique `WebhookEvent(userId, eventType)` record, with type `agent_connected_email`, durably claims one send attempt, including concurrent connects. An uncertain or failed delivery retains that claim rather than risking duplicates; it never fails agent authentication. No schema migration is required.

## Cleanup

None if you only viewed and switched. If you changed a saved filter or view
on the account's own board, revert it to the account's default state.
