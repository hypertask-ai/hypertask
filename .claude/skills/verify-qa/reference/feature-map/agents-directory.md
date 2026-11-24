# Agents directory

## Sub-features

- `agents-register` Agents directory surface.
- `agents-chat` Agents directory surface.
- `wiki-agents` Agents directory surface.

## How to get to it (user POV)

`/agents` register and list agents (`src/app/agents/page.tsx:7-18`). `/agents/chat` and `/agents/<agentId>` are chat surfaces (`agent-chat-roster.md`). `/wiki/agents` is Universal agent onboarding (`agents-board-access.md`).

## Driving it with agent-browser

`agent-browser` or `ht-verify`, headless, `https://app.hypertask.ai/...?realtime=on`, QA state `~/.config/hypertask-videos/storageState-qa.json`.

Open `/agents` and confirm **Agents** renders. Open `/wiki/agents` and confirm heading **Universal agent onboarding**. Open `/agents/chat` and confirm the roster (`agent-chat-roster` overlap is intentional).

## Gotchas

Do not create or revoke agents unless using throwaway fixtures from `agents-board-access.md`.

### What proof to collect

Screenshot the primary heading and one representative control at 1440x900 and 390x844 when the layout differs. Save the URL, account, and flag mode when a flag gates the control.

### Cleanup

Archive or delete only fixtures this check created. Leave production boards unchanged on read-only passes.
