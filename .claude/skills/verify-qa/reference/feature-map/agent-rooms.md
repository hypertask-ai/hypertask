# Board agent rooms

## Sub-features

- `board-agent-rooms` Board agent rooms.

## How to get to it (user POV)

Open `/agents/chat?view=rooms` or the standalone roster's **Board rooms** button.
Room availability is permanent; the embedded board chat intentionally hides that
navigation link.

## Driving it with agent-browser

1. Run the doctor and core inbox cycle as QA 985.
2. Read `GET /api/agent-rooms` using the same browser session. Record status and
   board IDs and room presence only, not other users' messages or agent details.
3. Select a disposable QA-only board from the returned IDs. Open
   `/agents/chat?view=rooms&board=<boardId>` on desktop 1440x900 and phone
   390x844. Without a valid positive `board` parameter, the first returned board
   is selected. Opening a selected board without a room automatically POSTs to
   create one (`src/app/agents/chat/AgentRoomClient.tsx:173-196`). For a
   read-only check, block POST `/api/agent-rooms` before opening the page, then
   read `GET /api/agent-rooms` again and require that board's `id` is still
   `null`; use a board with an existing room for room details. Check the
   address keeps `view=rooms` after reload.
4. Verify an unauthenticated rooms request is refused. MCP pending requests at
   `/api/mcp/chat/rooms/pending` require an authenticated agent, not a human token.
5. Do not send room messages without disposable non-billing fixtures: replies
   may start paid AI work. Mark sending, Stop and budget mutation checks
   UNREACHABLE when those fixtures are unavailable.

### Hands-free drive on production

```bash
node .claude/skills/verify-qa/scripts/feature-map-drive.mjs agent-rooms --dir /tmp/feature-map-drive
```

Prints `PASS` or `FAIL` per step, writes `result.json` and screenshots into `--dir`, and ends with
`agent-rooms ok`. It refuses any base except `https://app.hypertask.ai`, uses the `qa-login` identities,
creates only fixtures its own cleanup removes, and never prints a cookie, token or email address.

## Gotchas

A missing `view=rooms` makes `/agents/chat` redirect to the direct-chat sidebar
(`src/app/agents/chat/page.tsx:29`); embedded board chat hides the rooms link on purpose
(`src/components/AI_CHAT/AI_Chat_Sidebar.tsx:407`); membership scopes disappear; expired
sessions look empty.

### What proof to collect

Save doctor and desktop/phone room screenshots, GET status and board ID projection,
and reload results. Pair live reads with route tests for authenticated success,
unauthenticated refusal and agent membership scope.

### Cleanup

Record any room created, including its board and room IDs. Clean up core inbox
fixtures.
