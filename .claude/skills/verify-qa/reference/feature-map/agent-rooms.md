# Board agent rooms

## How a customer reaches it

Open `/agents/chat?view=rooms` or the standalone roster's **Board rooms** button.
Room availability is permanent; the embedded board chat intentionally hides that
navigation link.

## How to drive it

1. Run the doctor and core inbox cycle as QA 985.
2. Read `GET /api/agent-rooms` using the same browser session. Record status and
   board IDs and room presence only, not other users' messages or agent details.
3. Select a disposable QA-only board from the returned IDs. Open
   `/agents/chat?view=rooms&board=<boardId>` on desktop 1440x900 and phone
   390x844. Without a valid positive `board` parameter, the first returned board
   is selected. Opening a selected board without a room automatically POSTs to
   create one. For a read-only check, block POST `/api/agent-rooms` before
   opening the page; use a board with an existing room for room details. Check
   **Board rooms** remains visible after reload.
4. Verify an unauthenticated rooms request is refused. MCP pending requests at
   `/api/mcp/chat/rooms/pending` require an authenticated agent, not a human token.
5. Do not send room messages without disposable non-billing fixtures: replies
   may start paid AI work. Mark sending, Stop and budget mutation checks
   UNREACHABLE when those fixtures are unavailable.

## What usually breaks

The rooms route redirects to a direct-chat sidebar; embedded navigation gains an
unwanted rooms link; membership scopes disappear; expired sessions look empty.

## What proof to collect

Save doctor and desktop/phone room screenshots, GET status and board ID projection,
and reload results. Pair live reads with route tests for authenticated success,
unauthenticated refusal and agent membership scope.

## Cleanup

Record any room created, including its board and room IDs. Clean up core inbox
fixtures.
