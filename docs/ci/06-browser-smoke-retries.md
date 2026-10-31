## Browser smoke retries (YPER4-696)

`playwright.config.smoke.ts` uses **zero retries** when `BROWSER_SMOKE_PR` is set.
The disposable builds in `browser-smoke-desktop` and `browser-smoke-mobile` set
this mode on both PR runs and production pushes, so all their projects expose the
first failure. Inbox already
has zero retries. We choose zero rather than retaining retry-passes: a required
PR check should not hide an intermittent failure behind a green second attempt.
The existing list reporter names failed tests in the Actions job log.

Post-deploy `prod-health.yml` sets `SMOKE_POSTDEPLOY=1`, not `BROWSER_SMOKE_PR`,
and still runs Desktop and Mobile with **one retry**. Its rollback policy needs
confirmation of the same failure; this change does not alter that policy.

### First 20 PR runs: release-owner follow-up

This report cannot be completed in the pre-merge PR. After merge, the release
owner records the adoption time and collects the first 20 PR CI Tests runs in
creation order, not the latest 20 green runs. For example, save the run manifest
with the UTC merge time in `ADOPTED_AT`:

```bash
gh api --paginate --slurp "repos/hypertask-ai/hypertask/actions/workflows/ci-tests.yml/runs?event=pull_request&created=%3E%3D${ADOPTED_AT}&per_page=100" \
  | jq '[.[].workflow_runs[]] | sort_by(.created_at, .id) | .[:20]' > first-20-pr-runs.json
```

For each run, retain its URL, head SHA, run attempt, the conclusion of both
browser halves and the `browser-smoke` summary, and named test failures from
`gh run view <run-id> --repo hypertask-ai/hypertask --job <browser-half-job-id>
--log`. Confirm the run's checked-out config has the
new policy; mark older-base runs separately. Preserve cancelled, skipped,
setup-failed and unavailable-log entries as incomplete evidence, not passes.
Record original attempts before reruns overwrite the default view (use
`--attempt <n>`), and identify any failed test that recovers on the same SHA as a
suspected flake, not a proven fix. Publish the table and named suspected flakes
on the ticket, including an explicit empty list if none were observed. With
retries disabled there can be no within-run retry-passes; that alone does not
prove tests are flake-free. If fewer than 20 runs exist, report the observed
count and keep collection open. Ticket:
https://app.hypertask.ai/detail/project-4060/696.
