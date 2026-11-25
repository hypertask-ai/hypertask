# Hypertask design verification map

This map lists every screen a design-pass ticket changes. Read the baseline once, then use the screen's file as the recipe for `design-check run`.

## Baseline preconditions

- Production deployment for the merge is `success`.
- `design-check doctor` printed `doctor ok`.
- The ticket flag reaches the QA account: Owner + QA or Everyone.
- `htpr-8054-graphite-2` reaches the QA account, or Graphite 2 is missing from the theme list.
- The frame name comes from `design-check frames <TICKET> <dir>`.

## Driving conventions

- One `design-check run` per screen per ticket. Use the frame size as `--viewport`.
- Board-level screens use the QA board `https://app.hypertask.ai/project?id=7049&surface=board`.
- Overlays open with `--press`, using the user's own keyboard shortcut.
- Themes are `porcelain` (Light), `amoled` (AMOLED) and `graphite-2` (Graphite 2).

## Proof and skip reporting

- Proof is the run folder: side images, audits and `report.md`.
- A different runner marks every checklist line PASS or FAIL.
- A screen the QA account cannot reach is `UNREACHABLE` with the landed URL. Never prove it through another screen.
- A redirect, a login page or an Off flag is never a pass.

## Feature entry contract

Each file has an H1, one paragraph on what the user sees, then four H2s in order: `Sub-features`, `How to get to it (user POV)`, `Driving it with design-check`, `Gotchas`.

## Features

- [Kanban board](./kanban-board.md): cards, columns, chips, rail and scrollbars.
- [AI chat](./ai-chat.md): sidebar, floating and full-screen chat with the composer.
- [Ctrl+J task writer](./task-writer.md): the new-task composer and its key footer.
- [Inbox list](./inbox-list.md): inbox rows, tags and row text.
- [Agent lane](./agent-lane.md): agent rows on a ticket and their collapse.
