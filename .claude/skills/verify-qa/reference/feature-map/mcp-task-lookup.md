# MCP task lookup

## How a customer reaches it

- AI clients (claude.ai connector, Claude Code, Cursor) call `POST https://app.hypertask.ai/mcp` with their own bearer token.
- `tools/call` on `hypertask_tasks` with `action: "get"` and `input.ticket_number`, `input.task_id`, or `input.project_id` + `input.unique_index`.
- The legacy tool name `hypertask_get_tasks` takes the same fields at the top level when a client still lists it.

## How to drive it

1. Doctor: confirm the merge deployment succeeded and a QA account is signed in on `/my-tasks`.
2. Use an agent or QA account's own bearer token, never Valentin's. Send `tools/list`, then `tools/call` with a unique user agent.
3. Call `get` with `ticket_number` as one string (`"HTPR-1234"`) and as a list (`["HTPR-1234"]`); both must return the ticket, `isError` false.
4. Call `get` with `task_id` as one number and as a list.
5. Call `get` with a malformed ticket number and with no identifier; both must return a readable validation error, not a 500.

## What usually breaks

- The wire schema (`getGetTasksBaseSchema`) and the service schema (`createTaskIdentificationArraySchema`) drift apart: one accepts a shape the other rejects (HTPR-7206).
- A `z.transform` or `z.preprocess` in the wire schema breaks `z.toJSONSchema` for `tools/list`.
- The tool description promises a shape the schema rejects; AI clients follow the description first.

## What proof to collect

- The JSON-RPC request arguments, HTTP status, `isError` and a bounded excerpt of each response, without tokens.
- Account or agent identity used, merge sha and deployment success, and the local test results.

## Cleanup

Read-only calls. No board writes or fixtures.
