# CI tests and parallel code checks

## How a customer reaches it

GitHub Actions: CI Tests, on production pull requests and pushes.
Workflow: `.github/workflows/ci-tests.yml`.
This is infrastructure; application screens do not change.

## How to drive it

1. Open a normal production pull request.
2. Read the preparation job and shard artifact.
3. Confirm code checks and both shards start independently after preparation.
4. Confirm scope guard, Typecheck and Lint succeed in `ci-checks`.
5. Confirm both test shards execute successfully.
6. Confirm the summary proves every planned file ran once.
7. Confirm the required `ci-tests` result succeeds only after all producers.
8. On a docs-only change, confirm preparation succeeds and both heavy producers skip explicitly.
9. For speed claims, collect ten completed successful hosted runs, including step timestamps.
10. For timing diagnostics, open each production shard’s summary and download `test-durations`. Each shard folder contains its own `test-durations.json`; verify its descending top twenty against the summary.
11. Compare each JSON’s `totalFileDurationMs / concurrency` against that shard’s Test step timestamps. If outside 20%, distinguish serial lanes (`laneAdjustedDurationMs`), worker idle slots and npm startup. Failed assertions can produce partial reports; cancellation can leave reports missing.

Never change required statuses to manufacture negative controls.
Execute the workflow's summary shell with isolated inputs locally.

## What usually breaks

- Test shards accidentally depend on static checks.
- Static failure or cancellation escapes the summary.
- A cache hit skips checks rather than installation.
- Pull requests publish untrusted cache contents.
- A shard omits or repeats a planned test file.
- Queue or cache differences masquerade as speedups.

## What proof to collect

Save workflow run URLs, head SHAs and job/step timestamps.
Record successful scope guard, Typecheck, Lint and both shards.
Record the summary's exact-file execution proof.
Compare preparation and shard-start timings against historical runs.
Separate avoided serial work from overall CI wall time.
`tests/ci-parallel-checks.test.cjs` executes the real summary shell across producer outcomes.
`tests/shard-tests.test.cjs` exercises shard partition and execution proof.
These isolated checks do not prove hosted scheduling.

## Cleanup

No app fixtures, feature flags or production settings change.
Keep sanitized job records outside the worktree.
