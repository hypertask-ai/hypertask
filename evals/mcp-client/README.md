# MCP client eval

Measures Hypertask MCP against the CLI for the same 20 tasks, on Claude, Cursor, and Codex.

Each row records pass/fail, tokens in, tokens out, wall time, and tool-call count.

## Run

```bash
node evals/mcp-client/run.mjs --mode replay --label pre-6478 --write-baseline
```

Replay is the CI default. It grades the expected MCP tools and CLI commands for every task and writes `src/lib/mcpClientEval/latest.json`.

Live CLI execution (read-only tasks only, unless `EVAL_LIVE_WRITES=1`):

```bash
HYPERTASK_BIN=hypertask node evals/mcp-client/run.mjs --mode live --label live
```

## When it runs

- Weekly, Monday 06:00 UTC
- On any PR that touches `src/lib/mcp-server/**`, `src/lib/mcp/**`, `src/app/api/mcp/**`, `src/app/mcp/**`, or `evals/mcp-client/**`

Results show on `/agents` when the `htpr-6533-mcp-client-eval` flag is on.
