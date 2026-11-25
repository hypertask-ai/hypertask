# Drafts

## Sub-features

- `drafts` Drafts surface.

## How to get to it (user POV)

`https://app.hypertask.ai/drafts` lists unsent comment drafts (`src/app/drafts/page.tsx`, `quick-entry-cards.md`). `g` then `d` opens it when the shortcut is enabled.

## Driving it with agent-browser

`agent-browser` or `ht-verify`, headless, `https://app.hypertask.ai/...?realtime=on`, QA state `~/.config/hypertask-videos/storageState-qa.json`.

Open `/drafts` signed in. Confirm tabs and **No drafts** or existing rows. Do not post unless creating a fixture; read-only pass records the list only.

## Gotchas

Archive error copy uses a curly apostrophe: **Draft wasn’t archived. Try again.**

### What proof to collect

Screenshot the primary heading and one representative control at 1440x900 and 390x844 when the layout differs. Save the URL, account, and flag mode when a flag gates the control.

### Cleanup

Archive or delete only fixtures this check created. Leave production boards unchanged on read-only passes.
