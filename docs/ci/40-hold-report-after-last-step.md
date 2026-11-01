## Where a part waits after its last step (HYCI-67)

`node scripts/ci-hold-report.mjs` reads the ten newest production pushes and
prints one line per push: the browser check time and the run link, then every
part that was still open more than ten minutes after its own last step, with the
length of that wait. `--limit`, `--branch`, `--workflow`, `--repo` and
`--hold-minutes` narrow or widen it, and it never writes to GitHub.

The check time is the same measure the push list uses: the first page part's
start to the summary job's `browser-smoke` completion. A part's wait is its
`completed_at` minus the later of its own last step and its own start, because a
part cannot finish work before it started: three of those ten pushes carried a
step clock an hour behind the job clock, and reading the raw step time there
would report an hour of waiting that never happened. Push 41286623269 is the
opposite case, with six parts (`browser-smoke-desktop`, `browser-smoke-mobile`,
`browser-smoke-flags`, `test-shard (1)`, `(2)`, `(4)`) closing 60m01s to 60m04s
after their last step, which is the 68 minute push.

