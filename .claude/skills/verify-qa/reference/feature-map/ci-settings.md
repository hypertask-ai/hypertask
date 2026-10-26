# Required-check settings monitoring

## How a customer reaches it

GitHub Actions: Required Check Settings.
Workflow: `.github/workflows/required-check-settings.yml`.
This is infrastructure, without app UI changes.

## How to drive it

1. Confirm the production deployment succeeded.
2. Dispatch Required Check Settings on production.
3. Read its verification-step log.
4. Confirm default branch and ruleset checks passed.
5. Confirm production CI lacks the settings step.
6. Observe the next 48 hours of CI.
7. Inspect every failed run for rate limits.

Never change live settings for negative controls.
Use the verifier's isolated fixtures instead.

## What usually breaks

- A settings mismatch silently passes.
- A dispatch executes unmerged branch code.
- Default-branch drift prevents scheduled monitoring.
- Other workflow reads exhaust GitHub's allowance.
- Runner watches fall back to a user login.

## What proof to collect

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

`node --test tests/ci-review-precheck.test.cjs` executes the CI review
precheck with isolated GitHub responses. Two consecutive rate-limit refusals
must allow tests to start, with one read each. A known failed review must
still stop tests. This does not prove other workflow reads survive quota
exhaustion; required status publication still needs GitHub availability.

## Cleanup

No production settings or board fixtures are changed.
Keep evidence outside the worktree before removal.
