# MCP task lookup and hello

## Sub-features

- `unknown-input-field-guidance` Unknown input field guidance.
- `matched-skill-context` Matched skill context.
- `related-task-context` Related task context.
- `indexed-ticket-lookup` With `htpr-8977-indexed-ticket-lookup` on, a ticket-number lookup finds candidates with `lower(ticketNumber)` instead of a case-insensitive scan of every task, then returns the same ticket.
- `materialized-ticket-lookup` With `htpr-8977-materialized-ticket-lookup` on as well, that candidate query is a materialized step, so the lower(ticketNumber) index is used before the database has statistics for it. The returned ticket does not change. Both flags default to Everyone.

## How to get to it (user POV)

- AI clients (claude.ai connector, Claude Code, Cursor) call `POST https://app.hypertask.ai/mcp` with their own bearer token.
- `tools/call` on `hypertask_tasks` with `action: "get"` and `input.ticket_number`, `input.task_id`, or `input.project_id` + `input.unique_index`.
- Guided start: `hypertask_user_context` with `action: "hello"` via `tools/call` in MCP v2 (consolidated tools, on for Everyone), or legacy `hypertask_hello`; also `GET /api/mcp/hello`, behind `htpr-7519-login-guided-start`.
- The legacy tool name `hypertask_get_tasks` takes the same fields at the top level when a client still lists it.
- Ticket-number get, and opening a ticket by its number, share `src/lib/mcp/tasks/resolveTask.ts`. A lookup by `task_id` does not use `htpr-8977-indexed-ticket-lookup` or `htpr-8977-materialized-ticket-lookup`.

## Driving it with agent-browser

1. Doctor: confirm the merge deployment succeeded and a QA account is signed in on `/my-tasks`.
2. Use an agent or QA account's own bearer token, never Valentin's. Send `tools/list`, then `tools/call` with a unique user agent.
3. Call `get` with `ticket_number` as one string (`"HTPR-1234"`) and as a list (`["HTPR-1234"]`); both must return the ticket. A success result carries no `isError` key; assert on the returned task. A refusal carries `isError: true` and a message at HTTP 200.
4. Call `get` with `task_id` as one number and as a list.
5. Call `get` with a malformed ticket number and with no identifier; both must return a readable validation error, not a 500.
6. For hello, use a QA agent of account 985. Compare MCP and GET responses: `agent: {id, displayName}` (or `agent: null` for a user token), and `startBoard: {id, title, boardUrl}`. Require the newest board across all visible boards, not only the first 50; a missing title falls back to the board short name. Use existing fixtures; record an unavailable >50-board or untitled-board case as `UNREACHABLE`.
7. Check every `nextSteps` entry has a CLI command plus a tool name and arguments accepted by the `tools/list` catalog returned to that same credential. With MCP v2 on, require `hypertask_tasks` with `{"action":"list","input":{"project_id":ID}}`, `hypertask_tasks` with `{"action":"create","input":{"project_id":ID,"title":"My first task"}}`, and `hypertask_projects` with `{"action":"playbook","input":{"project_id":ID}}`. Legacy catalogs use `hypertask_list_tasks`, `hypertask_create_task`, and `hypertask_get_board_playbook` with top-level arguments. Write agents get 3 steps; read-only agents get 2, list and playbook, with no create. If hello or `tools/list` exposes the agent role, require the matching count; otherwise accept 2 or 3 but always require list and playbook. Without a board, require `startBoard: null` and empty `nextSteps`. Never execute the create step against production.
8. Reuse the read-only login/hello script and env inputs in [CLI login](cli-install.md). Never print tokens; CLI runs need a temporary `HOME`. The script checks the same-credential catalog, action/input shapes, role-dependent counts and login completion within 5 s. The CLI prints the server's steps and waits at most about 1.5 s for the guide; timeout prints the old saved output. With no board, `--human` says "No board yet. Create one in your Hypertask web app." Check user-token and board-selection cases separately.

### Indexed and materialized ticket lookup

Look up one existing QA ticket by `ticket_number` through `hypertask_tasks` with `action: "get"`, and open that same number in the app. Both return that ticket. Repeat with different letter casing. A number that matches two accessible boards, and no `project_id`, returns HTTP 400 with code `ambiguous_ticket_number` and tells the caller to provide `project_id` on the REST route `GET /api/mcp/tasks`. Through `tools/call` the same refusal arrives as HTTP 200 with `isError: true` and only the message text.

