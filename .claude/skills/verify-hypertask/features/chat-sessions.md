# Chat sessions

## Sub-features

- `chat-session-url` Chat sessions surface.
- `full-screen-chat` Chat sessions surface.

## How to get to it (user POV)

`/chat` and `/chat/<sessionId>` full-screen AI chat (`src/app/chat/page.tsx`, `src/app/chat/[sessionId]/page.tsx`, `ai-chat.md`).

## Driving it with agent-browser

`agent-browser` or `ht-verify`, headless, `https://app.hypertask.ai/...?realtime=on`, QA state `~/.config/hypertask-videos/storageState-qa.json`.

Open `/chat` signed in. Confirm the composer and session list or empty state. Open `/chat/<known-session-id>` only when a disposable session exists; otherwise record list-only proof. Do not send messages that spend model budget unless the ticket requires it.

## Gotchas

Docked sidebar chat is `ai-chat.md`, not these routes. Session paging uses `htpr-6971-chat-history-paging`.

### What proof to collect

Screenshot the primary heading and one representative control at 1440x900 and 390x844 when the layout differs. Save the URL, account, and flag mode when a flag gates the control.

### Cleanup

Archive or delete only fixtures this check created. Leave production boards unchanged on read-only passes.
