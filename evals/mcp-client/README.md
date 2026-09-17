# MCP client eval

Measures Hypertask MCP against the CLI for the same 20 tasks.

CI fixture mode starts an isolated board, calls MCP over HTTP, and spawns a CLI binary. It records those surface results only. It does not copy that output onto Claude, Cursor, or Codex.

A client row is live only when that named client actually ran. An attempted nonzero exit or timeout is a failed live row. Missing clients are omitted, not replaced with a passing replay.

Token counts are shown only when a provider supplied them. Unavailable usage renders as a dash, never zero.

## Run

```bash
node evals/mcp-client/run.mjs --mode fixture --label weekly
```

Live clients, only when those binaries are present:

```bash
EVAL_LIVE_CLIENTS=claude,cursor,codex EVAL_PROJECT_ID=99 node evals/mcp-client/run.mjs --mode live --label live
```

Mutating live tasks also need `EVAL_LIVE_WRITES=1` and `EVAL_PROJECT_ID` for an isolated project.

## When it runs

- Weekly, Monday 06:00 UTC
- On any PR that touches MCP server, CLI, or eval paths

Weekly runs publish `latest.json` to the `eval-reports` branch. The agents dashboard reads that file, then falls back to the last committed report.

Results show on `/agents` when the `htpr-6533-mcp-client-eval` flag is on.
