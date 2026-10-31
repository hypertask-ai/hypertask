## CI failure log (HYCI-17)

`CI Failure Log` (`.github/workflows/ci-failure-log.yml`) records one line per
red agent pull-request run of `ci-tests` and groups those lines by cause every
three days. The append job runs on `workflow_run` completion for a non-`success`
pull-request run, reads the failing jobs and their logs, and puts one JSON line
on the `ci-failure-log` branch (`ci-failure-log.jsonl`). It never fixes anything.

The filing job reads that single log, groups lines with the existing
`scripts/ci-failure-census.mjs` parser, labels a cause flaky when the same
commit later passed, and files one `HYCI` ticket per cause with two or more
lines. An existing ticket carries the same `ci-failure-cause:<key>` marker in
its description, so a rerun comments on it instead of filing a duplicate.
Groups of one line are never filed.

`node scripts/ci-failure-log.mjs --seed <days> --publish` backfills the log from
real runs, `--file --from-branch` files the tickets, and `--dry-run` prints what
would be filed. Switching the workflow off undoes the whole feature.

