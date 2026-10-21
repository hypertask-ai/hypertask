# MCP task lookup and hello

## How a customer reaches it

- AI clients (claude.ai connector, Claude Code, Cursor) call `POST https://app.hypertask.ai/mcp` with their own bearer token.
- `tools/call` on `hypertask_tasks` with `action: "get"` and `input.ticket_number`, `input.task_id`, or `input.project_id` + `input.unique_index`.
- Guided start: `hypertask_hello` via `tools/call`, or `GET /api/mcp/hello`, behind `htpr-7519-login-guided-start`.
- The legacy tool name `hypertask_get_tasks` takes the same fields at the top level when a client still lists it.

## How to drive it

1. Doctor: confirm the merge deployment succeeded and a QA account is signed in on `/my-tasks`.
2. Use an agent or QA account's own bearer token, never Valentin's. Send `tools/list`, then `tools/call` with a unique user agent.
3. Call `get` with `ticket_number` as one string (`"HTPR-1234"`) and as a list (`["HTPR-1234"]`); both must return the ticket, `isError` false.
4. Call `get` with `task_id` as one number and as a list.
5. Call `get` with a malformed ticket number and with no identifier; both must return a readable validation error, not a 500.
6. For hello, use a QA agent of account 985. Compare MCP and GET responses: `agent: {id, displayName}` (or `agent: null` for a user token), and `startBoard: {id, title, boardUrl}`. Require the newest board across all visible boards, not only the first 50; a missing title falls back to the board short name. Use existing fixtures; record an unavailable >50-board or untitled-board case as `UNREACHABLE`.
7. Check every `nextSteps` entry has a CLI command plus a tool name and arguments accepted by the `tools/list` catalog returned to that same credential. With MCP v2 on, expect consolidated tools such as `hypertask_tasks` with the matching `action` and input arguments, not legacy names. Read-only agents get 2 steps and no create. Never execute the create step against production.
8. Reuse the read-only login/hello script and env inputs in [CLI login](cli-install.md). Never print tokens; CLI runs need a temporary `HOME`. The script's legacy tool expectations do not replace the same-credential catalog check, user-token, read-only or board-selection cases above.

## What usually breaks

- The wire schema (`getGetTasksBaseSchema`) and the service schema (`createTaskIdentificationArraySchema`) drift apart: one accepts a shape the other rejects (HTPR-7206).
- A `z.transform` or `z.preprocess` in the wire schema breaks `z.toJSONSchema` for `tools/list`.
- Hello picks from only the first board page, or suggests legacy tools absent from that credential's MCP v2 catalog.
- The tool description promises a shape the schema rejects; AI clients follow the description first.

## What proof to collect

- The JSON-RPC request arguments, HTTP status, `isError` and a bounded excerpt of each response, without tokens.
- For hello, redacted identity, board and next-step payloads from both transports, the same-credential catalog comparison and flag state.
- Account or agent identity used, merge sha and deployment success, and the local test results.

## Cleanup

Read-only calls. No board writes or fixtures.
