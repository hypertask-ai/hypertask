# Server feature-flag check

## Sub-features

- `server-feature-flag-check` Server feature-flag check.

## How to get to it (user POV)

Production pull requests report `feature-flag-gate`.
The trusted production evaluator checks candidate Git blobs.
It never executes candidate application code.
No app screen, account or flag mode changes.

## Driving it with agent-browser

No browser. Drive the evaluator with `gh` plus a small pinned git clone. The
critical rule: run **today's** `.github/scripts/feature-flag-gate.mjs` from the
checkout, with the replay clone as `cwd`. Running the script from the pinned
base checkout instead silently uses the old evaluator, which passes every
server-only diff (verified 2026-11-20).

1. Build the replay clone and fetch both candidates:
   `git init /tmp/ffg && cd /tmp/ffg && git remote add origin
   https://github.com/hypertask-ai/hypertask.git` then
   `git fetch --depth=1 origin ca43cb83a35eabcd5d2e76e9fa7772e14e004be8
   d1f4309ee18d0594707f4a215fae56b2aa756da8
   9248c34e59a412d5054b36da190372fa3cf2f7e5`, then `git fetch --deepen=300`
   until `git merge-base` answers for both pairs.
2. `git update-ref refs/remotes/origin/production
   ca43cb83a35eabcd5d2e76e9fa7772e14e004be8` and check it out detached.
3. `export FEATURE_FLAG_TYPESCRIPT_PATH=<repo>/node_modules/typescript/lib/typescript.js`
   and require that file exists before running.
4. First candidate, from `/tmp/ffg`:
   `node <repo>/.github/scripts/feature-flag-gate.mjs "HTPR-7723 [CLI/MCP/AI]
   MCP and CLI can set blocked by person" ca43cb83… d1f4309e… /tmp/decision-first.txt`
   exits 1 and names `src/lib/flags/definitions/htpr-7723-<name>.ts` plus the
   changed server files.
5. Final candidate, same shape with `9248c34e…`: exits 0, writes
   `feature-gated-ui`, and names `htpr-7723-task-waiting-on` covering
   `src/lib/mcp/operations/tasks/waiting-on/operation.ts`.
6. `git rev-parse refs/remotes/origin/production` still prints `ca43cb83…`.
   If it prints the current tip, or the result says `No changed file matches
   the UI-change path filter.`, the replay was vacuous: re-pin and rerun.
7. Live head check: `gh api
   repos/hypertask-ai/hypertask/commits/<open-pr-head>/statuses --jq
   '.[]|select(.context=="feature-flag-gate")|{state,description}'`.
8. Fleet and parser evidence:
   `gh run list --workflow=feature-flag-gate.yml --limit 10`, then read
   `.github/workflows/feature-flag-gate.yml` on `production` for the trusted
   parser install and `FEATURE_FLAG_TYPESCRIPT_PATH`.

## Gotchas

- Server-only changes bypass the UI-only early return: today's evaluator has a
  server branch, but a pinned historical base may not.
- A client hook pretends to gate server behavior.
- Discarded, unrelated or unchanged reads count as coverage.
- Real MCP wrapper callbacks appear unreachable.
- Discarded or lazy generator callbacks appear live.
- Server success excuses unrelated UI changes.
- A new decision token escapes owner-review routing.
- A replay run from the pinned base checkout, or with a stale
  `refs/remotes/origin/production`, silently passes server-only diffs with `No
  changed file matches the UI-change path filter.` and writes `automerge`.
- Five leftover `console.error('DEBUG …')` lines in the merged evaluator print
  on every run (`feature-flag-gate.mjs` DEBUG block); they are not a failure.

### What proof to collect

Save the first and final CLI outputs with exit codes, the final decision file
(`feature-gated-ui`), the pinned production ref before and after, and a live
open-PR feature-flag-gate status. Use base `ca43cb83…`, not the feature
branch's older fork point, and run today's evaluator from the repo, not the
base checkout. A decision file needs the fourth argument; the workflow calls
the CLI with three and publishes only a status description, so do not expect
a decision token from the workflow itself.
The check is bounded syntax evidence; review still judges complete flag coverage.
Existing title and label exemptions remain unchanged.
No product flag is needed for this infrastructure change.

### Cleanup

No production settings or customer fixtures change.
Retain sanitized evidence outside the worktree.
