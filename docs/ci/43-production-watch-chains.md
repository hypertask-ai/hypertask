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

`ux-signoff-chain.yml` does the same for the hourly UX signoff reconciliation
(YPER4-985): the gate's cron delivered 12 of the 168 runs it asked for in the same
seven days (7%, median gap 266 minutes), so a wireframe question could wait most of
a day for its verdict. The chain cannot be a job inside `ux-signoff-gate.yml`,
because that workflow serialises its whole run in the `ux-signoff-gate` group and a
job waiting out the hour there would put every pull-request reconciliation behind
an idle timer. So the chain is its own workflow with its own group: a link
dispatches the hour's reconciliation when it starts, then starts the next link
sixty minutes after it began. The gate keeps its group, its `queue: max` and its
pull-request triggers, and the hour still goes through that group.

The chain counts only `schedule` and `workflow_dispatch` runs of the gate as
another link (`--chain-events`), because a pull-request run of the gate neither
waits out the hour nor dispatches a successor: reading it as a link would skip the
hour rather than start it. `prod-health.yml` keeps the unfiltered read, where a
deploy push is exactly the run its drift check must not overlap.

Cost is one of the twenty parallel jobs for each monitor and free hosted minutes
only, because the repository is public. The number this ticket tracks is the share
of asked-for passes that actually run, which the run list of each workflow reports
by event from then on.

## Counting the delivery (HYCI-79, HYCI-81)

`scripts/watch-delivery.mjs` reads the run history and answers the one question the
fix leaves open: does each watch still deliver the passes it asks for.

```bash
node scripts/watch-delivery.mjs --days 7            # measured window
node scripts/watch-delivery.mjs --days 7 --baseline # plus the window before it
node scripts/watch-delivery.mjs --only pushes       # the push trigger alone
```

It reads four sources: `production-watch.yml` (asked: 48 links a day, six five-minute
passes inside each link), `required-check-settings.yml` (24 runs a day),
`ux-signoff-chain.yml` (24 links a day, the hourly design check) and the legacy
`prod-health.yml` cron schedules (336 runs a day) so the before and the after of the
fix sit in one table. The push half counts `prod-health.yml` push runs against the
pushes that landed on `origin/production`. A push is one tip on the first-parent
history, because a squash merge lands one commit and a merge push lands its merge
commit, so the extra commits a push carries are never counted as pushes of their own:
counting every commit read a healthy week as 81% of pushes, when each of its 448
pushes had started its run.

The design check is counted on `ux-signoff-chain.yml`, never on `ux-signoff-gate.yml`:
the gate also runs on every pull request, and such a run neither waits out the hour nor
starts a successor, so reading it as a link would skip the hour instead of counting it.
The chain's run list is the only record of the hourly ticks, which is why that is the
one that is read.

A rate alone hides what a person waits through, so each watch also reports the median
and the worst gap between its links. The pre-fix design check delivered 12 links in a
week with a 266-minute median and a 424-minute worst gap: seven runs in a hundred, and
a wireframe question that could sit most of a day for its verdict.

Each day of the window is read to its last page, because the run list returns a
hundred records at a time and a busy day holds more: reading page one only dropped 14
of one week's 448 push runs and turned a full count into 97%. A run is counted once by
its id, because a page boundary that moves between two reads of the same day hands the
same record back twice, and a duplicated link reads as a watch that outran what it asked
for.

A watch passes when it delivered at least nine runs in ten of what it asked for over
seven days of its own record, and its record starts at its first run ever. That run is
read from the last page of the workflow's run list, because the endpoint lists newest
first and ignores `sort` and `direction`: read from page one it hands back the newest
run, which collapses every ask to a handful and turns a broken watch into a healthy
one. A watch older than the window is therefore judged
over all seven days, and a watch younger than the window shows its coverage instead
of a rate it has not earned yet. A run still queued, requested or waiting never
counts as delivered: it is reported on its own and left out of the rate, so a week of
queued records cannot pass. The push half reads `origin/production` of the checkout,
so a `--repo` that does not match this checkout's origin is refused rather than
mixing two histories. It reads only, dispatches nothing, and never edits a ticket.
GitHub charges a minute or more for a second page of a busy endpoint, so the window
is sliced into days and read one page per slice, one slice at a time: a day that
delivers more than 100 runs of one workflow is counted as 100, which reads low, never
high.

`.github/workflows/watch-delivery-report.yml` runs that same command once a day at
06:41 UTC, or by hand, and writes the report into its own run summary. Counting the
fix was a hand job before that: the ticket closes on seven days of real numbers, and
a week nobody measures is a week nobody can claim. The job checks out `production`
with full history because the push half counts commits, then reads with
`actions: read` and `contents: read` only. It is a report, not a gate: a short watch
is a `::warning::` line, because the chained watches only reach seven days of record
a week after they started, and a red run every morning for that week would teach
people to ignore it. A daily cron is one run a day against a schedule GitHub
throttles, so a late link costs hours rather than a day, and the manual dispatch
covers a missed morning.
