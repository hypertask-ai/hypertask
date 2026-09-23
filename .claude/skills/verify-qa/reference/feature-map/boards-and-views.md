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

- Board switching leaving stale state behind (`HTPR-6627`, "make shallow
  board switch permanent"), previously flagged behind a flag until proven
  stable.
- Realtime subscriptions silently dying after a switch (`HTPR-6565` shipped
  as #685, was reverted, and needs re-verifying if it lands again;
  `HTPR-6566` for the webhook-chat half, also reverted once).
- Filters not applying immediately (`HTPR-6595`).
- Column save-view retries looping on an empty column (`HTPR-6588`,
  `HTPR-6550`).
- Focused card position resetting on board reload (`HTPR-6333`, "snap board
  left when focused card still fits").

## What proof to collect

Before/after screenshot of the board in its normal state, plus a **reload
check**: after the action, reload the page and confirm the change (filter,
column state, focused card) survived the reload, not just the live DOM. Most
of the bugs above only showed up after a refresh or a second board switch.

## Cleanup

None if you only viewed and switched. If you changed a saved filter or view
on the QA runner board, revert it to the account's default state.
