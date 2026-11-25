# CI tests and parallel code checks

## Sub-features

- `ci-app-api-pool` CI App API pool.
- `flaky-test-collector` Flaky-test collector.
- `shared-test-harness` Shared test harness.

## How to get to it (user POV)

GitHub Actions: CI Tests, on production pull requests and pushes.
Workflow: `.github/workflows/ci-tests.yml`.
This is infrastructure; application screens do not change.

## Driving it with agent-browser

No browser. Read hosted runs with `gh`. The unit fixtures in `tests/` prove the
logic; only a hosted run proves scheduling.

1. `RID=$(gh run list --workflow=ci-tests.yml --branch production --limit 1
   --json databaseId --jq '.[0].databaseId')` picks the newest production push.
   A PR run carries 4 `test-shard` jobs (3 pool + 1 serial); a push carries 8
   (6 + 2). Read the count, never assume 2.
2. `gh api repos/hypertask-ai/hypertask/actions/runs/$RID/jobs --paginate --jq
   '.jobs[]|"\(.name)\t\(.conclusion)\t\(.started_at)"'` shows
   `ci-prepare`, `ci-checks`, the `test-shard` matrix, `ci-fixtures` and the
   `ci-tests` gate. All shards start after `ci-prepare` finishes, in parallel.
3. `gh run view $RID --json jobs --jq '.jobs[]|select(.name=="ci-checks")|.steps[]|.name+" "+.conclusion'`
   shows one `Run independent static checks` step (success) and no separate
   `Typecheck`, `Lint (oxlint)` or `scope guard` step.
4. Read the `ci-tests` job's log: the `Prove every test file ran once` step runs
   `node .github/scripts/shard-tests.mjs --prove` and prints
   `shard-proof files=<N> sizes=… union=full duplicates=0`; the gate publishes
   `ci-tests` only after that.
5. On a docs-only PR, `ci-prepare` succeeds and `ci-checks`, the test matrix and
   `ci-fixtures` skip explicitly.
6. For timing, download `-n test-durations` from a production push run; it holds
   one folder per shard, each with its own `test-durations.json`. PR runs do not
   upload it.

Never change required statuses to manufacture negative controls.
Execute the workflow's inline summary gate with isolated inputs locally; there
is no standalone summary shell file.

## Gotchas

- Test shards accidentally depend on static checks.
- Static failure or cancellation escapes the summary.
- A cache hit skips installation, not checks.
- Pull requests publish untrusted cache contents.
- A shard omits or repeats a planned test file.
- Queue or cache differences masquerade as speedups.
- Docs written against an older layout cite "both shards" and a `Typecheck`
  step that do not exist; the matrix is 4 shards on a PR and 8 on a push, and
  `Run independent static checks` is a single step.

### What proof to collect

Save workflow run URLs, head SHAs and job/step timestamps.
Record the `Run independent static checks` step and every `test-shard` job (4 on
a PR, 8 on a push).
Record the summary's exact-file execution proof (`shard-proof files=<N> …
duplicates=0`).
Compare preparation and shard-start timings against historical runs.
Separate avoided serial work from overall CI wall time.
`tests/ci-parallel-checks.test.cjs` executes the real summary shell across producer outcomes.
`tests/shard-tests.test.cjs` exercises shard partition and execution proof.
These isolated checks do not prove hosted scheduling.

### CI App API pool

Confirm CI Tests' prepare job asks for no `statuses` permission and its
PR-controlled workflow does not receive the App private key. For the current
head, inspect mint and fallback logs in trusted App Smoke, Feature Flag Gate, and
UX Signoff runs. Record evidence of actual App-authenticated requests without
exposing credentials: a green run, successful mint, or fallback alone does not
prove App-pool use. Inspect published status author integrations and confirm
required writes remain authored by GitHub Actions. After merge, repeat against
live trusted workflows. Save run URLs, head SHAs and evidence.

### Flaky-test collector

Run `node --test tests/detect-flaky-tests.test.cjs` for the collector's real CLI
boundary with isolated GitHub responses. It covers old jobs, both failed shards,
mixed infrastructure/test failures, same-code comparisons and log-cache isolation.

For live history, use `scripts/detect-flaky-tests.mjs` with the runner App token.
Save the selected run IDs, their creation window, job attempts and generated report.
For a fixed-size follow-up sample, select the first 50 PR runs after the merge from
the complete paginated history; keep that selection beside the collector cache.
Compare rerun-to-green counts against the original 29/53 baseline, keeping workflow
retries separate from named test flakes. Different sample sizes or windows do not
prove a causal improvement. Never count missing logs as successful verification.

### Cleanup

No app fixtures, feature flags or production settings change.
Keep sanitized job records outside the worktree.

### Shared test harness

For changes to `tests/helpers/loadModule.cjs`, require hosted CI to execute
`tests/test-harness.test.cjs` and every migrated caller, including indirect
callers through other `tests/helpers/` files. Save both shard file lists and logs.
The historical PR 1993 fixture must be rejected by the real ESLint rule,
while the shared import remains allowed. Runtime cases must preserve isolated
stubs, circular imports, repeated JSON identity and per-load mutable state.

Before removing a helper, search its basename across the repository again after
rebasing. The scan must include helper-to-helper imports, not just test files.
Keep the exact final-head CI result and the absence scan in the QA record.
