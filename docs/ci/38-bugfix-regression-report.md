## Bugfix regression report (HYCI-14)

Unit 1 of [HYCI-14](https://app.hypertask.ai/detail/project-11514/14) adds a
report-only job for bug fixes. It signals on the pull request title tag, so
only `HTPR`, `HYFA`, `YPER4` and `HYCI` titles carrying `[BUGFIX]` are evaluated. Set
the `no-regression-test` label and write the reason in the pull request body to
be exempt; a reason inside an HTML comment does not count, because reviewers
cannot see it.

The job replays every changed test in `tests/` twice: on the merge base and on
the pull request head. A test that passes on the head but also passes on the
merge base does not reproduce the bug, and the job names that file in a warning
and in the run summary. A test that fails on the head is named for the same
reason. Tests outside `tests/` (for example `*.test.mjs` beside a ship script)
are reported as unreplayable rather than missing. Dependency, lockfile or Prisma
schema changes make the replay unproven: the base would run with the fixed
dependencies.

`bugfix-regression` is not a required check, never blocks a merge, and changes
no release permission. Its workflow states this in
[`tests/bugfix-regression-check.test.cjs`](../tests/bugfix-regression-check.test.cjs).
The job also runs `.github/scripts/bugfix-regression-check.mjs --backtest <n>`
by hand to summarise how recent merged bugfix pull requests would have fared.
