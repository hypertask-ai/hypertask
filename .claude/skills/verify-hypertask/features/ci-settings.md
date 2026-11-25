# Required-check settings monitoring

## Sub-features

- `required-check-settings-monitoring` Required-check settings monitoring.

## How to get to it (user POV)

GitHub Actions: Required Check Settings.
Workflow: `.github/workflows/required-check-settings.yml`.
This is infrastructure, without app UI changes.

## Driving it with agent-browser

No browser. This is a `gh` read of the live settings plus the hourly chain's own
run. Dispatch only when the chain is dead: one dispatch starts a new hourly
chain and a red backstop cron will not start a second one.

1. `gh api repos/hypertask-ai/hypertask --jq .default_branch` prints
   `production`.
2. `gh api repos/hypertask-ai/hypertask/rulesets --jq '.[]|select(.name=="production-required-checks")|{id,enforcement}'`
   shows exactly one `active` ruleset.
3. `gh api repos/hypertask-ai/hypertask/rulesets/<id> --jq
   '[.rules[]|select(.type=="required_status_checks")|.parameters.required_status_checks[]|{context,integration_id}]'`
   prints only `pstack-verifier` / `5264284`.
4. `gh run list --workflow=required-check-settings.yml --limit 4` shows hourly
   `workflow_dispatch` links. Read the newest green one's `verify` job log:
   `Required-check settings: the live ruleset requires pstack-verifier and
   nothing else.` then `Required-check settings verified: default branch,
   production protection, and exact required contexts.`
5. The same run's `chain` job logs
   `the next required-check-settings.yml link is dispatched on production.`
6. `grep -c verify-required-check-settings .github/workflows/ci-tests.yml`
   prints 0, proving production CI carries no settings step.
7. A 48-hour failure census needs every page of
   `/actions/runs?created=><time>`, not the first 100; record the window and the
   exact query when the sample is short.

## Gotchas

- A settings mismatch prints `::error::` and exits 1 (`verify-required-check-settings.mjs`), so it cannot silently pass.
- A dispatch on any ref other than `production` skips the verify job entirely (`required-check-settings.yml:19`), and the job checks out `production` (`:31`), so it never executes unmerged branch code.
- The `chain` job runs on `!cancelled()` (`:64`), so a red verify still restarts the next hourly link; default-branch drift does not stop scheduling.
- The verifier has no fixture mode; its fakes live in `tests/verify-required-check-settings.test.cjs`, not in the script.
- Other workflow reads exhaust GitHub's allowance.
- Runner watches fall back to a user login.

### What proof to collect

Save the merge SHA and successful deployment.
Save the dispatched monitor's run and verification log.
Save the production CI step inventory.
Record the observed 48-hour window and complete census.
Missing logs or unfinished runs mean incomplete evidence.
Record watch requests, elapsed time, and identity separately.
Short samples are not fleet-wide hourly measurements.

### Automated evidence

`node --test tests/verify-required-check-settings.test.cjs tests/app-smoke-workflow.test.cjs` exercises the real verifier and workflow wiring.
It covers scheduled verification and rejected settings drift.
It does not prove production scheduling or quota recovery.

The old `tests/ci-review-precheck.test.cjs` was deleted with HTPR-9450 and no
longer exists. The precheck is gone from `ci-tests.yml`; do not cite it.
`node --test tests/pr-guards-workflow.test.cjs` still exercises the guard
workflow's job names and combined status.

### Cleanup

No production settings or board fixtures are changed.
Keep evidence outside the worktree before removal.

### Guard quota proof

`node tests/guard-quota.test.cjs` exercises the trusted workflow scripts,
including metadata reuse, one combined status and reset-aware retries.
`node tests/pr-guards-workflow.test.cjs` checks native scanner job names and
executes the public-secret summary with success, failure and missing results.
No required check is removed. Capture a real guard run after deployment;
confirm both native scanner jobs and the combined trusted status succeed.
Record live ten-push evidence separately: isolated fixtures are not live proof.
