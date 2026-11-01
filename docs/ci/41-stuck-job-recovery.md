## Stuck jobs that hold a check for an hour (HYCI-66, HYCI-71, HYCI-73)

On 2026-11-01 one production push took 68.0 minutes for 8.0 minutes of work.
Nine jobs of run [41286623269](https://github.com/hypertask-ai/hypertask/actions/runs/41286623269)
had finished every step by 08:05Z, and GitHub recorded their `completed_at`
3601-3604 s later; the six of them that ran real steps spent 306-478 s working,
while every other job in the same run closed one to three seconds
after its last step. The runner log ends normally at the last step, so the work
was done and only the completion report was missing: the runner was gone and the
service held the job until its lease expired. The same window hit every job that
finished between 08:00 and 08:05Z and nothing before or after it, so no workflow
of ours caused or can prevent it.

`.github/workflows/stuck-job-recovery.yml` caps the wait instead.
`.github/scripts/ci-stuck-jobs.cjs` reads the active pull-request runs and cancels
one that has a job with every step completed and no step for forty-five seconds,
waits for that cancellation to settle, and then re-runs the run's failed jobs, so
a second attempt reports normally on a fresh runner and the push ends about 13
minutes after it starts instead of 68.0: 11 minutes to finish the work, under two
minutes of capped idle, then a rerun of the same 306-478 s jobs.

The tick is the part HYCI-71 fixed. A cron is not a tick on a repository this
busy: in the 87 hours from 2026-10-29T00:00Z GitHub delivered 17 of the 349
scheduled runs `feature-flag-gate` asks for on a 15-minute cron, 16 of 87 for the
hourly `ux-signoff-gate`, and 33 of about 1049 for `prod-health`'s five-minute
crons, so the ten-minute sweep HYCI-66 shipped was a sweep every few hours and its
eight-minute rule almost never fired: a job whose last step is older than the
thirty-minute read window is not even read. Each sweep therefore waits and
dispatches the next one itself with `workflow_dispatch`, which is not throttled,
and the cron plus a manual dispatch only restart a chain that died. The
dispatch is skipped while another link of the workflow is queued or running, so a
backstop landing on a live chain never starts a second one, and a scheduled or
pushed run stands down when a link is already in flight instead of sweeping twice.
One link is always either sweeping or waiting, which costs one of the twenty
parallel jobs and only free hosted minutes, because the repository is public. A
chain that cannot read its own run list, or whose dispatch is refused, says so and
stops; the next scheduled run restarts it.

HYCI-73 is the rest of the target. The rule and the tick add up: a three-minute
rule on a chain link that started eight seconds of setup and then waited three
minutes meant 184-411 s of idle on the nine real stuck jobs of run 41286623269,
and the ticket asked for two minutes. Both terms are now short. The rule is
forty-five seconds, one link sweeps every thirty seconds for eight ticks and only
then hands the tick to the next link, and discovery reads only in-progress runs,
so a sweep is one run-list request instead of five. A tick therefore costs a
thirty-second gap and about fifteen seconds of API work, runner startup is paid
once per eight ticks instead of once per tick, and a stuck job pays 45 s of rule
plus at most one 45-second tick plus a cancel that settles in a few seconds: 94 s
typically and 110 s at the worst settle on the same nine jobs, against 396 s
before, which is under the two-minute target and about a third of what the push
paid. A tick that throws is reported and the loop keeps ticking, because one bad
sweep is forty-five seconds and not a dead chain.

Forty-five seconds is safe because a job is only ever judged once every one of its
steps has completed: a healthy job in progress has an unfinished step, so it is
never touched whatever the rule. On the 216 real finished jobs of the thirty most
recent pull-request runs, `completed_at` came 0-4 s after the last step, median
2 s, so nothing healthy is ever quiet that long. A job whose post-step work is not
a step of its own, such as a cache save, is the one shape a tight rule can catch;
the same sweep re-runs it on a fresh runner and the undo is one revert.

The sweep re-runs only a run it cancelled itself: the cancel call is the
provenance, so a run cancelled by a person or by a superseded push is history and
is never restarted. A cancel only counts once it lands, and the re-run can fail
after it, so a run whose cancel did not settle, whose job list was unavailable
after the cancel, or whose re-run request errored is written to the repository
variable `STUCK_RECOVERY_PENDING` and finished by the next sweep: without that
record the run was cancelled for good, because every later sweep reads
in-progress runs only. The entry is written **before** the cancel is issued, so a
sweep that dies between the two leaves a recorded recovery and never a cancelled
run with no record; a reservation the store refuses is a cancel that does not
happen, and a cancellation that never lands drops its own reservation so the next
sweep may pick the run again. Room in the store is reserved the same way: a
stored recovery is never truncated or dropped to make space, so a full store
refuses the new cancel and keeps the twenty it already holds. Only ids this sweep
cancelled are ever stored, a stored entry is tried at most three times and
expires after six hours, and a stored run that holds a real failure, has no
cancelled job left, or has moved to a newer attempt is dropped instead of
re-run. An entry has three states: reserved (written, no cancel sent), issued (the cancel
was sent and its answer is unknown) and confirmed (GitHub accepted it). A
reservation nobody issued is dropped and never re-run, so a cancellation by a
person or by a superseded push is never restarted because a sweep died between
writing and cancelling; a cancel whose answer was lost (a network error, a
timeout, a 5xx, 408 or 429) keeps its issued entry, while only a 4xx refusal is
treated as nothing cancelled. Only a cancel GitHub accepted is ever re-run
automatically: an entry whose answer never came back is reported in the job
summary with its run link and left for a person, because the run may equally have
been cancelled by somebody else, and it leaves the store at the attempt or age
limit like any other. The store is a
repository variable, which is its own permission, so it is read and written with
the token `prod-health.yml` already uses for those two endpoints rather than
`github.token`; run control keeps `github.token`, which is the only one with
`actions: write`. Discovery cannot delay what discovery started
elsewhere either: a sweep reads the store, finishes every stored recovery, and
only then reads the run list, so a slow or failing run list cannot time out a
cancelled check; a run list that fails is reported and cancels nothing new, and a
single unreadable job list skips that one run for the sweep instead of ending it. A run that already waits for its stored recovery is never cancelled
again in the same sweep, and a decision is re-checked against the run's current
attempt immediately before the cancel. Only a confirmed missing variable is read
as an empty store: any other read failure leaves the stored recoveries untouched
and is reported, because a save from an unknown state would erase them, and no
run is cancelled in that sweep, because a cancel that cannot be stored is a
cancel nobody can finish. A stored entry whose own request fails is kept for the
sweep after instead of stopping the rest. A run that holds a real `failure`, `timed_out` or
`startup_failure` job is left alone entirely, and so is a job whose steps include
a completed `failure`: a job in progress reports no conclusion of its own, so a
red test step is only visible on the step until the completion report arrives.
No genuine red check is retried and the zero-retry policy holds. The same guard
runs again on the refreshed job list after the cancel settles, so a job that
fails while the sweep waits stops the rerun instead of being retried. Only runs touched in the last thirty minutes and
only first attempts are read, and their job list is fetched after that filter, so
an old or second-attempt run costs no request. A production push run is listed in
the job summary and never cancelled, because it verifies a deploy.

The decision is the pure function `decide()`, with one case per rule in
`tests/ci-stuck-jobs.test.cjs`: a finished job on a pull-request run is
cancelled, a job still running a step is left alone, a job quiet for under three
seconds is not yet stuck and one quiet for forty-five is, `tick()` sweeps its
eight ticks and waits the gap between them and keeps ticking when one throws,
`handOff()` dispatches the next link and never starts a second chain while one is
queued or running, the run list is read with `status=in_progress`, the worst stuck
idle computed from the shipped constants is under the two-minute budget, and the
nine real stuck jobs come out under it, together with `sweepInFlight()` never
counting the sweep's own run, and a chain that
cannot read its run list or whose dispatch is refused reports that it stopped, a push run is reported only, a cancelled run recovery
did not cancel is never re-run, a run holding a genuine failure or a failed step is
never touched, `apply()` refuses the rerun when a failure appears during the
cancel,
`apply()` re-runs only the run it cancelled and never a run whose cancel did not
settle or that finished clean before the cancel landed, a second attempt or a
stale run is ignored, and an empty job list never cancels blind. `recover()`
carries an unsettled cancel into the next sweep, never carries a run this sweep
did not cancel, finishes a stored recovery, and drops one that expired, ran out
of tries, holds a real failure, has no cancelled job left or belongs to a
replaced attempt. The cases for the store are the ones the review asked for: a
reservation is stored before the cancel is issued, a reservation the store
refuses cancels nothing, a full store refuses a new cancel instead of dropping a
stored recovery, a cancel that never lands drops its reservation, a candidate
whose job list fails does not stop the other candidates, and a run list that
cannot be read still finishes the stored recoveries.
