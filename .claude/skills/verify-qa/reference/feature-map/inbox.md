# Inbox

## How a customer reaches it

`https://app.hypertask.ai/inbox`. Notifications and reminders land here from
`src/pages/api/queues/inboxReminder.ts` and `inboxQueue.ts`.

## How to drive it

`agent-browser`, headless, `?realtime=on`. Trigger a notification (comment on
or assign a task the QA account watches), then check it lands in the inbox,
and that archiving/undo works.

- **Core inbox cycle (YPER4-629), every app deploy and before any flag goes to Everyone:** `node .claude/skills/verify-qa/scripts/inbox-cycle-live.mjs <folder>` as QA 985 seeds three reminders on QA Sandbox, opens one by click, sends a comment with Ctrl+Enter, presses J and E, opens one by Enter, and prints `inbox-cycle ok`. The same cycle runs in the required `browser-smoke` check (`e2e/smoke/inbox-cycle.spec.ts`) with every flag on and with live-like modes.
- With `htpr-7311-decision-comment-link` on, open Decisions by click, Enter, and Inbox Next: each ticket jumps to and highlights its latest unanswered Question mentioning the viewer; flag off and other splits keep existing navigation. https://app.hypertask.ai/detail/project-15/7311

## What usually breaks

- Opening a row by mouse click dropped `?inboxFlow=true` (counter "3 / 3" instead of "1 / 3"), so sending a comment saved but stayed on the ticket ([HTPR-7655](https://app.hypertask.ai/detail/project-15/7655)). Keyboard Enter still worked, so always test the click path.

- Bulk archive used one or two database writes per selected item and could
  exceed the transaction deadline ([HTPR-7953](https://app.hypertask.ai/detail/project-15/7953)).
  Check a large selection through `POST /api/notifications/(un)archiveBulk`,
  then archive two QA-created reminders, reload, undo and reload again.
  Missing notification IDs must not fail the batch; other users' rows and
  deleted notifications must stay unchanged.

- Undo restore skipping rows that are missing by the time undo runs
  ([HTPR-6527](https://app.hypertask.ai/detail/project-15/6527), "skip missing inbox rows during undo restore").
- Archive undo not taking effect immediately, fixed once already
  ([HTPR-5761](https://app.hypertask.ai/detail/project-15/5761), "make inbox archive undo immediate"); worth a regression
  check on any ticket that touches archive/undo.

## What proof to collect

Screenshot the inbox with the new item present, then after archiving it, then
after undo, showing it restored. Reload between each step, not just after the
last one, since undo bugs tend to be about state surviving a reload.

## Cleanup

Clear any test notification you created (archive it) so the QA
account's inbox stays empty between runs.

## Gap

The PR check runs on a disposable loopback app, and the live script on QA Sandbox; neither covers the phone layout yet (`--phone` exists on the live script but is not required).
