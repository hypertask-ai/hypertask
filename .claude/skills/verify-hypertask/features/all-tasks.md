# All tasks

## Sub-features

- `all-tasks-feed` All tasks surface.

## How to get to it (user POV)

`https://app.hypertask.ai/all-tasks` shows recent tasks across boards (`src/app/all-tasks/page.tsx:14-34`, `#users-list` in smoke).

## Driving it with agent-browser

`agent-browser` or `ht-verify`, headless, `https://app.hypertask.ai/...?realtime=on`, QA state `~/.config/hypertask-videos/storageState-qa.json`.

Open `/all-tasks`. Confirm title **All tasks**, date range control, and the task list. Reload keeps the range from `userSetting.allTasksDateRange`.

## Gotchas

Not the same as **My tasks** or a board view. Empty range is valid when no recent tasks match.

### What proof to collect

Screenshot the primary heading and one representative control at 1440x900 and 390x844 when the layout differs. Save the URL, account, and flag mode when a flag gates the control.

### Cleanup

Archive or delete only fixtures this check created. Leave production boards unchanged on read-only passes.
