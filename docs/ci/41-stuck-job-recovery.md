## Stuck jobs that hold a check for an hour (HYCI-66)

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

`.github/workflows/stuck-job-recovery.yml` caps the wait instead. Every ten
minutes `.github/scripts/ci-stuck-jobs.cjs` reads the active pull-request runs and
cancels one that has a job with every step completed and no step for eight
minutes, waits for that cancellation to settle, and then re-runs the run's failed
jobs, so a second attempt reports normally on a fresh runner and the push ends
about 28 minutes after it starts instead of 68.0: 11 minutes to finish the work,
8-18 minutes of capped idle (the 8-minute rule on a 10-minute tick), then a rerun
of the same 306-478 s jobs.

The sweep re-runs only a run it cancelled itself: the cancel call is the
provenance, so a run cancelled by a person or by a superseded push is history and
is never restarted. A cancel only counts once it lands, and the re-run can fail
after it, so a run whose cancel did not settle, whose job list was unavailable
after the cancel, or whose re-run request errored is written to the repository
variable `STUCK_RECOVERY_PENDING` and finished by the next sweep: without that
record the run was cancelled for good, because every later sweep reads
in-progress runs only. The entry is written the moment the cancel lands, before
the sweep reads anything else about that run, and each candidate is handled in
its own guard so one rejection cannot strand the rest. Only ids this sweep
cancelled are ever stored, a stored entry is tried at most three times and
expires after six hours, and a stored run that holds a real failure, has no
cancelled job left, or has moved to a newer attempt is dropped instead of
re-run. A run that already waits for its stored recovery is never cancelled
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
cancelled, a job still running a step is left alone, a job quiet for under eight
minutes is not yet stuck, a push run is reported only, a cancelled run recovery
did not cancel is never re-run, a run holding a genuine failure or a failed step is
never touched, `apply()` refuses the rerun when a failure appears during the
cancel,
`apply()` re-runs only the run it cancelled and never a run whose cancel did not
settle or that finished clean before the cancel landed, a second attempt or a
stale run is ignored, and an empty job list never cancels blind. `recover()`
carries an unsettled cancel into the next sweep, never carries a run this sweep
did not cancel, finishes a stored recovery, and drops one that expired, ran out
of tries, holds a real failure, has no cancelled job left or belongs to a
replaced attempt.
