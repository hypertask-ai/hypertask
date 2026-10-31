# CI contract

_Last updated: 2026-10-27._

**Hypertask app CI runs on GitHub-hosted `ubuntu-latest` runners (the repository is public, so hosted minutes are free), uses a provider-neutral AI review gate, and deploys production directly from the `production` branch.** The only self-hosted runners on the Contabo host belong to the private reviewer and analytics repositories. This file is the human-readable contract; the machine-readable companion is [`docs/ci-policy.yml`](ci-policy.yml).

Each section below is its own file in `docs/ci/`, one file per topic, so two CI changes never edit
the same lines. This page is built from those files: edit the section file, then run
`node scripts/shared-lists/build.mjs --write`.

## Runner policy enforcement (YPER4-844)

`PR Guards Trusted` folds runner enforcement into required `pr-title`. It installs
only the locked workflow parser and executes production code against fetched PR
Git objects, never candidate code or candidate policy. Unknown visibility,
expressions, remote reusable workflows and nonstandard public runners fail closed.
The first deployment bootstraps enforcement for subsequent PRs; it cannot protect
itself retroactively or prevent an unmerged branch job from starting.

Before runner or cost claims, run from the target repository checkout:
`NODE_PATH=.github/scripts/node-version-guard/node_modules node .github/scripts/ci-runner-policy.cjs --repo owner/name`.
It reads live GitHub visibility, trusted `docs/ci-policy.yml` and committed workflow
files. `--ref <full SHA>` selects candidate Git data; `--policy <file>` selects the
local policy. The requested repository must match checkout origin. Standard
public hosted minutes are free; private hosted minutes can be charged, and
self-hosted infrastructure still costs money. Larger hosted runners are not free.

Private hosted workflows require `runner_policy.private_hosted_approval` pointing
to an unedited GitHub issue comment on that repository from Valentin (immutable
GitHub user ID 3296316). Its entire text must be
`Approve GitHub-hosted runners for owner/name with workflow digest <digest>.`
The refusal prints the digest. Approval stops matching when workflow content or
paths change. No other administrator can approve. Public app runner policy has
no approval override. Results log the workflow digest and approval identity/link;
API errors refuse verification. This command reads credentials through `gh`
without printing them and performs no GitHub writes.

## PR job budget (YPER4-663)

The public repository uses free `ubuntu-latest`, but the plan has 20 parallel jobs.
Small guards share scanner work and trusted metadata:

