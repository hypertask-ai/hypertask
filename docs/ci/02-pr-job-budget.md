## PR job budget (YPER4-663)

The public repository uses free `ubuntu-latest`, but the plan has 20 parallel jobs.
Small guards share scanner work and trusted metadata:

- `pr-guards.yml`: Gitleaks + TruffleHog (`secret-scan`) and `next-public-secrets`.
- `pr-guards-trusted.yml`: outside-PR, size and title only. The outside-PR guard shares `.github/scripts/outside-pr-guard.cjs` with manual dry runs; both check out production only, never candidate code. The size guard blocks agent PRs over the hand-written cap.
- Scanner checks are native job conclusions for all PRs, including Dependabot and forks. Their read-only tokens need no trusted status-publication pass.
- The trusted guard publishes one existing required `pr-title` context for outside, size and title results. Before publication, including after quota waits, it rechecks the open PR, production base, head and evaluated title.
- Node guard stays separate: the Vercel secret must never share a runner with candidate scripts. Parity stays read-only and separate because it checks out candidate data; it cannot share the trusted job's write token.
- `feature-flag-gate.yml` evaluates only the changed PR on pull-request events. All-open reconciliation runs every 15 minutes, not on PR events or production pushes. A newer pull request event cancels the older run of that same pull request. The group is `feature-flag-gate-${{ github.event.pull_request.number || github.ref }}` with `cancel-in-progress: true`. A scheduled sweep uses the ref, so it does not cancel a pull request run. HYCI-298 replaces the legacy `feature-flag-gate-production` queue, whose orphaned run no longer responds to cancellation. The replacement no longer uses `queue: max`, because GitHub rejects that next to cancellation (HYCI-182). Gate jobs retain five-minute and ten-minute timeouts. The existing stuck-job sweep cancels flag gate runs that are queued, pending, requested, waiting or in progress for thirty minutes or more, and tries the force-cancel endpoint when GitHub refuses the plain cancel, names each run GitHub still refuses once per chained link and counts those refused runs on every tick line; cancellation publishes no verdict, so scheduled reconciliation must repair the missing status. A future scheduler-level orphan may still require GitHub intervention; job timeouts do not bound time awaiting a runner.
  The gate's `ghApi` retries HTTP 500, 502, 503, and 504 up to twice, after one and two seconds, including status posts. `GH_API_NO_WAIT` still skips rate-limit waits but does not disable these server-error retries. Read-token fallback remains separate and happens first.
- `ux-signoff-gate.yml` runs only as the hourly chain's `workflow_dispatch` sweep of all open PRs (HTPR-9450); a pull request event pays nothing for it. Per pull request the group is the ref, so one dispatch never cancels another.
- Feature-flag reconciliation batches status reads by GraphQL page. Failed batches fall back to per-commit reads. Rate limits skip the pass.
- Push secret scans and manual outside-PR dry runs keep their workflows. Per-PR smoke guards and most workflows cancel superseded runs. CI Tests and the trusted guard publish a required status and cancel a superseded run of the same pull request. `queue: max` is not set, because GitHub rejects it next to cancellation (HYCI-29, HYCI-182). The Dependabot lane cancels a superseded run of the same pull request. A sweep uses its own group key, so it does not cancel a pull request that is filing a ticket, and the shared auto-merge sweeper stays non-cancelling. App Smoke cancels superseded production-cache work; workflow_run validation and reporting use a per-run group, and only validated current-head builds enter the cancellable head-repository/branch group, so old request reruns cannot cancel the current smoke.
- Every pull request workflow cancels a superseded run, including `ci-tests`, `pr-guards-trusted`, `feature-flag-gate`, `ux-signoff-gate`, `codex-review-gate` and `dependabot-lane`. Each group names the pull request and `cancel-in-progress` is true. `.github/scripts/pr-run-concurrency-guard.cjs` fails CI when any of those workflows loses that group or stops cancelling. `queue: max` stays off, because GitHub rejected it beside cancellation and left `ci-tests` missing (HYCI-182). `ci-images.yml` no longer has a `push` trigger on the missing seed branch `yper4-231-ghcr-ci-images`.

Static gates inside `ci-checks` share one job and run as concurrent lanes (HYCI-8):
agent board scope, TypeScript, Oxlint, ESLint, the lint overlap guard, board
registration boundaries, the board-filter/Ctrl+K/source-text contracts, changed
style tokens and paid API cost notes.
None reads another's output, so the job costs its slowest lane instead of their sum.
A lane that fails is named in its own log group and the step fails once every lane
has finished. Keeping them in one job holds the budget below unchanged.

Static normal non-draft app PR budget after HTPR-9450: **12 jobs** per synchronize
and opening event: `ci-tests` 7 (prepare, checks, 4 test lanes, summary), the
verifier and its request shim, `secret-scan`, `pr-guards-trusted` and
`feature-flag-gate`. The historical count was **24 jobs** per synchronize and opening event
(YPER4-721 adds one tiny native scanner summary job; HYCI-42 adds two test lanes;
HYCI-45 adds a second serial lane; HYCI-32 adds the second browser half and its
required summary job; HYCI-57 takes the page tests to four shards). The browser
jobs are over the 20-job pool but never wait beside each other:
`browser-smoke` becomes ready only after all four shards finish, so it asks for a
runner slot that has just been freed, and the four page shards simply use the
pool's spare capacity.
Path-specific evals, the
path-specific `visual-compare` check, preview deployments and external review are
extra. Docs-only PRs start 17 jobs; Dependabot/fork PRs no longer add a trusted
scan-publication job. Snapshot actual
head check runs, including reruns but excluding skipped/unstarted runs, with
`scripts/ci-jobs-per-push.sh <pr-number...>` before and after a push. Old check
runs stay attached to their old commit; record both snapshots for comparison.
Snapshot a job's checkout step with `scripts/ci-checkout-times.sh <run-id...>`,
which splits setup, fetch and working-tree time from the run's own log.
CodeQL uses GitHub default setup; path filtering would require advanced setup,
which this change does not introduce.

