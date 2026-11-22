# Reminders

## Sub-features

- `reminders-list` Reminders surface.

## How to get to it (user POV)

`https://app.hypertask.ai/reminders` lists saved reminders (`src/app/reminders/page.tsx`, also `inbox.md`). `g` then a reminders shortcut when configured.

## Driving it with agent-browser

`agent-browser` or `ht-verify`, headless, `https://app.hypertask.ai/...?realtime=on`, QA state `~/.config/hypertask-videos/storageState-qa.json`.

Open `/reminders`. Confirm heading **Reminders**, rows with **Remind me**, and that Enter opens the ticket. Press `E` or **Remind now** on one sandbox reminder; confirm toast **Please check your inbox!** and find the item in `/inbox`.

## Gotchas

E sends into the inbox; archive the row after proof. Do not bulk-invoke every reminder.

### What proof to collect

Screenshot the primary heading and one representative control at 1440x900 and 390x844 when the layout differs. Save the URL, account, and flag mode when a flag gates the control.

### Cleanup

Archive or delete only fixtures this check created. Leave production boards unchanged on read-only passes.
