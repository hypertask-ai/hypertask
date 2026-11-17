# Agent chat roster ordering

## Sub-features

- `agent-chat-roster-ordering` Agent chat roster ordering.
- `agent-chat-context` With `htpr-7734-agent-chat-context` on, the docked agent composer shows the AI chat scope picker. The message body sends `default_context` with the selected board (`project_id`) or, on an open ticket, `task_id` and `scope` `ticket`, plus `surface_path`. The server keeps that context only when both the sender and the agent can open it, and stores the board or ticket title for the agent. A bad shape is 400. A board or ticket either party cannot open is 404. Flag off sends no context.
- `agent-chat-all` With `htpr-7742-agent-chat-all` on, the agent hello text tells it to read unanswered sidebar chats with the chat inbox tool and to `POST /api/mcp/chat/heartbeat` with `{}` while listening. The composer line says Online when delivery is a chat webhook or a heartbeat under two minutes old, and Reads when it next runs when it is not. Flag off hides those tools and restores the previous status sentence. Messages already delivered stay delivered.

## How to get to it (user POV)

`/agents/chat` normally redirects to the board's chat sidebar. The standalone
roster remains reachable with `?agent=<owned-agent-id>` when that owned agent
has no accessible board. A nonexistent UUID also reaches the empty-selection
fallback without creating a chat. Never detach an agent to force this path.
The context picker and the Online line are on the docked board chat, not on
the empty standalone roster. Open a board the signed-in user and the agent
both belong to.

## Driving it with agent-browser

1. Run the QA 985 doctor and core inbox cycle.
2. Use customer 2343 for read-only roster checks. Its `/api/agents/owned`
   response does not seed default agents. QA 985's response can seed agents
   across accessible teams: follow agents-board-access.md before using it.
3. Read owned agents, retain only id, name, recency and archived/revoked state.
   Open the standalone path with a nonexistent UUID for read-only empty selection.
4. Compare visible roster order with descending lastChatMessageAt; equal or
   missing timestamps sort by displayName. Board comment time must not win.
5. On phone, keep the empty selection: Back to agents redirects to the board
   sidebar. Reload and repeat on desktop 1440x900 and phone 390x844.
6. Only send messages or simulate agent replies using disposable, non-billing
   fixtures. If unavailable, mark live message bump proof UNREACHABLE and
   retain read-only ordering plus targeted send/realtime coverage.

7. Compare each roster row with the owned-agent response: unexpired working
   tickets are green; out-of-tokens is amber; recent heartbeat/post without
   work is gray with idle duration; no signal within 24 hours is inactive.
   External/native labels, unread badges and selection remain unchanged.
   Roster status is permanent; no status flag is needed. Check the idle clock
   advances after 30 seconds without reloading, using a recent-signal fixture
   only if one already exists. Never modify an existing agent to force it.
8. With `htpr-7734-agent-chat-context` on, pick the open ticket in the docked
   composer and send one disposable message. Read the saved context and require
   the ticket id. Repeat with a ticket the agent cannot open and require 404.
   Flag off must omit `default_context`.
9. With `htpr-7742-agent-chat-all` on, require the composer line Online or
   Reads when it next runs, and require the chat inbox tool on an agent token.
   Do not invent a second chat registration.

## Gotchas

Board-post ordering returns; missing timestamps lose name ties; revoked or
archived agents reappear; a mobile selected chat hides the roster during QA.
Context off does not retract a title already sent. Chat-all off does not
recall a message the agent already received. A native agent is refused on
this composer and is told to use AI chat.

### What proof to collect

Save bootstrap identity, doctor screenshot, redacted owned-agent projection,
ordered roster row text, desktop/phone screenshots and reload comparisons.
Record unreachable fixtures honestly. The owned GET handler and navigation
hook are the tested dispatch boundaries.

### Cleanup

Read-only verification creates no fixtures. Never revoke existing agents.
