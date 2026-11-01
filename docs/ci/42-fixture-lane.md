## Fixture runs beside the shards (HYCI-78)

The cold-board fixture stress and the palette handoff prove that four fixture
files are not flaky. They do not decide which tests run, but they used to sit in
`ci-prepare` ahead of "Select tests for changed files", so every other lane
waited for them to finish before it could start.

Both now run in `ci-fixtures`, a lane that starts beside `ci-checks` and
`ci-test` and is still one of `ci-tests`' own dependencies: a fixture run that
fails, is cancelled, or never reports back makes the required check red. Only a
push that touched one of the four files starts the job at all, and it keeps the
twenty-job pool unchanged on every other push.

Measured on 35 pull-request pushes on 2026-11-01: `ci-prepare` is a 55-second
median, the stress step ran on 8 of them, and on those it took 114 to 446
seconds, 2,659 seconds in total, all of it serialised in front of the shards.
The worst push (14.2 minutes) spent 446 seconds in the stress step and 408
seconds in its slowest shard, which now overlap instead of adding up.

`node scripts/ci-check-time.mjs` reports the share of green pushes that finish
inside ten minutes, which is the number this ticket tracks.
