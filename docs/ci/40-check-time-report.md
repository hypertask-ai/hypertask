## Where check time goes (HTPR-8228)

`node scripts/ci-check-time.mjs --limit 150 --out ci-check-time.html` measures
the last 150 completed check runs of every active app: `hypertask-ai/hypertask`
plus the Software Factory repos `valentinyeo/postbox`,
`valentinyeo/multiprompt` and `valentinyeo/multiprompt-android`. `--repos
owner/name,...` narrows it to chosen apps and `--json` prints the same numbers
for a before/after diff.

Every run is split from GitHub's own timestamps. Waiting is `created_at` to
`run_started_at`. Setup covers checkout, installs and builds; tests covers the
checks themselves; both are summed across every job, so parallel jobs add up to
more than the wall clock. Between-job wait is the run wall clock minus its
longest job. Push to all green counts commits with no failed, timed-out or
action-required run, from the first run created for that commit to the last one
finishing, so skipped runs from path filters never block it. Slow spots rank
workflow and job medians with at least two samples.

The script is read-only: it needs a `gh` token with Actions read access and
never writes to GitHub. Scheduled and dependency runs are measured like any
other, so compare the same window before and after a change.
