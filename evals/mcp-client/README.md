# MCP client eval

Measures Hypertask MCP against the CLI for the same 20 tasks.

Fixture mode starts an isolated board, calls the production MCP handler stack
over HTTP, and spawns the native `hypertask` binary against that same backend.
It records those surface results only. It does not copy that output onto Claude,
Cursor, or Codex.

A client row is live only when that named client actually ran. An attempted
nonzero exit or timeout is a failed live row. Missing clients are omitted, not
replaced with a passing replay. Scheduled publication fails unless Claude,
Cursor, and Codex each produced MCP and CLI rows.

Token counts are shown only when a provider supplied them. Unavailable usage
renders as a dash, never zero. When a report has no client rows, the agents
page headlines the MCP and CLI surface rates instead of `0% pass`.

## Run

```bash
node evals/mcp-client/run.mjs --mode fixture --label weekly
```

Live clients, only when those binaries are present:

```bash
EVAL_LIVE_CLIENTS=claude,cursor,codex \
EVAL_PROJECT_ID=4242 \
EVAL_TICKET=ISO-1 \
EVAL_TASK_ID=88 \
EVAL_USER_ID=7 \
EVAL_USER_NAME='Eval Agent' \
EVAL_LIVE_WRITES=1 \
EVAL_MEASURE_SURFACES=1 \
node evals/mcp-client/run.mjs --mode live --label live --require-clients claude,cursor,codex --write-transcripts
```

Live tasks refuse unless the project, ticket, task, evaluator ID, and evaluator
name are all explicit. The project must be dedicated to evals. Every prompt,
MCP argument, and CLI argument is rewritten onto that project
before the client runs. After each live call, the harness reads the board
through an independent `hypertask` path and grades a per-row delta, so later
clients are not failed by earlier comments or creates. `--self` is expanded to
the authenticated evaluator id when the released CLI still requires a value.

## When it runs

- Weekly, Monday 06:00 UTC, as an isolated MCP-versus-CLI surface check
- On any PR that touches MCP server, CLI, or eval paths, as the same surface check

Weekly CI publishes `latest.json` to the `eval-reports` branch. It does not
label fixture output as Claude, Cursor, or Codex because hosted CI has no
provider credentials. Run live mode from an authenticated client environment
to add those client rows. The agents dashboard reads the published report,
then falls back to the last committed report.

Results show on `/agents` when the `htpr-6533-mcp-client-eval` flag is on.
