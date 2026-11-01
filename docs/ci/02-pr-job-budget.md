## PR job budget (YPER4-663)

The public repository uses free `ubuntu-latest`, but the plan has 20 parallel jobs.
Small guards share scanner work and trusted metadata:

- `pr-guards.yml`: Gitleaks + TruffleHog (`secret-scan`) and `next-public-secrets`.
- `pr-guards-trusted.yml`: outside-PR, size and title only. The outside-PR guard shares `.github/scripts/outside-pr-guard.cjs` with manual dry runs; both check out production only, never candidate code. The size guard blocks agent PRs over the hand-written cap.
- Scanner checks are native job conclusions for all PRs, including Dependabot and forks. Their read-only tokens need no trusted status-publication pass.
- The trusted guard publishes one existing required `pr-title` context for outside, size and title results. Before publication, including after quota waits, it rechecks the open PR, production base, head and evaluated title.
- Node guard stays separate: the Vercel secret must never share a runner with candidate scripts. Parity stays read-only and separate because it checks out candidate data; it cannot share the trusted job's write token.
- `feature-flag-gate.yml` evaluates only the changed PR on pull-request events. All-open reconciliation runs every 15 minutes, not on PR events or production pushes. PR runs and fleet sweeps share the non-cancelling `feature-flag-gate-production` group, so an old sweep cannot overwrite a newer PR verdict. The shared group uses `queue: max`, preserving up to 100 pending runs instead of replacing the previous pending PR event. GitHub cancels new arrivals beyond that documented limit; scheduled sweeps recover missed events. See [GitHub concurrency syntax](https://docs.github.com/en/actions/reference/workflow-syntax-for-github-actions#concurrency). The single-PR path still lists open heads to reject shared commits, but never reads or posts unrelated verdicts. Policy changes and closed/shared-head recovery reach other PRs at the next scheduled sweep; GitHub scheduling can delay that sweep. `ux-signoff-gate.yml` retains all PR, scheduled and manual reconciliation under the global non-cancelling `ux-signoff-gate` group, which also uses `queue: max`, so a burst of PR events no longer cancels the waiting run (before this, 109 of 400 runs were cancelled). Its hourly schedule is a backstop only: GitHub ran it about every four hours at `*/10`, and the hourly `required-check-settings.yml` shows the same four to six hour gaps, so no cron line shortens the wait. Reactions are reread on each PR event. Their original semantic statuses and flag fingerprints are unchanged.
- Feature-flag reconciliation batches status reads by GraphQL page. Failed batches fall back to per-commit reads. Rate limits skip the pass.
- Push secret scans and manual outside-PR dry runs keep their workflows. Per-PR test and smoke guards cancel superseded runs, but the trusted guard no longer cancels: it publishes a required status, so it serializes per pull request with `queue: max` (HYCI-29). Dependabot major-ticket side effects and the shared auto-merge sweeper stay non-cancelling. App Smoke cancels superseded production-cache work; workflow_run validation and reporting use a per-run group, and only validated current-head builds enter the cancellable head-repository/branch group, so old request reruns cannot cancel the current smoke.

Static gates inside `ci-checks` share one job and run as concurrent lanes (HYCI-8):
agent board scope, TypeScript, Oxlint, ESLint, the lint overlap guard, board
registration boundaries, the board-filter/Ctrl+K/source-text contracts, changed
style tokens and paid API cost notes.
None reads another's output, so the job costs its slowest lane instead of their sum.
A lane that fails is named in its own log group and the step fails once every lane
has finished. Keeping them in one job holds the budget below unchanged.

Static normal non-draft app PR budget: **24 jobs** per synchronize and opening event
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

HYCI-32 spent two of the remaining three job slots on the browser check: the
single 723 s lane became `browser-smoke-desktop` and `browser-smoke-mobile`, which
run in parallel, plus the small `browser-smoke` summary job that keeps the
required context name and fails when either half fails. Both halves build the
candidate themselves, because a shared build job would serialise them behind it
and give back the wall clock the split removes. With HYCI-42's six pool lanes and
HYCI-45's two serial lanes the merged count is 22 jobs per push; one of the extra
two is the summary, which becomes ready only after both halves finish.

HYCI-57 replaced the two browser halves with four page shards, because the page
tests were 427 s spread over two machines while the check only waited for the
slower one. Each shard runs one quarter of the pages on `ubuntu-latest` and
builds its own candidate from the same warm Next.js cache, so the check costs one
build plus the slowest quarter. Four builds cost nothing on this public repo.
