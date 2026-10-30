## On-demand pre-PR verification (YPER4-697)

Before a PR exists, push a branch and run:

```bash
scripts/verify-qa <branch> inbox-cycle
# Direct equivalent (helper resolves the pushed branch to an immutable SHA):
token=$(gh-app-token) && test -n "$token" || exit 1
GH_TOKEN="$token" gh workflow run visual-regression.yml -f head=<branch-or-sha> -f journey=inbox-cycle
GH_TOKEN="$token" gh run watch <run-id> --exit-status --interval 300
GH_TOKEN="$token" gh run download <run-id> --dir <evidence-dir>
```

The helper requires a freshly minted Runner App token. Failed or empty token
responses stop dispatch; saved human logins are never a fallback. Refresh the
App token before later status/download commands. Keep one watcher per run and
stop it within 30 minutes.

This reuses the existing Visual Regression dispatch, selecting its independent
`verify-qa` job instead of the two-build visual comparison. Omitting `journey`
(or choosing `visual`) preserves the existing visual workflow. PR visual checks
are unchanged. When testing changes to the workflow itself before merge, use
`scripts/verify-qa <branch> inbox-cycle <workflow-branch>` to load that pushed
workflow version; ordinary app candidates use the production workflow.

One free GitHub-hosted `ubuntu-latest` job installs dependencies, migrates and
seeds loopback PostgreSQL/Redis/Soketi fixtures, builds once, launches the app
and fixture search, checks the authenticated bootstrap identity and inbox, and
runs the existing seeded inbox cycle. The doctor rejects reserved production
identities. It never uses a Vercel preview, live customer data or repository
secrets; checkout does not persist its read-only token. Services disappear with
the runner, and an EXIT trap stops the app/search. AI/search/queue behavior is
fixture-based, not proof of real model quality, ranking or delivery.

Only `inbox-cycle` is supported initially. `inbox-cycle-broken` deliberately
changes the expected reminder title after the doctor passes, proving that a real
browser assertion fails and propagates a failed job. Unknown journeys fail
closed, never silently fall back. Failures do not use report-only mode.

The `verify-qa-<run-id>-<attempt>` artifact is uploaded on success and failure,
with doctor results/screenshot, journey results/screenshots, sanitized build,
server and journey logs, and `run.json`/`summary.md`. Auth state and environment
files are never uploaded. Setup failures report FAIL even if no browser ran.
Retention is 7 days. The summary reports doctor/journey seconds and candidate
SHA; Actions job timings include install, build, upload and queue time.

All on-demand journeys share the non-cancelling `verify-qa` concurrency group:
at most one hosted job runs at a time (of the plan's 20 parallel slots), bounded
at 25 minutes. GitHub may replace an older pending dispatch with a newer one;
do not launch a batch and assume every pending run will execute. Launch, await,
inspect artifacts, then run the next journey. VPS work is dispatch/status calls
and artifact download only. This is optional: no required contexts, rulesets,
PR gates, flags or deployment behavior change.
