## Where check time goes (HTPR-8228)

`node scripts/ci-check-time.mjs --limit 150 --out ci-check-time.html` measures
the last 150 completed check runs of every active app: `hypertask-ai/hypertask`
plus the Software Factory repos `valentinyeo/postbox`,
`valentinyeo/multiprompt` and `valentinyeo/multiprompt-android`. `--repos
owner/name,...` narrows it to chosen apps and `--json` prints the same numbers
for a before/after diff. `--markdown` writes a page-ready markdown table
instead of the HTML page.

Every run is split from GitHub's own timestamps. Waiting is `created_at` to
`run_started_at`. Setup covers checkout, installs and builds; tests covers the
checks themselves; both are summed across every job, so parallel jobs add up to
more than the wall clock. Run time outside jobs is wall clock no job was
executing, measured from the union of job intervals. Push to all green counts commits with no failed,
timed-out or action-required run, from the first run created for that commit to
the last one finishing. The report also gives the share of those green pushes
that finished inside ten minutes, which is the target HYCI-78 tracks. Skipped runs from path filters never block it, and the
newest commit, any commit with unfinished or cut-off runs, and any commit whose
full run list cannot be read waits until its checks settle. Runs that never executed stay out of the medians, and a run whose jobs cannot be
read is counted and keeps its commit unranked. Slow spots rank workflow and job medians
with at least two real samples.

The script is read-only: it needs a `gh` token with Actions read access and
never writes to GitHub. Scheduled and dependency runs are measured like any
other, so compare the same window before and after a change.
