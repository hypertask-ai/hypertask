# MCP task moves

## Sub-features

- `mcp-task-moves` MCP task moves.

## How to get to it (user POV)

Agents use `hypertask task move` (`POST /api/mcp/tasks/move`) with
`{"task_id": <number>, "ticket_number": "<key>", "target_project_id": <number>, "target_section_id": <number>}`.
One of `task_id`, `ticket_number` or `project_id` plus `unique_index` identifies the ticket;
`target_project_id` is required and must be a live board, because a move into an archived
board is refused. Moving between two columns of one board is the ordinary update route.

## Driving it with agent-browser

1. Confirm the production deployment and QA 985 doctor screenshot.
2. Create one disposable child ticket on QA Sandbox 7049 through MCP, titled with the `[qa-runner]` prefix and carrying the board's required Problem/Fix/Done when/Risk/Decision block. Board 15 refuses a scoped agent's create, so the fixture starts on 7049.
3. Move it between two ordinary columns and read it back each time:

```bash
# move takes target_project_id (required) and target_section_id
hypertask_tasks {"action":"move","input":{"task_id":<id>,"target_project_id":7049,"target_section_id":19410}}
hypertask_tasks {"action":"get","input":{"task_id":<id>}}            # status: Doing
hypertask_tasks {"action":"move","input":{"task_id":<id>,"target_project_id":7049,"target_section_id":19409}}
```

4. For the refusal, the fixture must carry a flag link whose current mode is not Everyone, then move it to board 15's `Flag: Everyone` column (section 4312). A fixture with no flag link moves in without a refusal, so that row is verified-unreachable until a flag-linked QA ticket exists on a board the acting credential can move. Record the prerequisite and the route attempted.
5. Check real server failures, partial updates and flag rollback locally with `node --test tests/htpr-7990-task-move-refusal.test.cjs`; never induce production server failures.

## Gotchas

A refused move keeps its 4xx status and `code: task_move_refused` when
`htpr-7990-task-move-refusal` is on or the caller sent `expected_section_id`;
persistence passes the status through instead of turning it into a 500. With
both absent the old plain-Error path returns 500. Assert the status, not just
"not 500".

The `move` action takes `target_project_id` and `target_section_id`; a
`section_id` field is refused as unsupported.

A ticket moved to another board keeps its old key resolvable and names it. Task get,
list, search, next, context, batch read and the move response carry
`previousTicketNumbers`, newest old key first, while the old key still opens the same
ticket. A number a live ticket occupies, a blank alias and the current key are left out.
The ticket switch `htpr-9542-moved-ticket-old-key` defaults to Everyone; off omits the
field, and so does a failed flag read or alias lookup, so the read or the move still
returns the ticket.

To check it on production, move one disposable fixture to a second board the QA user can
write, then read the ticket back by its old key:

```bash
hypertask_tasks {"action":"move","input":{"ticket_number":"<old key>","target_project_id":7049}}
hypertask_tasks {"action":"get","input":{"ticket_number":"<old key>"}}   # names previousTicketNumbers
```

The local verifier seeds one writable board and one archived board, and the move route
refuses an archived target, so the browser harness cannot drive a cross-board move. The
changed test is the proof there: `node --test tests/htpr-9542-moved-ticket-old-key.test.cjs`,
which also shows the base commit failing it.

### What proof to collect

CLI replies and exit codes, before/after columns, flag mode, regression output,
deployment SHA, QA 985 doctor screenshot and the core inbox cycle.

### Cleanup

Mark only the fixture created by this run Deleted through `vcc`.
