# Server feature-flag check

## How a customer reaches it

Production pull requests report `feature-flag-gate`.
The trusted production evaluator checks candidate Git blobs.
It never executes candidate application code.
No app screen, account or flag mode changes.

## How to drive it

1. Confirm the merge's production deployment succeeded.
2. Fetch production and run its merged evaluator CLI.
3. Replay PR 2034 using production base `ca43cb83a35eabcd5d2e76e9fa7772e14e004be8`.
4. First candidate `d1f4309ee18d0594707f4a215fae56b2aa756da8` must fail, naming the server helper and definition path.
5. Final candidate `9248c34e59a412d5054b36da190372fa3cf2f7e5` must pass using title `HTPR-7723 [CLI/MCP/AI] MCP and CLI can set blocked by person`.
6. Set `FEATURE_FLAG_TYPESCRIPT_PATH` to the installed trusted TypeScript parser.
7. Confirm the final CLI writes `feature-gated-ui`, retaining owner-review routing.
8. Read current-head CI results for the feature-gate, parser-dependency and auto-merge fixtures.
9. Run the standard production doctor and inbox cycle after the app deployment.

## What usually breaks

- Server-only changes bypass the UI-only early return.
- A client hook pretends to gate server behavior.
- Discarded, unrelated or unchanged reads count as coverage.
- Real MCP wrapper callbacks appear unreachable.
- Discarded or lazy generator callbacks appear live.
- Server success excuses unrelated UI changes.
- A new decision token escapes owner-review routing.
- Historical merges contaminate replay with unrelated production UI changes.

## What proof to collect

Save merge/deployment metadata, first and final CLI outputs with exit codes,
the final decision file, current-head CI verdicts, and targeted fixture output.
Use the actual production base above, not the feature branch's older fork point.
The check is bounded syntax evidence; review still judges complete flag coverage.
Existing title and label exemptions remain unchanged.
No product flag is needed for this infrastructure change.

## Cleanup

No production settings or customer fixtures change.
Retain sanitized evidence outside the worktree.
