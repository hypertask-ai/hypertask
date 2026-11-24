# Feature map: automatic AI feedback tickets

## Sub-features

- `feature-map-automatic-ai-feedback-tickets` Feature map: automatic AI feedback tickets.
- `plain-ai-feedback` With `htpr-7536-plain-ai-feedback` on, the ticket is plain sentences: what happened, who hit it, whether it looks like a bug, and what to do. An agent access refusal (wrong key, or a board or action the agent may not use) updates an open matching ticket and does not open a new one. A 5xx still files. Flag off keeps the previous report text.
- `quiet-fixable-reports` With `htpr-7941-quiet-fixable-reports` on, an MCP 400 the caller can correct from the named field or listed value does not file a ticket. The same fingerprint already filed in the last 24 hours is not filed again. A refusal that names nothing the caller can fix still files. The flag ships at EVERYONE. Runners never switch it Off, so a live flag-off check is UNREACHABLE. Even in the off state, `fileAiFeedback` still drops an automatic 400 through `quietInputRefusal` in `src/lib/aiFeedback/callerFixable.ts` when the code is `unrecognized_keys`, `invalid_enum_value` or `unrecognized`, or a named-field code such as `invalid_type` that includes a field. The flag is unread on that drop. Other caller-fixable refusals file only in that off state. Proof is `tests/htpr-7941-quiet-fixable-reports.test.cjs`.
- `agent-feedback-note` With `htpr-8275-agent-feedback-note` on, an internal Hypertask account keeps `kind` (`bug`, `friction`, `missing` or `idea`) and a short note of plain words, with credentials stripped. Any other account drops that free text. The title becomes `Agent feedback, <kind>: <note>`. Flag off drops the kind before filing.
- `feedback-pr-repeat` With `htpr-9581-feedback-pr-repeat` on, a repeat of the same failure joins the open ticket when the note only changes the pull request number. The error code, surface, tool, HTTP status, field, category, kind, the words before the number and the words after it all have to match. A missing line matches only a log that also omitted it. With the house log off the lookup searches the ticket description too. Flag off files a separate ticket for a number that was never joined. Proof is `tests/htpr-9581-feedback-pr-repeat.test.cjs`.
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
  endpoint with a field the tool does not document and read the reply. A
  disposable agent credential is at `~/.config/ht-qa/htpr-8090-agent.json`
  (`{id, token}`); read it into the variable, never print it. The reply is a
  JSON-RPC result with `result.isError: true`, not an HTTP error.

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
  refusal and the 24-hour fingerprint. Do not turn
  `htpr-7941-quiet-fixable-reports` Off. A live flag-off check is
  UNREACHABLE. The test is the proof that `unrecognized_keys` and
  `invalid_type` with a field stay dropped when the flag is off.
- `tests/htpr-8275-agent-feedback-note.test.cjs` covers the internal note
  and the dropped customer text.
- `tests/htpr-9581-feedback-pr-repeat.test.cjs` covers the pull request
  repeat. `POST /api/mcp/feedback` answers 200 for a body such as
  `{"surface":"cli","tool":"git-commit","errorCode":"co-authored-by-injected","category":"other","note":"Cursor session appended Co-authored-by trailer to bot commits; check-commit-identities failed on PR 1188."}`.
  The same body with `PR 1200` answers `"deduped":true` and the same
  `ticketNumber`. `surface` accepts `mcp`, `cli`, `api` or `agent` only.
- `tests/htpr-8276-feedback-slack-line.test.cjs` covers the one Slack line.
  Do not post to the team channel by hand.

### Hands-free drive on production

```bash
node .claude/skills/verify-qa/scripts/feature-map-drive.mjs ai-feedback-reports --dir /tmp/feature-map-drive
```

Prints `PASS` or `FAIL` per step, writes `result.json` and screenshots into `--dir`, and ends with
`ai-feedback-reports ok`. It refuses any base except `https://app.hypertask.ai`, uses the `qa-login` identities,
creates only fixtures its own cleanup removes, and never prints a cookie, token or email address.

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
