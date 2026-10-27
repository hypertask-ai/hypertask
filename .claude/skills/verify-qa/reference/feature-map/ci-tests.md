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
9. For timing changes, collect ten completed successful hosted runs, including step timestamps.

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

## Informational bugfix regression replay

`Bugfix regression report` runs on non-draft `[BUGFIX]` production PRs.
Inspect its summary for each changed test: base fails, head passes.
A missing test or a base pass must be flagged by name.
The `no-regression-test` label requires a visible written reason.
Base loader failures and differing Prisma schemas remain unproven.
Keep report-only setup failures separate from successful reproduction.
Run `node --test tests/bugfix-regression-check.test.cjs` for isolated controls.
For historical replay, pass exact `--head` and `--base` SHAs to
`.github/scripts/bugfix-regression-check.mjs`; record both outcomes.
Confirm the existing required check set is unchanged before release.
No application fixtures or customer accounts are needed.
