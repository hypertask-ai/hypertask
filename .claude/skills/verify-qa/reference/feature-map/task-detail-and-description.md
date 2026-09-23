# Task detail and description

## How a customer reaches it

`https://app.hypertask.ai/detail/project-<id>/<taskNumber>`, opened from a
board card or a deep link.

## How to drive it

`agent-browser`, headless, `?realtime=on`. Open the task, edit the
description, save, then leave and reopen the task (or reload) to confirm the
edit stuck. If the ticket involves AI-edited descriptions, trigger that flow
specifically rather than a manual edit.

## What usually breaks

- Open task not refreshing its description when a realtime update drops
  (`HTPR-6281`, fixed then reverted then re-landed as `#746`, the kind of bug
  that needs the reload check below, not just a live-DOM look).
- AI-edited descriptions losing structure (`HTPR-6561`).
- Mobile Task Writer saving the wrong thing or locking direct save
  (`HTPR-6564`).

## What proof to collect

Screenshot the description before and after the edit, then a **reload
check**: close and reopen the task (or full page reload) and screenshot
again. `HTPR-6281` shipped and broke twice because the live view looked right
and only the post-reload state was wrong.

## Cleanup

If you created a test task, hard-delete it via the product UI. Never leave a
`[qa-runner]`-prefixed task behind past the run.
