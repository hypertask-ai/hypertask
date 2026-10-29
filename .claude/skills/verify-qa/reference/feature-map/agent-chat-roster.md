# Agent chat roster ordering

## How a customer reaches it

`/agents/chat` normally redirects to the board's chat sidebar. The standalone
roster remains reachable with `?agent=<owned-agent-id>` when that owned agent
has no accessible board. A nonexistent UUID also reaches the empty-selection
fallback without creating a chat. Never detach an agent to force this path.

## How to drive it

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

## What usually breaks

Board-post ordering returns; missing timestamps lose name ties; revoked or
archived agents reappear; a mobile selected chat hides the roster during QA.

## What proof to collect

Save bootstrap identity, doctor screenshot, redacted owned-agent projection,
ordered roster row text, desktop/phone screenshots and reload comparisons.
Record unreachable fixtures honestly. The owned GET handler and navigation
hook are the tested dispatch boundaries.

## Cleanup

Read-only verification creates no fixtures. Never revoke existing agents.
