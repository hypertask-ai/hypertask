# Time tracking

## Sub-features

- `time-reports` Time tracking surface.
- `timers-on-tasks` Time tracking surface.

## How to get to it (user POV)

`https://app.hypertask.ai/time` lists Time reports for teams, boards, users, and date ranges (`src/app/time/page.tsx`). Timers also start from a ticket (`task-detail-and-description.md`).

## Driving it with agent-browser

`agent-browser` or `ht-verify`, headless, `https://app.hypertask.ai/...?realtime=on`, QA state `~/.config/hypertask-videos/storageState-qa.json`.

Open `/time` signed in. Confirm heading **Time reports**, scope controls, and export. With no running timer, the empty state is not a failure. Optionally open a sandbox ticket, start a timer, return to `/time`, and confirm Pause or Resume without stopping the timer unless you will clean up.

## Gotchas

Do not confuse `/time` with the agent-run log on `/logs`. Running timers survive reload; pause or stop fixtures you start.

### What proof to collect

Screenshot the primary heading and one representative control at 1440x900 and 390x844 when the layout differs. Save the URL, account, and flag mode when a flag gates the control.

### Cleanup

Archive or delete only fixtures this check created. Leave production boards unchanged on read-only passes.
