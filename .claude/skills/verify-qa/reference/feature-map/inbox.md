# Inbox

## How a customer reaches it

`https://app.hypertask.ai/inbox`. Notifications and reminders land here from
`src/pages/api/queues/inboxReminder.ts` and `inboxQueue.ts`.

## How to drive it

`agent-browser`, headless, `?realtime=on`. Trigger a notification (comment on
or assign a task the QA account watches), then check it lands in the inbox,
and that archiving/undo works.

## What usually breaks

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

Clear any test notification you created (archive it) so the QA runner
account's inbox stays empty between runs.

## Gap

No `e2e/smoke` write journey covers inbox yet. This is the first area worth a
journey if inbox tickets keep coming up; note that in the ticket if you hit
one.
