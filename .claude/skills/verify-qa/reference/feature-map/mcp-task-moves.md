# MCP task moves

## Sub-features

- `mcp-task-moves` MCP task moves.

## How to get to it (user POV)

Agents use `hypertask task move` or `POST /api/mcp/tasks/update` with `sectionId`.
The section adapter calls the ordinary task move route.

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

### What proof to collect

CLI replies and exit codes, before/after columns, flag mode, regression output,
deployment SHA, QA 985 doctor screenshot and the core inbox cycle.

### Cleanup

Mark only the fixture created by this run Deleted through `vcc`.
