# MCP client eval

Measures Hypertask MCP against the CLI for the same 20 tasks, on Claude, Cursor, and Codex.

Each row records pass/fail, tokens in, tokens out, wall time, and tool-call count. Token counts are shown only when a provider or recorded transcript supplied them. Estimates are labeled `est.` and never treated as measured cost.

## Run

```bash
node evals/mcp-client/run.mjs --mode fixture --label pre-6478 --write-baseline
```

Fixture mode is the CI default. It starts an isolated in-memory board, executes the real MCP HTTP adapter and a spawned CLI binary against that board, and grades stdout plus post-operation state. Client rows come from independent recorded transcripts unless that named client actually ran.

Live client execution, only for clients listed in `EVAL_LIVE_CLIENTS` whose binaries are present:

```bash
EVAL_LIVE_CLIENTS=claude,cursor,codex node evals/mcp-client/run.mjs --mode live --label live
```

A row is marked live only when that specific client and transport ran. Mutating tasks stay on the isolated EVAL fixture unless `EVAL_LIVE_WRITES=1` and `EVAL_PROJECT_ID` points at a disposable project.

## When it runs

- Weekly, Monday 06:00 UTC
- On any PR that touches `src/lib/mcp-server/**`, `src/lib/mcp/**`, `src/app/api/mcp/**`, `src/app/mcp/**`, or `evals/mcp-client/**`

Weekly runs publish `latest.json` to the `eval-reports` branch. The agents dashboard reads that published file, then falls back to the last committed report.

Results show on `/agents` when the `htpr-6533-mcp-client-eval` flag is on.