### PR checks follow pstack (HTPR-9450)

Counted workflow jobs for a ready internal app PR.
Assumptions include four test lanes on a pull request (six pool plus two serial
on a production push) and no reruns.
Fixtures stay off, and one verifier journey runs.
Repository jobs fall from 39 to 31.
Including CodeQL's three analysis jobs, 42 becomes 34.
CI Tests falls from 18 to 12 jobs.
App Smoke falls from four to two jobs.
Skipped jobs and synthetic check contexts are excluded.
Path-specific gates can add jobs on both sides.

PRs keep cheap checks and the independent verifier.
The existing ruleset still requires all ten contexts.
This PR leaves that ruleset unchanged.
An admin must remove requirements before deleting stubs.

Everything that drives the UI left the pull request:

- `browser-build`, `browser-smoke-desktop`, `browser-smoke-mobile`,
  `browser-smoke-matrix` and `browser-smoke-flags` run after production pushes.
  They also run nightly at 03:23 UTC.
  PRs retain a cheap `browser-smoke` summary stub.
- PR `visual-compare` stays dormant behind skipped `browser-build`.
  `visual-regression.yml` owns the nightly screen comparison.
  Production pushes and manual comparisons remain available.
- App Smoke drives production on its own nightly schedule (03:47 UTC). A pull
  request gets a status stub from `app-smoke.yml`.
  That trusted job checks out no candidate code.
  `app-smoke-request.yml` requests that status after each PR.
  Manual dispatch retains the validated smoke path.
- `e2e-ai-pilot.yml` and `desktop-live-readback.yml` run on dispatch and their
  own nightly crons.

The verifier still drives the journeys for the features a pull request touches,
using the diff to choose them, and it boots the candidate with the same
`run-app-smoke-isolated.sh` harness App Smoke uses. A bug fix's repro proof is the
`repro-first` job inside `ci-tests.yml`, which runs the changed test on the merge
base and on the head.

`pstack-verifier` is the only required context in the ruleset.
Cheap checks gate the verifier instead: it waits for `ci-tests`,
`feature-flag-gate`, `pr-title`, `next-public-secrets` and `secret-scan`, and a
red or pending one fails or holds its verdict.
Both smoke contexts stay PR stubs that publish a status.
Each says "moved to nightly (HTPR-9450)".
Neither stub builds or starts a browser.
`app-smoke.yml` publishes the `app-smoke` commit status.
`ci-tests.yml` reports the `browser-smoke` job summary.
Automerge waits for `pstack-verifier` alone.
The verifier's empty-plan pass does not wait on either smoke stub.
It reads no review status: a red or pending `ai-review` or `claude-review`
never fails or holds its verdict, because a bot review is not a verdict.
The hourly monitor fails on any other live required set.
Emergency path unchanged. Revert first, then fix forward.

HYCI-32 spent two of the remaining three job slots on the browser check: the
single 723 s lane became `browser-smoke-desktop` and `browser-smoke-mobile`, which
run in parallel, plus the small `browser-smoke` summary job that keeps the
required context name and fails when either half fails. Both halves build the
candidate themselves, because a shared build job would serialise them behind it
and give back the wall clock the split removes. With HYCI-42's six pool lanes and
HYCI-45's two serial lanes the merged count was 22 jobs per push; one of the extra
two was the summary, which becomes ready only after both halves finish.

HYCI-57 replaced the two browser halves with four page shards, because the page
tests were 427 s spread over two machines while the check only waited for the
slower one. Each shard runs one quarter of the pages on `ubuntu-latest` and
builds its own candidate from the same warm Next.js cache, so the check costs one
build plus the slowest quarter. Four builds cost nothing on this public repo, and
the count is 24 jobs per push: four shards plus the summary.

### What the second pass took off pull requests (HTPR-9450)

A check stays on every pull request only when no journey and no cheap rule covers
it. Two lanes re-ran work another lane already owned, so both are gone:

- `bugfix-regression.yml` replayed the changed tests on the merge base and on the
  head for every `[BUGFIX]` pull request. The `repro-first` job inside
  `ci-tests.yml` already does that replay, and `break-it-review.yml` adds the
  edge-case tests for the same tag, so the report-only replay was a third copy.
  `docs/ci-policy.yml` records `bugfix_regression` as deleted and replaced by
  `repro_first`.
- `quick-check-proof.yml` measured the pre-push hook, and the hook's own tests
  (`tests/quick-check.test.cjs`, `tests/install-git-hooks.test.cjs`) run in the
  `ci-tests` shards, so the lane re-ran a subset of what those shards prove.

The `next-public-secrets` job stays. It is a summary over the scan, and the
verifier still waits on that context, so folding it into `secret-scan` would
leave a docs-only pull request pending a context no job publishes.

A pull request now starts one job fewer from these lanes on a `[BUGFIX]` pull
request, and none fewer on an ordinary one: `quick-check-proof` was path-filtered
already. `break-it-review` stays on `[BUGFIX]` pull requests (3707), not on demand.
