## The scheduled watch that starts its own next run (YPER4-984)

The production watch asked GitHub for 336 runs a day and GitHub delivered almost
none of them. In the seven days to 2026-11-02T04:17Z `prod-health.yml`'s two crons
(a 30-minute drift and Pusher check, a 5-minute reachability and core-actions pass)
produced 67 of the 2352 runs they ask for: 2.8%, median gap 130 minutes, worst gap
6.5 hours. `required-check-settings.yml` produced 30 of 168 (17.9%), so the
settings gate was checked a few times a day instead of hourly. A `workflow_dispatch`
is not throttled, so a monitor run now starts the next one itself.

`.github/workflows/production-watch.yml` owns the scheduled monitoring: one link
runs six five-minute passes (reachability, then the core-actions write probe) and
the thirty-minute half (deploy drift, Pusher status) on its first tick, then starts
the next link. `.github/scripts/production-watch.cjs` runs the ticks;
`.github/scripts/schedule-chain.cjs` dispatches the next link, and both monitors
use it. Ticks are due at five-minute deadlines from the link start, never from the
end of the previous check, so a slow check shortens the next wait instead of
stretching the cadence. The pass loop is bounded by `--deadline-minutes`: a check
that no longer fits moves to the next link rather than being handed a shorter
timeout than it needs. The hand-off is its own job that always runs, because a step
cannot outlive the job that hit its timeout and a lost hand-off is the failure this
ticket fixes. The next link is
dispatched on the thirty-minute boundary measured from this run's start, so a fast
link waits and a slow one hands off immediately instead of drifting. The cron in each file is a backstop that only restarts a chain that died:
it stands down while another link is queued or running, so a backstop landing on a
live chain never starts a second one, and a chain that cannot read its own run list
or whose dispatch is refused says so and stops.

Nothing here is a mutation. The deploy verification and the guarded rollback stay
in `prod-health.yml` on push, and a manual dispatch of it still runs the same
monitoring jobs with a pass each. Because a live deploy still serving the previous
commit would read as drift, one job cannot both wait for a deploy and report drift.
The core-actions probe walks a fixture the same `prod-health` run also owns. Two
probes cannot interleave, and that is not left to timing: every caller posts to
`/api/ops/core-actions-smoke`, and the route runs the probe inside
`withCoreSmokeLock` (`src/app/api/ops/core-actions-smoke/route.ts`,
`src/lib/productionSmoke/lock.ts`), a Redis `SET NX` lock keyed by the fixture's own
`projectId:taskId` with a 30-second acquire wait, a 90-second run deadline and a
renewal every minute. The second caller waits, then either runs on a free fixture or
reports an unrunnable probe; it never mutates the rows the first one is using. On top
of that lock, every tick asks whether a `prod-health` run is in flight and skips the
drift check and the probe when one is, because a run can start between two passes
and the wait costs a reported failure nobody should see. That is also why `prod-health.yml`
keeps health and drift in one concurrency group for its own runs, and why the watch
runs the probe as the dedicated health user: with that secret absent the probe
refuses to run rather than walk the fixture as another identity.
Drift and Pusher bodies moved out of the workflow into
`.github/scripts/production-drift.sh` and `.github/scripts/pusher-status.sh` so the
scheduled watch and the push path run the same code.

`required-check-settings.yml` does the same with one link per hour: a `chain` job
starts the next run sixty minutes after this one began. The `required-check-settings`
lock sits on the `verify` job, not on the workflow, so the chain can hold the rest
of the hour without ever blocking a manual dispatch (and a queued manual run can
never be read as a live link and break the chain).

Cost is one of the twenty parallel jobs for each monitor and free hosted minutes
only, because the repository is public. The number this ticket tracks is the share
of asked-for passes that actually run, which the run list of each workflow reports
by event from then on.

## Counting the delivery (HYCI-79)

`scripts/watch-delivery.mjs` reads the run history and answers the one question the
fix leaves open: does each watch still deliver the passes it asks for.

```bash
node scripts/watch-delivery.mjs --days 7            # measured window
node scripts/watch-delivery.mjs --days 7 --baseline # plus the window before it
node scripts/watch-delivery.mjs --only pushes       # the push trigger alone
```

It reads three sources: `production-watch.yml` (asked: 48 links a day, six five-minute
passes inside each link), `required-check-settings.yml` (24 runs a day)
and the legacy `prod-health.yml` cron schedules (336 runs a day) so the before and the
after of the fix sit in one table. The push half counts `prod-health.yml` push runs
against the commits that landed on `origin/production`.

A watch passes when it delivered at least nine runs in ten of what it asked for over
seven days of its own record: a watch that started four hours ago shows its coverage
instead of a rate it has not earned yet. It reads only, dispatches nothing, and never
edits a ticket. GitHub charges a minute or more for a second page of a busy endpoint,
so the window is sliced into days and read one page per slice: a day that delivers
more than 100 runs of one workflow is counted as 100, which reads low, never high.