- `pr-guards.yml`: Gitleaks + TruffleHog (`secret-scan`) and `next-public-secrets`.
- `pr-guards-trusted.yml`: outside-PR, size and title only. The outside-PR guard shares `.github/scripts/outside-pr-guard.cjs` with manual dry runs; both check out production only, never candidate code.
- Scanner checks are native job conclusions for all PRs, including Dependabot and forks. Their read-only tokens need no trusted status-publication pass.
- The trusted guard publishes one existing required `pr-title` context for outside and title results. Size stays advisory. Before publication, including after quota waits, it rechecks the open PR, production base, head and evaluated title.
- Node guard stays separate: the Vercel secret must never share a runner with candidate scripts. Parity stays read-only and separate because it checks out candidate data; it cannot share the trusted job's write token.
- `feature-flag-gate.yml` evaluates only the changed PR on pull-request events. All-open reconciliation runs every 15 minutes, not on PR events or production pushes. PR runs and fleet sweeps share the non-cancelling `feature-flag-gate-production` group, so an old sweep cannot overwrite a newer PR verdict. The shared group uses `queue: max`, preserving up to 100 pending runs instead of replacing the previous pending PR event. GitHub cancels new arrivals beyond that documented limit; scheduled sweeps recover missed events. See [GitHub concurrency syntax](https://docs.github.com/en/actions/reference/workflow-syntax-for-github-actions#concurrency). The single-PR path still lists open heads to reject shared commits, but never reads or posts unrelated verdicts. Policy changes and closed/shared-head recovery reach other PRs at the next scheduled sweep; GitHub scheduling can delay that sweep. `ux-signoff-gate.yml` retains all PR, scheduled and manual reconciliation under the global non-cancelling `ux-signoff-gate` group, which also uses `queue: max`, so a burst of PR events no longer cancels the waiting run (before this, 109 of 400 runs were cancelled). Its hourly schedule is a backstop only: GitHub ran it about every four hours at `*/10`, and the hourly `required-check-settings.yml` shows the same four to six hour gaps, so no cron line shortens the wait. Reactions are reread on each PR event. Their original semantic statuses and flag fingerprints are unchanged.
- Feature-flag reconciliation batches status reads by GraphQL page. Failed batches fall back to per-commit reads. Rate limits skip the pass.
- Push secret scans and manual outside-PR dry runs keep their workflows. Only per-PR guards cancel superseded runs; Dependabot major-ticket side effects and the shared auto-merge sweeper stay non-cancelling. App Smoke cancels superseded production-cache work; workflow_run validation and reporting use a per-run group, and only validated current-head builds enter the cancellable head-repository/branch group, so old request reruns cannot cancel the current smoke.

Static normal non-draft app PR budget: **17 jobs** per synchronize and opening event
(YPER4-721 adds one tiny native scanner summary job). Path-specific evals,
visual checks, preview deployments and external review are extra. Docs-only PRs start 15 jobs; Dependabot/fork PRs no longer add a trusted scan-publication job. Snapshot actual
head check runs, including reruns but excluding skipped/unstarted runs, with
`scripts/ci-jobs-per-push.sh <pr-number...>` before and after a push. Old check
runs stay attached to their old commit; record both snapshots for comparison.
CodeQL uses GitHub default setup; path filtering would require advanced setup,
which this change does not introduce.

## Review gate

- The private `valentinyeo/hypertask-reviewer` workflow fails over subscription-first between its configured backends (currently the ChatGPT/Codex subscription and the Claude Code subscription); the reviewer repository owns the provider order, models, and failover details, so they are not duplicated here.
- The required review gate is GitHub AI Review (`ai-review`); the former `claude-review` context is accepted during the transition so queued PRs retain their gate. Every review comment identifies the backend that produced its verdict.
- The private repository publishes that gate as a commit status because cross-repository user tokens cannot create GitHub Check Runs. Branch protection and auto-merge consume the GitHub AI Review (`ai-review`) context (or the legacy `claude-review` context during the transition).
- After publishing a final status, the private workflow dispatches the application repository's auto-merge evaluator for that PR. It does this for approvals, concerns, and infrastructure failures, so completion cannot be missed when CI happened to finish first.
- A five-minute application auto-merge sweep is the final availability fallback. It re-evaluates green PRs even if GitHub loses the cross-repository completion dispatch.
- A root-installed systemd timer polls every 30 seconds as the isolated `reviewdispatch` account. It validates each open PR, exact head SHA, same-repository source, and `production` target before dispatching to the private reviewer repository. The private workflow checks out only the trusted `production` copy of `.github/scripts/ai-review.mjs`; it reads PR code as data and never checks it out or executes it.
- The dispatcher records terminal GitHub AI Review (`ai-review` or legacy `claude-review`) results by commit SHA under `/var/lib/hypertask-ai-review/completed`. Each scan uses one GitHub API request to list open PRs, then rechecks only heads without a terminal marker. Keep this cache in place. With 24 or more open PRs, repeated checks of completed heads consumed the 5,000-request hourly quota and made the CI monitor report an unknown topology (HTPR-5548).
- Generated dependency lockfiles are represented by file metadata instead of their full machine-generated contents. The reviewer inspects the package manifest and CI result without spending tens of thousands of tokens on a lockfile.
- Every backend must return the same strict JSON-schema verdict. Quota, authentication, missing CLI, timeout, empty, or malformed responses advance to the next backend. A valid `APPROVE` or `CONCERNS` verdict stops the chain. If every backend fails, the required check fails closed.
- Transient provider failures retry within the reviewer workflow's own failover policy; the reviewer repository owns those retry counts.
- Existing queued PRs are discovered automatically by the local poller. The broker sends a `repository_dispatch` event, so GitHub always runs the credential-bearing workflow from the private repository's default branch. A trusted infrastructure retry uses the same event and exact PR head SHA; branch-selectable `workflow_dispatch` is forbidden.
- Dispatch markers are reconciled against both the current GitHub AI Review (`ai-review` or legacy `claude-review`) status and the named private workflow run. Queued or running reviews remain protected for their full duration; the 30-second poller makes a cancelled, failed-before-status, or vanished run retryable after a five-minute GitHub propagation grace.
- Automatic dispatch is capped at two attempts per head: the initial run and one recovery. Further infrastructure-only retries must use a trusted `repository_dispatch` request for the exact PR head, preventing an unhealthy provider from consuming quota indefinitely without making a credential-bearing workflow branch-selectable.
- DeepSeek-produced PRs keep the `hold` label. The automated verdict is evidence, but a trusted release session must still remove the hold before merge.
- Subscription credentials belong only to the isolated `aireviewer` OS account. Only the private repository's `htreviewrunner` identity may invoke the root-owned wrappers. The broker runs only as `reviewdispatch`; the general `ghrunner` identity used by application jobs can invoke neither boundary.
- The broker's cross-repository credential is supplied through a `reviewdispatch`-only curl config file, never a command argument or application workflow environment.
- The safe manual retry command below sends `repository_dispatch` with a numeric PR and exact 40-character head SHA. The private workflow and reviewer validate both before using credentials.

### Trusted manual review retry

Use this only for an infrastructure failure, not to rerun a valid negative verdict. Confirm the PR is open, targets `production`, comes from this repository, and still has the exact head SHA. This payload follows `.github/scripts/subscription-review/dispatch-review` and runs the private repository's default-branch workflow, never a PR-selected ref.

```bash
PR=1234
HEAD_SHA=$(gh pr view "$PR" --repo hypertask-ai/hypertask --json headRefOid --jq .headRefOid)
[[ "$PR" =~ ^[1-9][0-9]*$ && "$HEAD_SHA" =~ ^[0-9a-f]{40}$ ]] || exit 1
jq -n --arg pr "$PR" --arg sha "$HEAD_SHA" \
  '{event_type:"review_pr",client_payload:{pr:$pr,head_sha:$sha}}' \
  | gh api --method POST repos/hypertask-ai/reviewer/dispatches --input -
```

Use a trusted identity with dispatch access to the private reviewer repository. The private workflow and reviewer revalidate the PR and head before using credentials.

## Release contract

- App CI (CI Tests, App Smoke, Secret Guard, Gitleaks, Revert Guard, PR checks, Auto-merge, Production Health) runs on GitHub-hosted `ubuntu-latest` runners; review discovery is a local 30-second systemd timer and occupies no Actions runner. AI review runs from the private reviewer repository on that repo's own `[self-hosted, ai-review]` runner.
- CI Tests uses the committed `package-lock.json` with `npm ci --prefer-offline` and GitHub-hosted caches. ESLint still covers the full repository, but unchanged file results are restored through its content-validated cache; a cache miss performs a complete lint. The workflow relocates ESLint's absolute cache paths when GitHub schedules a run on a different hosted runner. PRs consume the trusted base-branch cache read-only. Every new `production` commit runs the full suite, and a failure warns without changing the live site. Only the current Production Health probe can trigger a rollback.
- TypeScript and the selected PR tests (full suite on production pushes) remain correctness checks on every non-docs CI Tests run. The Test step is `CI_TEST_SHARDS` jobs (3) that split that same file list by measured run time (see the shard balance note below). A fourth shard is the next lever if this one stops meeting the 12-minute target. One aggregate job is still named `ci-tests`, and it is green only after every shard succeeds and the uploaded file lists union to the full set with no duplicate. Dependency installation and test selection stay in `ci-prepare`. `ci-checks` restores dependencies and runs the board-scope guard, typecheck and lint beside the two test shards, not before them. The required `ci-tests` aggregate waits for successful preparation, static checks, both shards and the exact-file execution proof. Docs-only runs require both heavy jobs to be skipped explicitly. Only production pushes save caches; each job uses its own workspace. The shard count is the workflow env `CI_TEST_SHARDS`.
- Shard balance (YPER4-777): the split is measured, not counted. `config/test-duration-weights.json` holds one work figure per test file, taken from the `test-durations` artifact of finished production runs; a file that runs in a serial lane costs its whole time and a pooled file costs 1/concurrency of it. `partition()` places files heaviest first onto the least-loaded shard, and `--check`/`--prove` recompute that same plan, so the union and no-duplicate proof is unchanged. A file missing from the weights file costs `defaultWorkMs`, and with no weights file at all the split falls back to the old count split. Both shard job logs print `shard-plan … measured=…s,…s`; a balanced plan shows the two shards within a second of each other. Refresh the weights after a test-harness or dependency change: `gh run download <run-id> --repo hypertask-ai/hypertask -n test-durations -D runs/<run-id>` for ten or more finished production runs, then `node scripts/test-duration-weights.mjs --input runs --source "<what these runs are>"`. The generator takes the median across runs so one slow box cannot set the plan, and the file is generated, never hand-edited.
- Production-push CI Tests publishes each shard’s `test-durations.json` in the **test-durations** artifact (14-day retention) and lists each shard’s slowest 20 files in its job summary, including ordinary test failures. Cancellation or abrupt termination may leave incomplete or missing timing evidence. Whole-file process wall times include startup and teardown, not summed nested-test time; serial TypeScript invocations are timed around `tsx`. The JSON and summary compare summed file time / worker concurrency with elapsed runner time and also account for the existing serial lanes. Compare with the **Test full suite** step timestamps for end-to-end timing; npm/heavy-job startup lies outside the runner measurement.
- PR and production-push CI Tests runs do not collect or publish V8 coverage. The separate non-required [`Coverage Nightly`](../.github/workflows/coverage-nightly.yml) workflow runs the full suite with coverage at **02:17 UTC daily**, or via `workflow_dispatch` on `production` only. It checks out the event's exact production SHA and reports as `coverage-nightly`, never `ci-tests`, so diagnostics cannot supersede a required correctness result. Its 60-minute timeout gives the covered suite more room than the unchanged 40-minute CI Tests gate.
- Coverage remains report-only (`continue-on-error` on reporting). The nightly job keeps `npm run coverage:report`, the job summary, `automated-test-coverage-<commit>`, the report/critical-domain paths, and 30-day retention. Download coverage from **Coverage Nightly**, not CI Tests. No required check or runtime script consumes the uploaded coverage; `scripts/coverage-summary.mjs` reads the nightly `coverage/report/coverage-summary.json` within that job. See [testing](testing.md#coverage-baseline).
- Dependabot still applies informational `full-ci` and lane labels; neither starts nor changes CI Tests or test selection. The `major-upgrade` label still starts its separate ticket workflow. No job-level label skip is added: normal PR events continue reporting both `ci-tests` and `browser-smoke`, including the existing docs-only scope path. Adding approval text after a failed agent-scope approval guard now requires a new commit to produce a fresh PR event; editing the body alone does not rerun that guard, and rerunning the old event retains its old body.
- CI Tests runs the launch-admission fixtures (`session-policy-guard.test.py`), runner dispatcher Python fixtures (`runner-dispatch.test.py`, `runner-dispatch.cache.test.py` and `runner-snapshot.test.py`) and `runner-selfupdate.test.sh` from `.claude/skills/ship/scripts/` on GitHub-hosted runners, even for `.claude/`-only PRs. These offline fixtures need no installed runner scripts or credentials.
- `contabo-1` is registered only to the private reviewer repository, carries `ai-review`, and runs as `htreviewrunner`. Application PR workflows cannot schedule it, and its subscription wrappers are unreachable from hosted runner jobs.
- The repository default branch is `production`. GitHub loads `workflow_run` files from the default branch, so this setting lets the protected App Smoke workflow react to every App Smoke Request run. Frozen `main` remains the legacy EC2 rollback branch.
- The `production` ruleset requires the exact contexts in `docs/ci-policy.yml`, including `ci-tests` and `browser-smoke`. Both jobs run on every non-draft PR without a label gate. CI Tests still verifies the live ruleset before deciding scope; this optimization adds no required check names. CI Tests reports on every non-draft PR opened, synchronize, reopened, and ready_for_review event; labels (including `full-ci`) and title/body edits do not restart it. App Smoke Request uses the same four events. Title/body-sensitive gates retain their own triggers. The speed checks were retired with the 2026-08 staging rename; no `[SPEED]` gate exists today.
- Gitleaks (`secret-scan`) scans only the commits a change adds: a pull request scans base..head, and a push scans the previous tip..new tip (a new branch, or a force push whose old tip is gone, scans everything not on `production`). A finding on one branch therefore cannot turn other branches red. Branch deletions are not scanned.
- Auto-merge uses the newest result for each check name. This lets a current provider-portable compatibility check supersede an obsolete reviewer failure on the same backlog commit; the exact-commit `APPROVE` comment is still mandatory.
- Auto-merge keeps all scratch state in a unique directory under `RUNNER_TEMP`. A PR read, diff read, or merge that still fails after retries makes the workflow fail visibly; an incomplete sweep must never report green.
- Vercel previews are optional. Merge to `production` deploys production; a failed deploy build keeps the previous deployment live. Non-app-only merges use the ignored build step below.
- Do not add another runner host, VPN, required preview, or paid hosted fallback without a recorded decision.

## Vercel ignored builds

`vercel.json` runs `node scripts/vercel-ignore-build.cjs` before dependency installation.
Exit 0 cancels the build; exit 1 continues it. The comparison uses
`VERCEL_GIT_PREVIOUS_SHA`, the last successful deployment for this project and branch,
and `VERCEL_GIT_COMMIT_SHA`. It never substitutes `HEAD^`, so app changes earlier in
a batch still deploy. Vercel's [turbo-ignore implementation](https://github.com/vercel/turborepo/blob/main/packages/turbo-ignore/src/get-comparison.ts)
uses the same previous-deployment variable.

Only documentation, skills, CI and tests can skip: `docs/`, `.claude/`,
`.agents/skills/`, `skills/`, `.github/`, `tests/`, `e2e/`, and root Markdown files.
Everything else builds, including source Markdown, assets, Prisma, package files,
`vercel.json`, build scripts, packages, types and build configuration. Unknown,
missing, shallow, divergent or empty deployment comparisons build rather than skip.
Renames include the removed path, preventing a source-to-docs move from hiding app changes.

Production health and drift checks use the same command with `--between <live> <tip>`.
This mode accepts identical trees: a live build needs no replacement after an empty
commit. Canceled deployments retain the existing push-health behavior; scheduled
core-action, drift and Pusher checks keep running. The cron definitions are unchanged.
No workflow, preview or required-check gate is disabled.

## Browser smoke retries (YPER4-696)

`playwright.config.smoke.ts` uses **zero retries** when `BROWSER_SMOKE_PR` is set.
The disposable `browser-smoke` build sets this mode on both PR runs and
production pushes, so all its projects expose the first failure. Inbox already
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

For each run, retain its URL, head SHA, run attempt, browser-smoke job conclusion
and named test failures from `gh run view <run-id> --repo hypertask-ai/hypertask
--job <browser-smoke-job-id> --log`. Confirm the run's checked-out config has the
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

## Live required-check settings

The hourly [Required Check Settings workflow](../.github/workflows/required-check-settings.yml)
runs the dependency-free [verifier](../.github/scripts/verify-required-check-settings.mjs)
on free GitHub-hosted runners at minute 17. Manual dispatch is production-only;
checkout always uses `production`. It verifies the default branch, exactly one
active `production-required-checks` ruleset, its branch target and production
include/exclude conditions, and the exact required-context set (including both
review contexts, without aliasing). Drift and unreadable settings still fail
the monitor; this is not a required PR context. Detection can lag until the next
hourly run, plus GitHub scheduling and any rate-limit wait.

CI Tests no longer reads repository settings on PRs or production pushes.
Its optional review precheck reads commit statuses once. Read failures warn
and let tests run; an observed failed review still stops tests. Independent
required review contexts continue to block merging without approval.
Previously every production push and CI-policy PR made three settings API calls.
The hourly monitor makes three on a successful first attempt: repository
metadata, ruleset list, and one full ruleset read. Retries add calls.
GitHub REST's
[repository ruleset list](https://docs.github.com/en/rest/repos/rules#get-all-repository-rulesets)
returns summaries, not rules or ref conditions; `includes_parents` includes parent
rulesets, not full details. The
[branch rules endpoint](https://docs.github.com/en/rest/repos/rules#get-rules-for-a-branch)
returns effective rules but not the name/enforcement/target/ref conditions needed
to preserve these assertions. Neither can replace the full ruleset read safely.

Reads use `gh api --include`. A rate-limited 403 or 429 waits for
`x-ratelimit-reset` / `retry-after` (the later time when both apply), logging
`rate limited, waiting Ns until reset`, then retries only that failed read.
Cumulative sleeps are capped at **3900 seconds**, longer than one full
installation window, with a 4,000-second overall budget and a 70-minute step
timeout inside the 80-minute job. A cap failure names the GitHub API rate limit in the
error and the step summary, so it is not mistaken for a test failure. Missing usable
rate-limit timing, an exceeded budget, other API errors, malformed settings, or a
settings mismatch fail the check; nothing passes without reading the settings
when verification is required. No paid runner, service, or dependency is added.

Runner CI watches use the existing `gh-app-token` helper, never the saved user
login: `token=$(gh-app-token) && test -n "$token" && GH_TOKEN="$token" gh pr checks <PR> --repo hypertask-ai/hypertask --watch --interval 120`.
Stop if minting fails; do not fall back. Refresh the token before
restarting a watch. The 120-second interval replaces gh's 10-second default;
compare observed request counts over equal windows before claiming a fleet-wide
reduction. The installation allowance used by `github.token` in Actions is a
different quota from the runner app; moving runner watches does not replenish it.

## CI App API pool (YPER4-881)

Selected GitHub reads and App Smoke cancellations use the `hypertask-ci` App's
separate installation API pool in trusted production workflows. App Smoke's
trusted validation recheck requests `actions: write` and
`pull-requests: read`. Feature Flag Gate's two evaluation jobs and UX Signoff
request `contents: read`, `pull-requests: read`, and `statuses: read`.

A missing secret, failed mint, or failed App request falls back to `github.token`.
Fallback success is not proof that requests used the separate pool. CI Tests
deliberately keeps its single review precheck on `github.token`, so its
PR-controlled workflow never receives the App private key. Status writes remain
on `github.token` because required status authorship
is pinned to the GitHub Actions integration. This changes no repository
settings, runners, or required checks.

## AI review verdict on the ticket (YPER4-675)

[AI review verdict to ticket](../.github/workflows/ai-review-mirror.yml) copies
the current GitHub AI Review verdict onto the ticket named by the branch, so the
review reaches the people reading the board and not only the pull request. It
runs here, not in the private reviewer repository: this repository already owns
the board token that binds titles and files tickets, while the reviewer's own
copy was rejected ("Unauthorized") and the failure was hidden by
`continue-on-error`.

- Wakes on `created` and `edited` pull request comments, and on a manual
  `workflow_dispatch` with a PR number for a missed round or a backfill.
- Mirrors only a comment written by the reviewer App account that starts with
  `APPROVE` or `CONCERNS`, on a same-repository PR to `production`. That account
  is `hypertask-ai-review[bot]` on a comment event and `hypertask-ai-review` in
  the REST payload, so both spellings match and nothing else does.
- Copies only the verdict whose `reviewed-commit` marker equals the current PR
  head, so a review of an older commit never reaches the ticket as the verdict
  for what will merge.
- The concurrency group carries the comment author and never cancels, so an
  ordinary comment on the same PR cannot cancel the reviewer's delivery.
- Posts one comment with `kind: qa`, because an agent comment without a kind is
  filed in the hidden agent log instead of the ticket thread.
- Skips a commit the ticket already carries and sends an `Idempotency-Key` of
  `ai-review-mirror-<pr>-<sha>`, so a re-run or an edited verdict never doubles
  the comment.
- A rejected read or post fails the run. A silent skip is exactly the failure
  this replaces.
- Both GitHub reads use the same reset-aware retry as the other trusted
  workflows (`retryGithubRequest` in `.github/scripts/github-rate-limit.mjs`).
  The installation shares one hourly budget with the whole fleet, and the live
  failure was a `403` with `x-ratelimit-remaining: 0` resetting 82 seconds
  later (YPER4-925). Waits are capped at 240 seconds and the budget at 420
  seconds, inside the job's 10-minute timeout; a wait past the cap fails the run
  with the GitHub rate limit named, so a lost verdict is never a silent one.
- Reads the PR number, branch name and comment text as data. The only checkout
  is the production default branch's `.github/scripts`, sparse, with
  `persist-credentials: false`, for that retry helper; no candidate code is
  fetched or run, there is no shell step, and the permissions stay
  `contents: read` plus `pull-requests: read`.

## Ticket links from PR titles

The trusted `pr-title` guard links same-repository production PRs to the ticket
in their current GitHub title through the existing MCP task-update API. It uses
`HYPERTASK_MCP_TOKEN`, not a runner-local binding file. The app checks permission,
verifies the GitHub PR and returns the saved link. Missing credentials, rejected
updates or an unconfirmed link fail the guard. Forks, bot titles and generated
revert titles retain their existing handling. Ticketed runner bots also bind.
The production-only manual `pr_number` input executes the same trusted title
entry for live QA and recovery. Delayed runs can link merged PRs.

## Premerge evidence

`premerge-evidence` passes every open `production` PR with the exact description `test click removed (Valentin 2026-10-21)`. No screen-path, flag-removal, live-mode, browser-click, `premerge.md` or recording evaluation remains. Valentin removed the test click on 2026-10-21 because it was not helping.

New flag definitions that break the default-mode rules still block merge through the separate required `feature-flag-gate`, not `premerge-evidence`. Before any UI, title or label exemption, `.github/scripts/feature-flag-gate.mjs` requires explicit `defaultMode: "EVERYONE"` for new definitions unless their kind is `bugfix` or `internal`, or they declare `releaseRisk.highRisk`. Its trusted registry parser rejects internal flags and high-risk flags whose effective default is Everyone, including bugfix flags with an implicit Everyone default. Eligible new flags defaulting to Everyone remain allowed; high-risk flags defaulting to Owner + QA remain allowed. GitHub reads, commit fetches and parsing failures fail closed in that gate.

The publisher still holds its shared lock from validation through the status post, requires a full 40-character head SHA, and re-reads the open PR's production base and head before posting. A closed PR, non-production base, unreadable or incomplete head, changed head/base, lock error or status-write error cannot publish success. The safety net is feature flags, revert, live QA after release, and screenshot comparison tracked in https://app.hypertask.ai/detail/project-4060/550.

The `premerge-evidence.timer` reconciles all open production PRs every two minutes. Each sweep fetches the production checker and includes its SHA-256 bytes digest in every cached verdict fingerprint, so merged rule changes recheck every waiting PR in the first successful sweep, without waiting for the ten-minute unchanged-verdict refresh. Rule-fetch failures fail closed.

Light gate jobs without a root repository install must install their own non-builtin dependencies. `tests/light-gate-dependencies.test.cjs` parses workflow jobs and follows relative script imports (including parity and the offline workflow tests); the Node version guard runs it with only its pinned `js-yaml` and TypeScript parser installs, independently of app CI's scope selection. The visual runner installs full dependencies itself; private scheduled speed measurements are not a PR gate. A missing-install negative control covers both feature-flag jobs and a new light gate. The feature-flag registry requires an explicit `FEATURE_FLAG_TYPESCRIPT_PATH`: an unset or unloadable parser prints one diagnostic and exits 2 (infrastructure error), never 0 (pass) or 1 (policy refusal). Auto-merge refuses an error; the feature-flag workflow publishes an error status. Local tests explicitly resolve the repo's TypeScript, and the repo-local flag generator and snapshot runner set that path before importing the registry.

## Resuming runners after a freeze

After verifying recovery, clear `MERGE_FREEZE` and record the lift together:

```bash
gh variable delete MERGE_FREEZE --repo hypertask-ai/hypertask && ~/.local/lib/hypertask/runner-pickup/runner-pickup record-lift
```

`record-lift` records the current epoch in `~/.local/state/runner-inbox/freeze-lift`.
Do not run it for an old release or merely green checks.
Without that record, blocked tickets remain blocked.
Pickup queues an older same-runner freeze or GitHub-limit block.
Before starting hax, the keeper drains one eligible ticket: moves it to
In Progress, reads it back, records an agent activity, and names it in the brief.
The move uses `vcc raw POST /mcp/tasks/update` with `expected_section_id` and
`expected_updated_at`. Both are checked under the existing mutation fence and
in the final database update: a newer section or revision returns 409 without
changing the ticket. Conditional updates accept only one section mutation.
A per-runner recovery intent is saved before the write; failed confirmation
is retried without repeating a completed move. Definitively changed holds retire
the intent without a move. A ready handoff stays durable until the keeper sees
the launched session complete and acknowledges that exact ticket; failed startup
and timeout do not acknowledge it. Recovery accepts only an
unambiguous freeze-only or GitHub-limit-only block, never mixed failures.
The blocked-section entry must also predate the lift; unknown entry age
refuses recovery. Fresh blocks, explicit blocker comments, questions, human
blocks and unrelated failures remain untouched. Incomplete reads cannot authorize a clear.
Install the merged pickup version before the keeper version; existing runner
processes are not restarted. Targeted offline recovery fixtures run as
`runner-pickup.recovery.test.py` in `ship-scripts-tests`.

## Daily AI model watch

[AI model watch](../.github/workflows/ai-model-watch.yml) runs at 05:43 UTC daily,
with production-only manual dispatch, on public-repo `ubuntu-latest` (free hosted
compute). It is non-required, uses Node 24 built-ins with no app install, and
runs `tests/model-diff.test.cjs` before discovery. `scripts/model-diff --json`
compares the app catalog with the Vercel AI Gateway and authenticated OpenAI /
Anthropic lists. Gateway failures warn and fall back; unknown pricing never
authorizes unconditional automatic shipping. No usable sources fails the watch.

The existing CI `HYPERTASK_MCP_TOKEN` files board-15 tickets through the MCP
search/create endpoints; optional `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` enable
provider fallback. Stable exact-title searches, serialized runs, a stable
idempotency key and fail-closed search validation prevent duplicate filings.
Premium discoveries over $5/M input tokens wait for
[HTPR-7746](https://app.hypertask.ai/detail/project-15/7746). The Action changes
no app models and grants only `contents: read`; runners follow the indexed
[update-ai-models skill](../.claude/skills/update-ai-models/SKILL.md) to ship an
existing-class OpenAI/Anthropic bump or ask Valentin about a new class/provider.
The saved discovery fixture is synthetic, not current upstream/pricing proof.

## Ship script regressions

The non-required `ship-scripts-tests` check in [`.github/workflows/ship-scripts-tests.yml`](../.github/workflows/ship-scripts-tests.yml) runs on GitHub-hosted `ubuntu-latest` for pull requests to `production` changing the script/unit paths in `docs/ci-policy.yml`, including `.claude/skills/ship/scripts/**`, `.claude/skills/verify-qa/scripts/**`, `scripts/premerge-local.sh` or the workflow itself. It does not change the ruleset or auto-merge requirements. No tests run on the VPS.

- Runs `bash .claude/skills/ship/scripts/ship-check.test.sh --premerge-only`, `python3 .claude/skills/ship/scripts/premerge-evidence.test.py`, `python3 .claude/skills/ship/scripts/ci-why.test.py`, `bash .claude/skills/ship/scripts/board-check.test.sh`, `bash .claude/skills/ship/scripts/user-unit-check.test.sh`, `python3 .claude/skills/verify-qa/scripts/evidence-prune.test.py` and `node --test .claude/skills/verify-qa/scripts/qa-identity.test.mjs`. The full shell suite also contains live authenticated checks and is deliberately excluded.
- Runs `python3 .claude/skills/ship/scripts/ht-hax-runner.test.py` against isolated home folders and fake process/load tools. It checks load-only launches, pauses, active sessions, target bounds, setup failure and validation before enabling the keeper timer. Interactive lifecycle fixtures check brief delivery, final-line detection, saved output, idle cooldown, failed-start watcher cleanup and bounded timeout recovery; they start no real runners.
- Installs Python 3 for the standard-library test harnesses and fixtures, `jq` for JSON handling in `ship-check`, and Git for repository-scope detection. Sets up Node 24 for the dependency-free QA identity tests, which use only temporary storage-state fixtures and a loopback HTTP server (YPER4-607). No npm or pip packages are needed; Bash and standard Unix utilities come with the hosted runner.
- Uses a temporary HOME and the harnesses' temporary state and local Git/GitHub/Hypertask fixtures. A fallback `gh` stub fails unexpected calls outside the fixtures. Tests need no network, real tokens, existing VPS state or systemd service; checkout and dependency installation still use network. Checkout does not persist credentials, and the job requests only `contents: read`, so fork PRs need no secrets.

The evidence-prune fixture test uses a temporary HOME, stubbed read-only
Hypertask responses and stubbed systemctl/unit-check calls. It exercises old and
fresh build trees, retained reports, Done-only video expiry, symlink/filesystem
boundaries, permission errors, daily installer ordering, logging, and premerge
scratch-copy/EXIT cleanup without installing dependencies or building the app.
It runs directly with Python's standard library, not the repository suite.
Daily live cleanup is separately installed by the runner; see
[QA evidence storage](../.claude/skills/verify-qa/reference/evidence-storage.md).

## Feature-map citation check (YPER4-610)

The non-required `feature-map-check` job in
[feature-map-weekly.yml](../.github/workflows/feature-map-weekly.yml) runs Mondays
at 03:37 UTC, on manual dispatch and on production PRs changing the maintenance
skill, feature-map or ops-map pages, or that workflow. It runs only the tiny offline fixture
test and dependency-free checker with Node 24 on free GitHub-hosted Ubuntu,
pinned actions, `contents: read`, no installs, secrets or paid AI calls.
It checks index completeness, repository-path citations and API-route resolution;
problems fail the job and appear in the step summary. It is not a required check
and does not alter the ruleset. Existing stale pages are reported, not allowlisted.

The separately installed user timer performs bounded source-only Codex reads and
files at most one drift ticket per ISO week. It never drives the app. A runner
ships documentation repairs through `/ship` and executes only the listed live
recipes with `verify-qa`. See the
[maintenance skill](../.claude/skills/maintain-verification-skill/SKILL.md) for
installation, state, load holds, limits and offline tests.

## Docs-only CI lane (YPER4-548 / YPER4-663)

Required `app-smoke` and `browser-smoke` still report success when every changed
file is documentation, skills or `tests/**` outside `src/`. The shared
`.github/scripts/ci-change-scope.cjs` emits `heavy_needed=false` for `docs/**`,
`.claude/**`, `skills/**`, `.agents/skills/**`, `tests/**` and Markdown outside
`src/`. Source files (even Markdown), dependency files and CI/harness code run
smoke normally. Empty/unknown diffs and detector failures run the heavy lane.
Production pushes always run everything.

App Smoke determines scope in its trusted validation job and publishes
`app-smoke: success` with `docs-only change, skipped` without starting its build
job. Browser smoke keeps its successful required job and explicit scope output,
but skips install/build/tests with a clear log line. Its PostgreSQL, Redis and
Soketi job-level services still start. Neither required workflow uses path skips.
Visual Regression keeps its narrow screen/harness path filter and excludes
Markdown; unit-test-only changes do not start it.

The stricter existing `build_needed` output for `ci-tests` is unchanged: changed
unit tests still run. Its legacy docs-only exclusions remain `docs/`, `.claude/`,
`scripts/self_hosted_agent/`, non-exercising `.github/` files and root Markdown;
`.github/workflows/ci-tests.yml` and `.github/scripts/` always exercise CI. Live
settings, review and approval guards remain mandatory. No detector job is added.

The detector fetches the base/head SHAs, deepens the shallow fetch (50, 200,
1000) until `git merge-base` is visible, and diffs merge base to head with
NUL-delimited `git diff --no-renames --name-only`. Diffing the moving
production tip instead counted every later production commit as changed and
sent skill-only PRs down the full lane (YPER4 fast lane). No merge base found
means run everything; moving source into docs cannot hide a
removed source file. Its self-check covers both outputs and fail-closed cases:
`node .github/scripts/ci-change-scope.cjs --self-check` (run in CI, not here).

## Visual regression (informational v1)

`Visual Regression` (`.github/workflows/visual-regression.yml`) reports `visual-regression` on non-draft production PRs touching screen or harness files; manual runs accept `base` and `head` refs.
It builds base then head on one GitHub-hosted runner, each with a fresh disposable database; base creates temporary expected PNGs and head compares against them.
Each build restores the production browser-smoke Next.js incremental cache using that checkout's lockfile/config hash and resolved commit, with the same compatible-hash fallback. Restore uses the producer's `.next/cache` archive path, then moves only that directory into the matching checkout before building. Visual runs never publish shared build caches; successful production browser-smoke pushes remain the only producer. A screenshot-cache hit skips the unused base restore, and production baseline-only runs skip the unused head restore. Cold misses still build and compare normally.
The job summary reports five phase timings and one matching log line: base build, base seed+capture, head build, head seed+capture and compare. Build rows measure only `next build`; seed+capture includes setup, readiness and teardown. Head capture and comparison share one Playwright command, charged to compare. Partial failures retain elapsed timings and mark unreached phases explicitly.
Base and head must install the same Playwright version, so one Chromium build draws both sides; a run stops when they differ and a Playwright bump needs fresh production baselines. Each checkout must also install exactly the version its own `package-lock.json` locks, and a cached base is compared against the base commit's locked version. Chromium captures board, task detail, the scrolled comment-box scene, Ctrl+J and inbox in Porcelain at 1440×900 and 390×844.
On failure, download `visual-regression-diffs` (7-day retention) and compare each screen's expected, actual and diff PNGs; the step summary lists failed screens or setup failures.
Production pushes capture the ten base PNGs once and save them with `actions/cache`.
PRs and manual comparisons restore only the exact key: base SHA, OS/architecture,
runner image version, and the head visual harness, seed, search stub, paired runner
and workflow hashes. There are no fallback keys; changed harnesses miss the cache.
Only successful production pushes save; PR-created caches cannot supply production
baselines. A hit validates all ten PNG signatures and viewport dimensions, skips
the base lifecycle, and still seeds, builds and compares the head. A miss retains
the existing paired lifecycle. Missing or malformed cached screenshots fail closed.
Phase timings mark skipped base work as `not reached`; summaries name cache reuse.
Only PNGs are cached, never databases, auth state or browser traces.

An intended visual change is approved by a human in the PR description with `Visual change approved: <ticket URL>`; the job still shows the diff and does not auto-approve it.
This v1 signal is not required by a ruleset and does not replace existing browser-smoke, layout locks or premerge evidence. No committed PNG baselines or storage-state artifacts are used.

## Layout lock matrix (YPER4-252)

`browser-smoke` also runs `e2e/smoke/layout-lock-matrix.spec.ts`, once with live-like flags and once with every flag on. It opens the ticket page (short and long comment thread), board, inbox and search once per sidebar state (AI sidebar open or closed, left sidebar collapsed or expanded) and resizes the window through 1920, 1440, 1280, 1100, 950, 768 and 390 wide. Each main part (title, description, comment list, comment box, properties panel, board columns, left sidebar, AI sidebar) is compared with `e2e/smoke/layout-lock-matrix.baseline.json`. A part that moves more than 8px, changes column, wraps below its neighbour, or leaves the comment box above the last comment fails with `<page> @ <width>px, AI sidebar <open|closed>, left sidebar <collapsed|expanded>: <part> moved <dx>,<dy>px`. Failing runs upload an "after" screenshot with the baseline boxes outlined (artifact `layout-lock-matrix`). A failing screen-spec test uploads its screenshot and Playwright error context as artifact `browser-smoke-failures` (YPER4-939), so the next flake can be read back; traces stay off because they carry the smoke session's traffic.

Ticket measurements in both layout-lock specs wait for `data-ticket-initial-scroll-ready="true"`: the unread snapshot is ready and the server-to-live row handoff is finished, matching `useTaskDetailInitialScroll`'s prerequisites. This test-only attribute does not change positioning. The screen spec's desktop comment expansion clicks (YPER4-939) wait for it too, so a click never lands on a server-rendered row the live list replaces; each click is bounded at 15s so a stalled thread names its step instead of using the whole test budget. The harness then waits the maximum relevant positioning delay from `taskDetailConfig.delays` (not a navigation-relative sleep), waits for scroll offsets and scroll extents to stay unchanged across two animation frames, uses `scrollToBaselinePosition` to reset scroll containers to their captured baseline position (desktop: top; phone: maximum scroll offset, except the long-thread matrix with AI open and rail expanded), and reapplies that target until scroll offsets and extents stay unchanged for two animation frames before sampling boxes. This follows phone bottom-padding growth when scrolling past 200px. Phone means the Mobile project in the screen spec and widths below 768px in the matrix, matching the app layout breakpoint. The phone title is sticky and the composer fixed; the flowing thread, not each landmark, scrolls to the bottom. The long-thread matrix at phone width with AI open and the rail expanded instead restores the window and the ticket’s own `[data-task-detail-path]` ancestor of `[data-testid="ticket-thread"]` to the top, without touching AI-sheet, rail or descendant scrollers. That state was captured at title y=64, properties y=126 and description y=502; forcing the long thread to the bottom can virtualize away its required properties row. Short-thread and AI-closed matrix states, the collapsed-rail state, and the screen spec retain exactly their previous targets and scroll paths. Non-ticket matrix pages retain their top reset. The matrix waits once per ticket navigation before resizing, then resets and stabilizes after each width's composer readiness check. The composer-below-thread guard and existing tolerances remain unchanged.

GitHub-only verification for [YPER4-562](https://app.hypertask.ai/detail/project-4060/562): `ci-tests` must pass `tests/layout-lock-scroll.test.cjs`; `browser-smoke` must pass both layout-lock specs with live-like and all-flags-on fixtures, including short/long threads at 1920px and phone direct/board-card entry. No baseline or flag-mode updates are part of this harness fix. Do not run tests, builds, typechecking or browsers on the shared server for this task; only `nice -n 19 npm run lint:changed` is permitted there.

- An intended layout change regenerates the baseline from the `origin/production` build with `LAYOUT_LOCK_UPDATE=1 LAYOUT_LOCK_SOURCE_COMMIT=$(git rev-parse origin/production) npx playwright test -c playwright.config.smoke.ts e2e/smoke/layout-lock.spec.ts --workers=1 --retries=0`, against the CI live-like seed and never `--all-flags-on`; after `scripts/premerge-local.sh up`, restore those modes in its disposable DB with `node scripts/seed-browser-smoke.mjs --live-like-control`. Moving landmarks are held to 24px and sizes to `max(24px, 10%)`; content-dependent heights lock their top/left/right edges and vertical order instead. Desktop measures at 1440x900 and phone at 390x844. The change then adds the page to the baseline's `approvedIn` map with the full URL of the ticket where Valentin approved it. The PR body needs the line `Layout change approved: <that URL>`.
- `.github/scripts/layout-lock-approval.mjs` enforces this on every pull request for `layout-lock.baseline.json`, `layout-lock-matrix.baseline.json` and both `*.flag-changes.json` ratchets, and prints the ticket it expects.
- The /admin/flags page is not in the matrix: only user 6 may open it and the smoke session must never be user 6.
- First-load jump (CLS under 0.05) is HTPR-7074, not this check.

## Premerge verify-qa (YPER4-673)

`browser-smoke` reuses its existing disposable PR build at `http://127.0.0.1:3100`. After the live-like inbox cycle, `.github/scripts/verify-qa-premerge.mjs` selects the feature-map page with the most changed files (longest prefix per file). Inbox changes run the seeded inbox cycle; supported login, board, task, comment, creation, AI-chat and billing changes run that page's tagged IDs from `e2e/smoke/journeys.spec.ts`, with `HT_QA_JOURNEYS=1`, one worker and no retries. The initial `--qa-journeys` seed provides a private QA runner board, so setup does not need to create another board after the Free account reaches its board limit. Writes stay on the disposable database, never a production preview. Ties, unsupported pages and unmatched diffs record `UNREACHABLE: no driver`; they never substitute inbox. Skipped or missing selected tests cannot count as PASS.

Changes to the dispatcher or its tests also run an explicitly synthetic login matched-control against the same PR build, saved under `verify-qa-premerge/matched-control/`. The top-level result always reports the real diff, including an unmatched infra-only diff. This control proves dispatch and opt-in without adding an unrelated app change.

Screenshots, `result.json` and `summary.md` upload as `verify-qa-premerge` for 7 days. The job summary names the journey, the feature-map page and the artifact URL. The step is report-only: `VERIFY_QA_REPORT_ONLY=1` and a non-zero exit become a warning, not a failed `browser-smoke`. It is not a ruleset context and does not block merges. A later unit can make it required after a clean week.

Sharing that `.next` build with app-smoke is deferred. `app-smoke.yml` is loaded from `production`, and its build runs inside a locked-down container with `CORE_APP_SMOKE`, a mocked Google font file and a docker-network callback URL. browser-smoke bakes different `NEXT_PUBLIC_*` values, including `NEXT_PUBLIC_BASEURL=http://127.0.0.1:3100`. The two workflows also run in parallel, so waiting on a large `.next` upload would slow a required check. The container build at `scripts/run-app-smoke-isolated.sh` stays.

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

## Action archive cache operations

The manifest at [`.github/actions/action-archive-cache-manifest.txt`](../.github/actions/action-archive-cache-manifest.txt) is the single inventory of cached action commits. Workflow `uses:` entries carry the same 40-character SHAs; release tags remain comments for readability and never decide execution.

- **Populate:** after changing the manifest, merge the pinned workflow change first or populate the new archive before dispatching jobs. On the runner host, update a trusted `production` checkout and run `sudo .github/scripts/install-action-archive-cache.sh`. The updater downloads by commit SHA, validates the gzip/tar structure, writes mode `0444`, and atomically publishes each archive. App CI runs on GitHub-hosted runners and downloads actions normally; the host-level cache only accelerates the self-hosted review and analytics lanes.
- **Install:** first-time hosts run the same command with `--install-services`. It writes a root-owned systemd drop-in for every local `actions.runner.*.service`, reloads systemd, and restarts each service. Run this while the lanes are idle because restart interrupts an active job.
- **Concurrency:** the updater holds `$CACHE/.populate.lock`. Parallel invocations serialize, and an already-valid immutable archive is not downloaded again. Runners only read archives; they never populate or mutate the cache.
- **Invalidation:** a new action release gets a new manifest SHA and a new archive. Old commit archives stay available to queued jobs. A corrupt exact-SHA file is quarantined as `.invalid.<UTC timestamp>.<pid>` and replaced; remove quarantined files only after inspection.
- **Upstream outage:** cached commits continue through archive preparation without a codeload request. A manifest miss still uses the runner's ordinary GitHub download path; do not weaken checks or move work to paid runners. If the needed commit is not cached, wait for codeload recovery or populate it from a trusted copy.
- **Restart behavior:** cache content changes are visible immediately and need no service restart. Restart is required only when adding or changing the `ACTIONS_RUNNER_ACTION_ARCHIVE_CACHE` drop-in. Verify with `systemctl is-active` and a worker log containing `Found action archive ... in cache directory` for every action used by the representative job.

The private reviewer workflow is commit-pinned separately in `valentinyeo/hypertask-reviewer`; its checkout and setup-node SHAs must remain present in this shared manifest.

## Reviewer engine deployment proof

For `hypertask-ai/reviewer` on `main`, with `SHIP_DEPLOY=none`, `ship-check deployed`
requires a recorded `live-proof` in the ticket's evidence folder:

```text
sha: <full merged engine commit>
source: <absolute reviewer checkout containing that commit>
check: reviewer-workflow
ci: https://github.com/hypertask-ai/reviewer/actions/runs/<CI run ID>
review: https://github.com/hypertask-ai/reviewer/actions/runs/<live review run ID>
target: https://github.com/hypertask-ai/hypertask/pull/<reviewed PR number>
head: <full reviewed PR commit>
```

Both runs must complete successfully on that exact engine commit and `main`.
CI must use `ci.yml`, a push or manual dispatch, and a successful `test` job.
The live run must use `review.yml`, a repository dispatch naming the recorded
PR and head, and a successful review step. Both published review statuses on
that head must point to the recorded live run and succeed. Missing, mismatched,
failed, skipped or unreadable evidence refuses deployment proof.

Other target reviews can return CONCERNS on the same engine commit. They are
not deployment tests for this recorded release. This narrow proof does not
change target PR approval, release containment, systemd verification, or the
no-release checks for other repositories.

## Performance baseline

On 2026-08-08, ten recent PR runs showed successful CI Build jobs taking 5:57–7:11, with a 6:48 median. Dependency installation took 100–152 seconds and full lint took 116–130 seconds.

The cache prototype for https://app.hypertask.ai/detail/project-15/5191 completed deterministic installation in 64.7 seconds locally. Full lint took 114.6 seconds cold and 3.47 seconds warm. A deliberate syntax-error probe still failed on the warm content cache, confirming changed files are not hidden.

The first Contabo run completed cold in 6:02. Repeating the exact commit on the same runner completed in 3:45: install took 55 seconds, TypeScript 74 seconds, lint 4 seconds, and tests 35 seconds. Restoring the separate setup-node npm archive cost 32 seconds, so that redundant remote cache was removed in favour of the persistent runner-local npm cache. A later run on a different runner exposed ESLint's absolute cache paths; the workflow now relocates those paths before linting.

Keep this file, [`docs/ci-policy.yml`](ci-policy.yml), and [https://hypertask.app/pipeline](https://hypertask.app/pipeline) synchronized with the live workflows.

## Review-lane baseline

Before the second dedicated runner was restored, the latest 100 AI-review workflow runs had **0 seconds p50 queue time, 398 seconds p95, and 1,019 seconds maximum**. Review execution was 124 seconds at p50. The review lane currently runs as a single runner (`contabo-1`) under the separate `htreviewrunner` OS identity; the live `/ci` page alerts when that lane goes offline.

## MCP, CLI and API contract

`mcp-cli-api-contract` is a separately reported, fail-closed summary of a contract executed inside
`browser-smoke`. It is not in the ruleset itself: it blocks merges because the contract step runs
inside the required `browser-smoke` job, so a failing contract fails that job. It uses the disposable server before any layout flag reseed. The owner,
team member, accepted external board guest, owner-created write agent and ordinary
OAuth client exercise catalog discovery, keyword search, task/comment/column writes
and readbacks, labels and pages. A read-role agent remains readable but cannot write;
an unaccepted board invitation grants no access. Search uses local fixture rows, not
production ranking or embeddings.

The existing pinned native CLI release is checksum verified, runs with isolated HOME
and a child-only bearer, and checks boards, task reads, creation, comments and column
moves against REST readbacks. Its TCP destinations are traced and must remain on the
local app. Missing output, failed, skipped or cancelled browser smoke fails the summary.
The sole no-contract exception is a successful docs-only browser job with an explicit
`docs_only=true` scope output; it does not claim the contract executed.
Activate the new production ruleset context in coordination with this policy update:
The hourly `Required Check Settings` monitor compares the live ruleset's exact
context set against the workflow expectation. This change does not modify that ruleset.

## Server feature-flag coverage (YPER4-713)

Server changes under `src/lib/mcp/`, `src/lib/mcp-server/`, `src/lib/api/`,
`src/app/api/`, `src/pages/api/` and `src/utils/controllers/` also enter the
feature-flag gate. Non-exempt changes need a ticket-specific `isFeatureEnabled`
call on an added or modified server line controlling runtime behavior. A client
`useFlag` call cannot satisfy server coverage. Re-export routes and their gated
operations need no duplicate reads. UI coverage stays independent. Existing title, label, registry
and refactor exemptions remain unchanged. Passing server features reuse the
`feature-gated-ui` owner-review routing token; no auto-merge route changes.
This bounded syntax check supplements review; it does not prove authorization or
cover every server service directory.

## Agent board scope guard (HTPR-7496)

`ci-tests` runs `.github/scripts/agent-scope/run.py --self-test` and then the real
scan after dependency installation or cache restore, before Prisma generation.
Python 3.12 from the runner tool cache (asserted, so an image change fails loudly)
creates a venv in `RUNNER_TEMP`; pip requires the committed hashes for Semgrep 1.140.0 and Pydantic
2.11.9. Pip downloads are cached, metrics and version checks are disabled.

The inventory is regenerated every run. Coverage is direct `prisma.project/task/comment`
findMany/findFirst/findUnique/update/delete/count calls in agent-capable entry files
only (files without such a delegate are skipped before Semgrep), not transitive controllers or whole-program authorization proof. Strict parse
errors and unscanned targets fail. Source-bound reviewed exceptions are separate
from visible, expiring call-bound debt. New findings and stale entries fail.

On PRs, additions or changes to existing debt/exception lists require each entry's
full `approvedIn` ticket URL and the matching PR body line, respectively
`Agent scope debt approved: <URL>` or `Agent scope exception approved: <URL>`.
First creation and removals are free. See [the guard README](../.github/scripts/agent-scope/README.md).
This adds no job, required check or ruleset change. Today's 81 debt entries are
tracked in https://app.hypertask.ai/detail/project-15/7508.

## Production revert proposals

`production-revert-pr.yml` handles failed production CI runs. It opens a revert PR, never merges or pushes production. Existing live-health rollback stays unchanged.

The read-only job replays named failing Node tests twice inside network-disabled containers. A locally built scratch image mounts system binaries, dependencies, and Git objects read-only. Runner control files, credentials, and the Docker socket stay outside. The last green production commit must pass. Git history identifies the first failing commit, whose parent must pass. The same checks must pass twice after reverting only that commit on current production. Later merges remain intact. Rate-limit, network, timeout, inconsistent, unsupported setup, dependency-lock changes, and already-fixed failures produce no proposal. The history search stops at 50 commits.

The separate publisher executes no candidate code. It rechecks production, pushes one deterministic branch per culprit, and leaves auto-merge off. The existing `AUTOMERGE_TOKEN` lets the proposal trigger normal required checks. No new credential or runner is needed.

Relevant PRs also replay the recorded incident without publishing. Manual dispatch accepts a failed CI run ID. It replays that historical head without opening a PR. For the 25 October source-regex incident, use run `40201291546`: the expected culprit is `73cc4b70870fb411935a3a169779a8fb8b49f168` (PR #2129). Hosted fixtures also prove publication against a disposable local Git remote, not production.

## Task writer and chip quality baseline

The existing [AI evals workflow](../.github/workflows/ai-evals.yml) also replays
`tests/fixtures/task-writer-eval/recorded.json` through
`scripts/task-writer-eval.cjs --verify-baseline` on relevant PRs. This is recorded
behavior, not a live-model claim. The corpus has twenty historical first-version /
current-description pairs from our own board, plus two explicitly synthetic A/B
cases. First saved versions follow the [approved source decision](https://app.hypertask.ai/detail/project-15/7976#comment-314535);
they are not guaranteed raw keystrokes or proof of model authorship. The target
remains forty real pairs. No inne or IGSH text is included.

The separate [live workflow](../.github/workflows/task-writer-eval.yml) runs only
on production, scheduled at 04:17 UTC daily or manually. Its `task-writer-live` job
renews the existing QA 985 login using `QA_LOGIN_EMAIL` and `QA_LOGIN_PASSWORD`.
It calls the production task-writer route using current configured models, saves
each resulting draft as a temporary QA Sandbox ticket, and invokes the same
new-ticket chip route the UI uses. It never changes product prompts, model
settings, flags, customer tickets or other teams' chats. Each created fixture is
soft-deleted and read back before the next case; cleanup failures fail closed and
retain pending IDs. There are at most 22 writer and 22 chip calls per run, one
case at a time, with a twelve-minute start budget and twenty-minute job limit.

Writer scores measure word limits, required/forbidden headings and placeholders.
Chip scores detect requests for existing sections, exact normalized copies of the
current prompt's examples and edits to required writer text. Empty chip responses
are recorded as unproven, not successful generation. These deterministic checks do
not judge factual accuracy or semantic paraphrases. Known initial debt remains
visible in the committed baseline. Each live report includes separate writer and
chip deltas. Quality deltas are report-only: one stochastic trial is not evidence
of a stable regression. Transport failures and incomplete runs cannot become a baseline.
Only score reports and cleanup IDs upload as artifacts; cookies, auth traffic and
raw generated drafts do not. This is informational CI, not a new required check.

To refresh a baseline, run the live script with a QA storage-state file in
`QA_STATE` (or the existing renewal credentials) and `WRITER_EVAL_OUTPUT` pointing
outside the committed fixture folder. Review the full output, promote it to
`recorded.json`, then run `node scripts/task-writer-eval.cjs --save-baseline`.
The offline replay binds the complete corpus hash and recomputes every score.

## Incident correlation replay

`ship-scripts-tests` runs the collector's supported offline runner and claim
checks: four Vercel reports join the original MCP report with five activities.
Different roots/routes stay separate. All board commands are private fakes.

## Guard API budget (YPER4-721)

The scanner workflow reports GitHub-native `secret-scan` and
`next-public-secrets` jobs. It makes no commit-status API calls, including
for fork and Dependabot PRs. Both scanners remain mandatory; the public-secret
summary fails unless its scan step explicitly succeeded. One additional tiny
summary job replaces the old status publisher and trusted completion workflow.

The trusted workflow reads PR metadata once for outside, size and title
checks. It publishes only the existing required `pr-title` status, combining
outside and title outcomes. Size remains advisory. A fresh pending status
invalidates an earlier same-head success before metadata reevaluation, so an
invalid title cannot keep its prior approval during later quota retries.
Publication rereads the open PR, production base, exact head, event title
and evaluated title. A rate-limit refusal
waits until the supplied reset and retries that whole fresh-read/publication
operation. Ordinary authorization errors remain failures. The retry wait is
bounded to one hour; an unavailable required result never becomes green.
No required ruleset context changes.

Trusted guard concurrency includes the workflow run ID.
Older event reruns cannot cancel newer evaluations.
Reruns still share their original event's group.

`node tests/guard-quota.test.cjs` executes the saved production scripts and
candidate workflow entry points with isolated GitHub responses. For a small,
same-repository PR without an existing size comment, the two guard workflows
use 22 explicit GitHub REST calls before and six after; writes fall from ten
to two. These are instrumented fixture counts, not network telemetry or
whole-fleet savings. Checkout, Actions internals, ticket binding, other
workflows and exceptional comment writes are excluded. The immutable fixture
records its production source SHA. Ten simulated pushes recover both a read
and publication 403 each; a real ten-push burst still requires separate logs.

App-smoke discovery uses the same reset-aware callback retry. Each replay
starts by rechecking the live head before cancelling older runs. If the retry budget is exhausted, cancellation is skipped and the build continues. This covers
the observed discovery-step refusal; the workflow's separate initial shell
lookups and final report remain separate API consumers.

## Provider-neutral Done enforcement

`vcc` checks section changes through the installed `ship-check move` entry point.
Completed columns require the same merged PR, deployment, documentation and
app QA evidence as the Claude hook. Numeric references, section IDs and renamed
completed columns use board reads. Failed reads or a missing checker refuse writes.
The checker comes from the installed production skill, never the caller's worktree.
Protected wrapper and guard changes require an independent lead merge.
This is workflow enforcement, not an OS sandbox against same-user file edits.

`ship-scripts-tests` runs the offline wrapper fixtures. They cover refusal before
the board write and successful forwarding with completed proof, without real
credentials or live board mutations. No new required check is added.

## Added-line style tokens (YPER4-714)

The existing `ci-checks` job runs `npm run lint:styles -- <base-sha> <head-sha>`
on PRs, using the merge base and exact head with full Git history.
Production-only edits are excluded. ESLint parses component attributes;
PostCSS SCSS parses stylesheets. Only added lines fail for literal colors,
raw Tailwind palette classes or arbitrary typography. Theme custom-property
owners may define raw tokens. Existing debt and deletions remain allowed,
without borrowing per-file suppression counts. No job or status is added.

## Metered API cost notes (YPER4-873)

The existing required `ci-tests` job checks added network calls in `src/`
with `.github/scripts/paid-api-cost-notes.mjs <base-sha> <head-sha>`.
The TypeScript AST inventory covers `fetch`, `globalThis.fetch`, Axios calls,
and the named AI SDK generation, embedding and credit-metadata calls. It is
not whole-program network discovery: aliases, other SDKs and cost estimates
still need semantic review. New or changed calls need a source-bound entry in
`.github/paid-api-cost-notes.json`: maximum estimated dollars per day, reason,
and an HTTPS pricing or measurement source. Identical moved calls are not new;
additional copies are. Parse and Git failures stop the check. No paid request
is made by this check, and no new required status is added.

New flags declaring `releaseRisk.highRisk: "money"` must explicitly default
to `OWNER_AND_QA`; Valentin approves release through the existing flag-switch path.
Existing flag definitions and live modes are unchanged. Other high-risk
classes retain their existing default rules.

## Runner PR queue priority

`ship-scripts-tests` replays `pr-drain-pick.test.py` alongside the hax launcher
fixtures. The picker uses the runner GitHub App token, serializes local PR
claims, and returns `WAIT` for queued work held by active runners. Only `NONE`
permits normal ticket selection. GitHub or claim read failures never mean an
empty queue. The launcher installer ships both the picker and queue-first
instruction. This changes no required checks or release permissions.

See [the live verification recipe](../.claude/skills/verify-qa/reference/ops-map/pr-drain-picker.md).

## Board registration boundary (HTPR-8190)

The existing `ci-checks` job runs dependency-cruiser 16.10.4, pinned in the
lockfile, against board command registration. The rule checks direct imports
from `domains/boardCommands.ts`: only `HTCTypes`, model and enum contracts may
come from `src`. Other legacy registrations are outside this rule. The
`tests/domain-boundary.test.cjs` fixtures prove allowed contracts and assembly
imports pass, and concrete domain imports fail. The scan runs on non-documentation
changes and unknown diffs; boundary-only runs skip the existing full checks.
The existing `ci-tests` summary requires the scan job when selected. No required
context is added.

Hosted `ship-scripts-tests` runs the pickup domain fixture with
`python3 .claude/skills/ship/scripts/runner-pickup.domain.test.py`, alongside
`runner-pickup.recovery.test.py` and `runner-pickup.test.sh`. These cover pickup
coordination, not manual claims.
