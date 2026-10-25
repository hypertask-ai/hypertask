# Production revert proposals

## How a customer reaches it

Maintainers open GitHub Actions, then Production Revert Proposal.

## How to drive it

Dispatch on production with failed run `40201291546`. Manual runs never publish. Automatic failed production CI runs may open a proposal. Owners merge only after required checks pass.

## What usually breaks

A stale production head, flaky test, timeout, rate limit, or changed dependency lock must not authorize a proposal. Replays must not modify runner outputs or production. A retry must recover a pushed branch after PR creation failed.

## What proof to collect

Record the workflow URL, successful fixture tests, historical culprit `73cc4b70870fb411935a3a169779a8fb8b49f168`, and skipped publisher on manual dispatch. Capture production branch identity before and after. Do not introduce a production break merely to test publication.

Automated evidence: `production-revert-pr.yml` runs `tests/production-revert-pr.test.cjs` in its isolated replay lane and replays the historical incident on relevant PRs. The fixtures use real Git commits and a disposable remote; only the GitHub PR transport is faked.

## Cleanup

Manual replay creates no branch or PR. Probe worktrees are removed in `finally`. Keep run logs outside the checkout.
