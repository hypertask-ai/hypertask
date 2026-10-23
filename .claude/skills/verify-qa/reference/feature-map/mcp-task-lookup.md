# MCP task lookup and hello

## How a customer reaches it

- AI clients (claude.ai connector, Claude Code, Cursor) call `POST https://app.hypertask.ai/mcp` with their own bearer token.
- `tools/call` on `hypertask_tasks` with `action: "get"` and `input.ticket_number`, `input.task_id`, or `input.project_id` + `input.unique_index`.
- Guided start: `hypertask_user_context` with `action: "hello"` via `tools/call` in MCP v2 (consolidated tools, on for Everyone), or legacy `hypertask_hello`; also `GET /api/mcp/hello`, behind `htpr-7519-login-guided-start`.
- The legacy tool name `hypertask_get_tasks` takes the same fields at the top level when a client still lists it.

## How to drive it

1. Doctor: confirm the merge deployment succeeded and a QA account is signed in on `/my-tasks`.
2. Use an agent or QA account's own bearer token, never Valentin's. Send `tools/list`, then `tools/call` with a unique user agent.
3. Call `get` with `ticket_number` as one string (`"HTPR-1234"`) and as a list (`["HTPR-1234"]`); both must return the ticket, `isError` false.
4. Call `get` with `task_id` as one number and as a list.
5. Call `get` with a malformed ticket number and with no identifier; both must return a readable validation error, not a 500.
6. For hello, use a QA agent of account 985. Compare MCP and GET responses: `agent: {id, displayName}` (or `agent: null` for a user token), and `startBoard: {id, title, boardUrl}`. Require the newest board across all visible boards, not only the first 50; a missing title falls back to the board short name. Use existing fixtures; record an unavailable >50-board or untitled-board case as `UNREACHABLE`.
7. Check every `nextSteps` entry has a CLI command plus a tool name and arguments accepted by the `tools/list` catalog returned to that same credential. With MCP v2 on, require `hypertask_tasks` with `{"action":"list","input":{"project_id":ID}}`, `hypertask_tasks` with `{"action":"create","input":{"project_id":ID,"title":"My first task"}}`, and `hypertask_projects` with `{"action":"playbook","input":{"project_id":ID}}`. Legacy catalogs use `hypertask_list_tasks`, `hypertask_create_task`, and `hypertask_get_board_playbook` with top-level arguments. Write agents get 3 steps; read-only agents get 2, list and playbook, with no create. If hello or `tools/list` exposes the agent role, require the matching count; otherwise accept 2 or 3 but always require list and playbook. Without a board, require `startBoard: null` and empty `nextSteps`. Never execute the create step against production.
8. Reuse the read-only login/hello script and env inputs in [CLI login](cli-install.md). Never print tokens; CLI runs need a temporary `HOME`. The script checks the same-credential catalog, action/input shapes, role-dependent counts and login completion within 5 s. The CLI prints the server's steps and waits at most about 1.5 s for the guide; timeout prints the old saved output. With no board, `--human` says "No board yet. Create one in your Hypertask web app." Check user-token and board-selection cases separately.

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
