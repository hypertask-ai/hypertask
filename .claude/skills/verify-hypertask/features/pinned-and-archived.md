# Pinned and archived

## Sub-features

- `pinned-page` Pinned and archived surface.
- `archived-list` Pinned and archived surface.

## How to get to it (user POV)

`/pinned` lists public comment pins (`src/app/pinned/page.tsx`, `starred.md`). `/archived` is Tasks Archive and Inbox Archive (`src/app/archived/page.tsx`, `trash-and-permanent-delete.md`). Starred tasks stay on `/starred`.

## Driving it with agent-browser

`agent-browser` or `ht-verify`, headless, `https://app.hypertask.ai/...?realtime=on`, QA state `~/.config/hypertask-videos/storageState-qa.json`.

Open `/pinned`: **Your Pins** and **Team Pins** tabs. Open `/archived`: **Tasks Archive**, scopes **Active boards · All boards · Archived boards**, and `/archived?inbox=true` for Inbox Archive.

## Gotchas

Pinned is public comment pins, not starred tasks. Archived tickets differ from `/trash`.

### What proof to collect

Screenshot the primary heading and one representative control at 1440x900 and 390x844 when the layout differs. Save the URL, account, and flag mode when a flag gates the control.

### Cleanup

Archive or delete only fixtures this check created. Leave production boards unchanged on read-only passes.
