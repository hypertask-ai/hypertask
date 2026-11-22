# Settings: board

## Sub-features

- `board-settings-sections` Settings: board surface.

## How to get to it (user POV)

Board tab: `/settings/board-general` through `/settings/board-files` (`settingsNavigation.ts:165-187`). `/settings/board` and `/settings/board/<section>` redirect to `/settings/<section>` (`src/app/settings/board/[[...section]]/page.tsx:18-27`).

## Driving it with agent-browser

`agent-browser` or `ht-verify`, headless, `https://app.hypertask.ai/...?realtime=on`, QA state `~/.config/hypertask-videos/storageState-qa.json`.

With QA Sandbox selected, open `/settings/board-general`, `/settings/board-ai`, and `/settings/board-members`. Confirm the board picker, section headings, and that `/settings/board` lands on board general (`boards-and-views.md`).

## Gotchas

`/settings/board/skills` is not the skills editor URL; use `/settings/board-skills` (`board-skills.md`).

### What proof to collect

Screenshot the primary heading and one representative control at 1440x900 and 390x844 when the layout differs. Save the URL, account, and flag mode when a flag gates the control.

### Cleanup

Archive or delete only fixtures this check created. Leave production boards unchanged on read-only passes.
