# Feature map: automatic AI feedback tickets

## Sub-features

- `feature-map-automatic-ai-feedback-tickets` Feature map: automatic AI feedback tickets.
- `plain-ai-feedback` With `htpr-7536-plain-ai-feedback` on, the ticket is plain sentences: what happened, who hit it, whether it looks like a bug, and what to do. An agent access refusal (wrong key, or a board or action the agent may not use) updates an open matching ticket and does not open a new one. A 5xx still files. Flag off keeps the previous report text.
- `quiet-fixable-reports` With `htpr-7941-quiet-fixable-reports` on, an MCP 400 the caller can correct from the named field or listed value does not file a ticket. The same fingerprint already filed in the last 24 hours is not filed again. A refusal that names nothing the caller can fix still files. Flag off files every refusal.
- `agent-feedback-note` With `htpr-8275-agent-feedback-note` on, an internal Hypertask account keeps `kind` (`bug`, `friction`, `missing` or `idea`) and a short note of plain words, with credentials stripped. Any other account drops that free text. The title becomes `Agent feedback, <kind>: <note>`. Flag off drops the kind before filing.
- `feedback-slack-line` With `htpr-8276-feedback-slack-line` on, a new board-15 ticket that carries the `ai-feedback` label posts one Slack line: kind, summary, and `https://app.hypertask.ai/detail/project-15/<index>`. No channel or no Slack install posts nothing and still creates the ticket. Flag off posts nothing.

## How to get to it (user POV)

An agent's MCP, CLI or API call can file a board-15 ticket in Bugs by itself.
`src/lib/aiFeedback/automatic.ts` queues the report, `fileAiFeedback` in
`src/lib/aiFeedback/report.ts` decides whether it becomes a ticket, bumps an
open one, or is dropped, and the fingerprint in `src/lib/aiFeedback/input.ts`
keys the dedupe. The four flags above change that same filing path:
plain wording, skipping a caller-fixable refusal, keeping an internal
note, and posting the Slack line. None of them add a screen.

## Driving it with agent-browser

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
- `tests/htpr-7536-plain-ai-feedback.test.cjs` covers the plain sections and
  the access refusal that must not open a ticket.
- `tests/htpr-7941-quiet-fixable-reports.test.cjs` covers a caller-fixable
  refusal and the 24-hour fingerprint.
- `tests/htpr-8275-agent-feedback-note.test.cjs` covers the internal note
  and the dropped customer text.
- `tests/htpr-8276-feedback-slack-line.test.cjs` covers the one Slack line.
  Do not post to the team channel by hand.

## Gotchas

- A correct refusal (unknown field, wrong type, bad page/offset pair) filing a
  new ticket, which fills Bugs with work nobody can do.
- A hand-filed `call_failed` report that names a tool but no status, error code
  or field opening a ticket nobody can act on (HTPR-8197). It is answered with
  `reason: no_evidence` and no ticket; adding `--status` or `--error-code` files it.
- The opposite failure is worse: a 5xx, an expired key or a 400 the API itself
  returned must keep filing. The unit tests pin both sides.
- A caller-fixable 400 filing a new ticket while `htpr-7941-quiet-fixable-reports` is on.
- A customer note or a credential-shaped note stored on the ticket.
- A Slack line for a bump of an existing ticket, or a line that contains the report body. The line is kind, summary and URL, and only when the ticket is created.

### What proof to collect

The MCP reply text, the board ticket count before and after, and the unit test
output. No screenshot is meaningful for this area; a screenshot of the ticket
count is enough when a report calls for one.

### Cleanup

Nothing to delete. Keep the evidence in `~/.local/state/vcc-evidence/<TICKET>/`.
