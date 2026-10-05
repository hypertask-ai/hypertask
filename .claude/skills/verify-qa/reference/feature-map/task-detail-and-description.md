# Task detail and description

## How a customer reaches it

`https://app.hypertask.ai/detail/project-<id>/<taskNumber>`, opened from a
board card, an Inbox notification, or a deep link.

## How to drive it

`agent-browser`, headless, `?realtime=on`. Open the task, edit the
description, save, then leave and reopen the task (or reload) to confirm the
edit stuck. If the ticket involves AI-edited descriptions, trigger that flow
specifically rather than a manual edit.

## What usually breaks

- Open task not refreshing its description when a realtime update drops
  ([HTPR-6281](https://app.hypertask.ai/detail/project-15/6281), fixed then reverted then re-landed as `#746`, the kind of bug
  that needs the reload check below, not just a live-DOM look).
- AI-edited descriptions losing structure ([HTPR-6561](https://app.hypertask.ai/detail/project-15/6561)).
- Mobile Task Writer saving the wrong thing or locking direct save
  ([HTPR-6564](https://app.hypertask.ai/detail/project-15/6564)).

## What proof to collect

For a manual edit, screenshot the description before and after, then a
**reload check**: close and reopen the task (or full page reload) and
screenshot again.

[HTPR-6281](https://app.hypertask.ai/detail/project-15/6281) needs the
opposite check: it's about the open task **not** picking up a change made
elsewhere while realtime is down. `agent-browser` never gets live push (see
INDEX.md's realtime caveat), so it already runs the polling fallback this bug
is about. Edit the task from a second context or the API while the first
tab has it open, wait for the poll interval, and screenshot the still-open
tab **without reloading**. A reload would fetch fresh from the server and
pass even with the bug present, hiding exactly what broke.

For desktop composer placement, open a ticket with several comments from both
Inbox and its board at 1920x1080 and 1440x900. Scroll to the last comment and
capture it above the Send box, with no overlap or estimated-height gap. Check
empty and one-comment threads, repeat with `htpr-6899-stable-layout` and
`htpr-6752-instant-ticket-open` on and off in a disposable local build, and
confirm the separate fixed mobile composer at 390x844 is unchanged.

## Cleanup

If you created a test task, hard-delete it via the product UI. Never leave a
task you created (the smoke prefix is `QA_TASK_PREFIX` in
`e2e/smoke/lib/boardSetup.ts`) past the run.
