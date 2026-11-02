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
use it. The cron in each file is a backstop that only restarts a chain that died:
it stands down while another link is queued or running, so a backstop landing on a
live chain never starts a second one, and a chain that cannot read its own run list
or whose dispatch is refused says so and stops.

Nothing here is a mutation. The deploy verification and the guarded rollback stay
in `prod-health.yml` on push, and a manual dispatch of it still runs the same
monitoring jobs with a pass each. Because a live deploy still serving the previous
commit would read as drift, one job cannot both wait for a deploy and report drift:
the watch skips its drift tick while a `prod-health` run is in flight, which is why
`prod-health.yml` keeps health and drift in one concurrency group for its own runs.
Drift and Pusher bodies moved out of the workflow into
`.github/scripts/production-drift.sh` and `.github/scripts/pusher-status.sh` so the
scheduled watch and the push path run the same code.

`required-check-settings.yml` does the same with one link per hour: a `chain` job
starts the next run sixty minutes after this one began, in its own concurrency
group so the verify job stays dispatchable by hand in between.

Cost is one of the twenty parallel jobs for each monitor and free hosted minutes
only, because the repository is public. The number this ticket tracks is the share
of asked-for passes that actually run, which the run list of each workflow reports
by event from then on.