With `htpr-8977-indexed-ticket-lookup` on and `htpr-8977-materialized-ticket-lookup` off, candidates come from `lower("ticketNumber") = lower(...)`. A number that contains `\`, `%`, or `_` uses `ILIKE` instead. The query reads at most 9 ids. More than 8 candidates, or a candidate query that fails, falls back to the older case-insensitive match. Zero candidates skip the live-task scan and still check old ticket-number aliases.

With both flags on, the equality lookup runs inside a materialized step first. Wildcard numbers stay on the `ILIKE` query. `htpr-8977-indexed-ticket-lookup` off uses the older match and ignores `htpr-8977-materialized-ticket-lookup`. Do not switch either flag on production. Do not create a ticket to force two matches. Record an unavailable second match as UNREACHABLE.

### Unknown input field guidance

Call `hypertask_comments` with `action: "add"` and `input: { task_id: <readable ticket>, contnet: "probe" }`.
The call must refuse without saving. With `htpr-7934-nearest-field-hint` enabled,
its original unsupported-field sentence is followed by `Did you mean text?`.
Repeat with `comment`, an unrelated invented key, and a valid `action: "list"`
request for the same ticket. The unrelated key keeps the original sentence;
the valid read succeeds. Local tests cover flag Off byte-for-byte and renamed-field
hint coexistence. Never send a valid comment-add probe on a real ticket.

## Gotchas

- The wire schema (`getGetTasksBaseSchema`) and the service schema (`createTaskIdentificationArraySchema`) drift apart: one accepts a shape the other rejects (HTPR-7206).
- `tools/call` refusals return HTTP 200, so a 200 is not a pass; read `isError` and the message.
- A `z.transform` or `z.preprocess` in the wire schema breaks `z.toJSONSchema` for `tools/list`.
- Hello picks from only the first board page, or suggests legacy tools absent from that credential's MCP v2 catalog.
- The tool description promises a shape the schema rejects; AI clients follow the description first.
- `htpr-8977-materialized-ticket-lookup` changes nothing while `htpr-8977-indexed-ticket-lookup` is off.
- A ticket number that contains `%`, `_`, or `\` does not use the materialized step.
- More than 8 candidate ids, or a failed candidate query, uses the older scan. An empty candidate list does not.

### What proof to collect

- The JSON-RPC request arguments, HTTP status, `isError` and a bounded excerpt of each response, without tokens.
- For hello, redacted identity, board and next-step payloads from both transports, the same-credential catalog comparison and flag state.
- Account or agent identity used, merge sha and deployment success, and the local test results.

### Automated evidence

`node --test tests/get-tasks-single-identifier.test.cjs` checks scalar and list ticket identifiers, numeric task ids, invalid or missing identifiers, and wire-schema JSON conversion.
`node --test tests/htpr-7519-hello-guided-start.test.cjs` checks hello identity, role/catalog-aware next steps, title fallback, and newest-board selection beyond the first 50 with mocked storage.

### Matched skill context

For a private QA ticket, include a harmless `/slug` or a declared
trigger phrase in its description or comment. Read it through CLI task
get and MCP `hypertask_tasks` get, including concise output. Require
`skill_context.active_skills` to contain the complete matching body and
`summary` to name its slug. Read comments and task context too. Disabled
skills must report `status: disabled` in skill list/get and never match.
Verify an inaccessible board's skill body never appears. Flag Off returns
null context; matching remains request-local, without persistent modes.
Use only QA-owned fixtures, and remove them afterward.

### Cleanup

Read-only calls. No board writes or fixtures.

### Related task context

Use existing QA-owned tasks with incoming and outgoing relations, a visible
agent assignee, and recent agent activity. Read only: call
`GET /api/mcp/tasks/context?task_id=<id>&project_id=<id>` with the QA
credential, then repeat with `summary=true`. Check each accessible related task
has its direction, section, assignees, and up to five newest `agentActivities`.
Check inaccessible and deleted related tasks are absent. Repeat with a scoped
agent credential and confirm no outside-board task or private agent name leaks.
Record unavailable fixtures as `UNREACHABLE`; never create or change tickets.
