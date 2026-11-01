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
minutes `.github/scripts/ci-stuck-jobs.cjs` reads the active runs and cancels a
**pull-request** run that has a job with every step completed and no step for
eight minutes. The next tick sees the cancelled run and re-runs only the jobs cut
off after their steps succeeded, so a second attempt reports normally on a fresh
runner and the push ends about 28 minutes after it starts instead of 68.0: 11
minutes to finish the work, 8-18 minutes of capped idle (the 8-minute rule on a
10-minute tick), then a rerun of the same 306-478 s jobs. Only runs touched in
the last thirty minutes and only first attempts
are acted on, so old cancelled runs stay history. A production push run is listed
in the job summary and never cancelled, because it verifies a deploy.

The decision is the pure function `decide()`, with one case per rule in
`tests/ci-stuck-jobs.test.cjs`: a finished job on a pull-request run is
cancelled, a job still running a step is left alone, a job quiet for under eight
minutes is not yet stuck, a push run is reported only, a cancelled run re-runs
only its cut-off jobs, and a second attempt or a stale run is ignored.
