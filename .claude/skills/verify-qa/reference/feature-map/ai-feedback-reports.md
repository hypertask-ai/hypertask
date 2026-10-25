# Feature map: automatic AI feedback tickets

## How a customer reaches it

An agent's MCP, CLI or API call can file a board-15 ticket in Bugs by itself.
`src/lib/aiFeedback/automatic.ts` queues the report, `fileAiFeedback` in
`src/lib/aiFeedback/report.ts` decides whether it becomes a ticket, bumps an
open one, or is dropped, and the fingerprint in `src/lib/aiFeedback/input.ts`
keys the dedupe.

## How to drive it

- Unit: `node --test tests/htpr-7579-feedback-field.test.cjs` and
  `tests/ai-feedback-service.test.cjs`. They stub the database, so no board
  write happens.
- Live refusal, never creating a ticket when the rule works: call the MCP
  endpoint with a field the tool does not document and read the reply.

```
curl -sS https://app.hypertask.ai/mcp -H "Authorization: Bearer $AGENT_TOKEN" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"hypertask_tasks","arguments":{"action":"list","nonsense_field":"probe"}}}'
```

It must answer `Remove unsupported fields nonsense_field from input`. Count
`An agent's MCP call to hypertask_tasks failed` tickets on board 15 before and
after: a refusal that opens a ticket is the bug this page exists for.

## What usually breaks

- A correct refusal (unknown field, wrong type, bad page/offset pair) filing a
  new ticket, which fills Bugs with work nobody can do.
- The opposite failure is worse: a 5xx, an expired key or a 400 the API itself
  returned must keep filing. The unit tests pin both sides.

## What proof to collect

The MCP reply text, the board ticket count before and after, and the unit test
output. No screenshot is meaningful for this area; a screenshot of the ticket
count is enough when a report calls for one.

## Cleanup

Nothing to delete. Keep the evidence in `~/.local/state/vcc-evidence/<TICKET>/`.
