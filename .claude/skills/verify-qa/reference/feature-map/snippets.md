# Snippets

## Sub-features

- `snippets` Snippets surface.

## How to get to it (user POV)

`https://app.hypertask.ai/snippets`, or Commands **Go to snippets**, or `g` then `;` (`src/app/snippets/page.tsx`, `pages.md`).

## Driving it with agent-browser

`agent-browser` or `ht-verify`, headless, `https://app.hypertask.ai/...?realtime=on`, QA state `~/.config/hypertask-videos/storageState-qa.json`.

Open `/snippets`. Create a snippet with title and body, reload, confirm **Saved snippets** lists it, then Delete and confirm it is gone.

## Gotchas

Snippets are separate from Pages (`/pages`) and ticket-linked pages (`/page/<id>`).

### What proof to collect

Screenshot the primary heading and one representative control at 1440x900 and 390x844 when the layout differs. Save the URL, account, and flag mode when a flag gates the control.

### Cleanup

Archive or delete only fixtures this check created. Leave production boards unchanged on read-only passes.
