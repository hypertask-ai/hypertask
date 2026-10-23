# CI contract

_Last updated: 2026-10-22._

**Hypertask app CI runs on GitHub-hosted `ubuntu-latest` runners (the repository is public, so hosted minutes are free), uses a provider-neutral AI review gate, and deploys production directly from the `production` branch.** The only self-hosted runners on the Contabo host belong to the private reviewer and analytics repositories. This file is the human-readable contract; the machine-readable companion is [`docs/ci-policy.yml`](ci-policy.yml).

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
- TypeScript and the selected PR tests (full suite on production pushes) remain correctness checks on every non-docs CI Tests run.
- PR and production-push CI Tests runs do not collect or publish V8 coverage. The separate non-required [`Coverage Nightly`](../.github/workflows/coverage-nightly.yml) workflow runs the full suite with coverage at **02:17 UTC daily**, or via `workflow_dispatch` on `production` only. It checks out the event's exact production SHA and reports as `coverage-nightly`, never `ci-tests`, so diagnostics cannot supersede a required correctness result. Its 60-minute timeout gives the covered suite more room than the unchanged 40-minute CI Tests gate.
- Coverage remains report-only (`continue-on-error` on reporting). The nightly job keeps `npm run coverage:report`, the job summary, `automated-test-coverage-<commit>`, the report/critical-domain paths, and 30-day retention. Download coverage from **Coverage Nightly**, not CI Tests. No required check or runtime script consumes the uploaded coverage; `scripts/coverage-summary.mjs` reads the nightly `coverage/report/coverage-summary.json` within that job. See [testing](testing.md#coverage-baseline).
- Dependabot still applies informational `full-ci` and lane labels; neither starts nor changes CI Tests or test selection. The `major-upgrade` label still starts its separate ticket workflow. No job-level label skip is added: normal PR events continue reporting both `ci-tests` and `browser-smoke`, including the existing docs-only scope path. Adding approval text after a failed agent-scope approval guard now requires a new commit to produce a fresh PR event; editing the body alone does not rerun that guard, and rerunning the old event retains its old body.
- CI Tests runs the runner dispatcher Python fixtures (`runner-dispatch.test.py` and `runner-dispatch.cache.test.py`) and `runner-selfupdate.test.sh` from `.claude/skills/ship/scripts/` on GitHub-hosted runners, even for `.claude/`-only PRs. These offline fixtures need no installed runner scripts or credentials.
- `contabo-1` is registered only to the private reviewer repository, carries `ai-review`, and runs as `htreviewrunner`. Application PR workflows cannot schedule it, and its subscription wrappers are unreachable from hosted runner jobs.
- The repository default branch is `production`. GitHub loads `workflow_run` files from the default branch, so this setting lets the protected App Smoke workflow react to every App Smoke Request run. Frozen `main` remains the legacy EC2 rollback branch.
- The `production` ruleset requires the exact contexts in `docs/ci-policy.yml`, including `ci-tests` and `browser-smoke`. Both jobs run on every non-draft PR without a label gate. CI Tests still verifies the live ruleset before deciding scope; this optimization adds no required check names. CI Tests reports on every non-draft PR opened, synchronize, reopened, and ready_for_review event; labels (including `full-ci`) and title/body edits do not restart it. App Smoke Request uses the same four events. Title/body-sensitive gates retain their own triggers. The speed checks were retired with the 2026-08 staging rename; no `[SPEED]` gate exists today.
- Gitleaks (`secret-scan`) scans only the commits a change adds: a pull request scans base..head, and a push scans the previous tip..new tip (a new branch, or a force push whose old tip is gone, scans everything not on `production`). A finding on one branch therefore cannot turn other branches red. Branch deletions are not scanned.
- Auto-merge uses the newest result for each check name. This lets a current provider-portable compatibility check supersede an obsolete reviewer failure on the same backlog commit; the exact-commit `APPROVE` comment is still mandatory.
- Auto-merge keeps all scratch state in a unique directory under `RUNNER_TEMP`. A PR read, diff read, or merge that still fails after retries makes the workflow fail visibly; an incomplete sweep must never report green.
- Vercel previews are optional. Merge to `production` deploys production; a failed deploy build keeps the previous deployment live.
- Do not add another runner host, VPN, required preview, or paid hosted fallback without a recorded decision.

## Live required-check settings

`Verify live required-check settings` runs the dependency-free
[verifier](../.github/scripts/verify-required-check-settings.mjs) on free
GitHub-hosted runners. Every `production` push verifies the default branch,
exactly one active `production-required-checks` ruleset, its branch target and
production include/exclude conditions, and the exact required-context set
(including both review contexts, without aliasing).

On pull requests, it reads settings only when the merge-base diff changes
`.github/**`, `docs/ci-policy.yml`, or `docs/ci.md`. Checkout includes full history;
the NUL-delimited diff disables rename detection so moving a CI file out of
`.github/` cannot hide its deletion. An unreadable event, invalid SHA, failed diff,
or empty/unknown diff verifies instead of skipping. Other PRs log an explicit
skip and make **zero settings API calls**. No changed-files API is used.

Before this change, every run made three settings API calls. Scoped PRs and
production pushes still make three on a successful first attempt: repository
metadata, ruleset list, and one full ruleset read. GitHub REST's
[repository ruleset list](https://docs.github.com/en/rest/repos/rules#get-all-repository-rulesets)
returns summaries, not rules or ref conditions; `includes_parents` includes parent
rulesets, not full details. The
[branch rules endpoint](https://docs.github.com/en/rest/repos/rules#get-rules-for-a-branch)
returns effective rules but not the name/enforcement/target/ref conditions needed
to preserve these assertions. Neither can replace the full ruleset read safely.

Reads use `gh api --include`. A rate-limited 403 or 429 waits for
`x-ratelimit-reset` / `retry-after` (the later time when both apply), logging
`rate limited, waiting Ns until reset`, then retries only that failed read.
Cumulative sleeps are capped at **300 seconds**, with a six-minute overall
budget and a seven-minute step timeout inside the 40-minute job. Missing usable
rate-limit timing, an exceeded budget, other API errors, malformed settings, or a
settings mismatch fail the check; nothing passes without reading the settings
when verification is required. No paid runner, service, or dependency is added.

## Premerge evidence

`premerge-evidence` passes every open `production` PR with the exact description `test click removed (Valentin 2026-10-21)`. No screen-path, flag-removal, live-mode, browser-click, `premerge.md` or recording evaluation remains. Valentin removed the test click on 2026-10-21 because it was not helping.

New flag definitions that break the default-mode rules still block merge through the separate required `feature-flag-gate`, not `premerge-evidence`. Before any UI, title or label exemption, `.github/scripts/feature-flag-gate.mjs` requires explicit `defaultMode: "EVERYONE"` for new definitions unless their kind is `bugfix` or `internal`, or they declare `releaseRisk.highRisk`. Its trusted registry parser rejects internal flags and high-risk flags whose effective default is Everyone, including bugfix flags with an implicit Everyone default. Eligible new flags defaulting to Everyone remain allowed; high-risk flags defaulting to Owner + QA remain allowed. GitHub reads, commit fetches and parsing failures fail closed in that gate.

The publisher still holds its shared lock from validation through the status post, requires a full 40-character head SHA, and re-reads the open PR's production base and head before posting. A closed PR, non-production base, unreadable or incomplete head, changed head/base, lock error or status-write error cannot publish success. The safety net is feature flags, revert, live QA after release, and screenshot comparison tracked in https://app.hypertask.ai/detail/project-4060/550.

The `premerge-evidence.timer` reconciles all open production PRs every two minutes. Each sweep fetches the production checker and includes its SHA-256 bytes digest in every cached verdict fingerprint, so merged rule changes recheck every waiting PR in the first successful sweep, without waiting for the ten-minute unchanged-verdict refresh. Rule-fetch failures fail closed.

Light gate jobs without a root repository install must install their own non-builtin dependencies. `tests/light-gate-dependencies.test.cjs` parses workflow jobs and follows relative script imports (including parity and the offline workflow tests); the Node version guard runs it with only its pinned `js-yaml` and TypeScript parser installs, independently of app CI's scope selection. The visual runner installs full dependencies itself; private scheduled speed measurements are not a PR gate. A missing-install negative control covers both feature-flag jobs and a new light gate. The feature-flag registry requires an explicit `FEATURE_FLAG_TYPESCRIPT_PATH`: an unset or unloadable parser prints one diagnostic and exits 2 (infrastructure error), never 0 (pass) or 1 (policy refusal). Auto-merge refuses an error; the feature-flag workflow publishes an error status. Local tests explicitly resolve the repo's TypeScript, and the repo-local flag generator and snapshot runner set that path before importing the registry.

## Ship script regressions

The non-required `ship-scripts-tests` check in [`.github/workflows/ship-scripts-tests.yml`](../.github/workflows/ship-scripts-tests.yml) runs on GitHub-hosted `ubuntu-latest` for pull requests to `production` changing the script/unit paths in `docs/ci-policy.yml`, including `.claude/skills/ship/scripts/**`, `.claude/skills/verify-qa/scripts/**`, `scripts/premerge-local.sh` or the workflow itself. It does not change the ruleset or auto-merge requirements. No tests run on the VPS.

- Runs `bash .claude/skills/ship/scripts/ship-check.test.sh --premerge-only`, `python3 .claude/skills/ship/scripts/premerge-evidence.test.py`, `python3 .claude/skills/ship/scripts/ci-why.test.py`, `bash .claude/skills/ship/scripts/user-unit-check.test.sh`, `python3 .claude/skills/verify-qa/scripts/evidence-prune.test.py` and `node --test .claude/skills/verify-qa/scripts/qa-identity.test.mjs`. The full shell suite also contains live authenticated checks and is deliberately excluded.
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
skill, feature-map pages or that workflow. It runs only the tiny offline fixture
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

## Docs-only CI lane (YPER4-548)

On non-draft PRs, the existing `ci-tests` and `browser-smoke` jobs both run and
report ordinary **success**, not a skipped job, when every changed file is under
`docs/`, `.claude/`, `scripts/self_hosted_agent/` or `.github/`, or is a `.md`
file at the repo root (`README.md`). Nested Markdown such as
`src/app/wiki/agents/agents.md` is app content and runs everything. Changes to
`.github/workflows/ci-tests.yml` or `.github/scripts/` always run everything so
the edited gate is exercised. Existing live-settings, review and approval guards still apply.
There are no workflow-level path filters and no additional detector jobs.

Each job runs `.github/scripts/ci-change-scope.cjs` using the runner's bundled
Node before setup-node, dependency installation, caches, tests or Docker work.
It fetches the exact PR base and head SHAs and uses `git diff --no-renames
--name-only -z BASE_SHA HEAD_SHA`; both sides of a renamed file are considered.
A non-doc file, empty list, missing SHA/base, git error or detector failure runs
the heavy lane. Production pushes always run everything. The existing PR-only
cancellation and draft guards are unchanged.

Browser PostgreSQL, Redis and Soketi stay job-level services, so a docs-only
`browser-smoke` still pays their short start-up but skips install, build and tests.
Only free GitHub-hosted `ubuntu-latest` runners are used. Verify the matcher without installing dependencies:
`node .github/scripts/ci-change-scope.cjs --self-check`.

## Visual regression (informational v1)

`Visual Regression` (`.github/workflows/visual-regression.yml`) reports `visual-regression` on non-draft production PRs touching screen or harness files; manual runs accept `base` and `head` refs.
It builds base then head on one GitHub-hosted runner, each with a fresh disposable database; base creates temporary expected PNGs and head compares against them.
Chromium 1.64.0 captures board, task detail, the scrolled comment-box scene, Ctrl+J and inbox in Porcelain at 1440×900 and 390×844.
On failure, download `visual-regression-diffs` (7-day retention) and compare each screen's expected, actual and diff PNGs; the step summary lists failed screens or setup failures.
An intended visual change is approved by a human in the PR description with `Visual change approved: <ticket URL>`; the job still shows the diff and does not auto-approve it.
This v1 signal is not required by a ruleset and does not replace existing browser-smoke, layout locks or premerge evidence. No committed PNG baselines or storage-state artifacts are used.

## Layout lock matrix (YPER4-252)

`browser-smoke` also runs `e2e/smoke/layout-lock-matrix.spec.ts`, once with live-like flags and once with every flag on. It opens the ticket page (short and long comment thread), board, inbox and search once per sidebar state (AI sidebar open or closed, left sidebar collapsed or expanded) and resizes the window through 1920, 1440, 1280, 1100, 950, 768 and 390 wide. Each main part (title, description, comment list, comment box, properties panel, board columns, left sidebar, AI sidebar) is compared with `e2e/smoke/layout-lock-matrix.baseline.json`. A part that moves more than 8px, changes column, wraps below its neighbour, or leaves the comment box above the last comment fails with `<page> @ <width>px, AI sidebar <open|closed>, left sidebar <collapsed|expanded>: <part> moved <dx>,<dy>px`. Failing runs upload an "after" screenshot with the baseline boxes outlined (artifact `layout-lock-matrix`).

Ticket measurements in both layout-lock specs wait for `data-ticket-initial-scroll-ready="true"`: the unread snapshot is ready and the server-to-live row handoff is finished, matching `useTaskDetailInitialScroll`'s prerequisites. This test-only attribute does not change positioning. The harness then waits the maximum relevant positioning delay from `taskDetailConfig.delays` (not a navigation-relative sleep), waits for scroll offsets and scroll extents to stay unchanged across two animation frames, uses `scrollToBaselinePosition` to reset scroll containers to their captured baseline position (desktop: top; phone: maximum scroll offset, except the long-thread matrix with AI open and rail expanded), and reapplies that target until scroll offsets and extents stay unchanged for two animation frames before sampling boxes. This follows phone bottom-padding growth when scrolling past 200px. Phone means the Mobile project in the screen spec and widths below 768px in the matrix, matching the app layout breakpoint. The phone title is sticky and the composer fixed; the flowing thread, not each landmark, scrolls to the bottom. The long-thread matrix at phone width with AI open and the rail expanded instead restores the window and the ticket’s own `[data-task-detail-path]` ancestor of `[data-testid="ticket-thread"]` to the top, without touching AI-sheet, rail or descendant scrollers. That state was captured at title y=64, properties y=126 and description y=502; forcing the long thread to the bottom can virtualize away its required properties row. Short-thread and AI-closed matrix states, the collapsed-rail state, and the screen spec retain exactly their previous targets and scroll paths. Non-ticket matrix pages retain their top reset. The matrix waits once per ticket navigation before resizing, then resets and stabilizes after each width's composer readiness check. The composer-below-thread guard and existing tolerances remain unchanged.

GitHub-only verification for [YPER4-562](https://app.hypertask.ai/detail/project-4060/562): `ci-tests` must pass `tests/layout-lock-scroll.test.cjs`; `browser-smoke` must pass both layout-lock specs with live-like and all-flags-on fixtures, including short/long threads at 1920px and phone direct/board-card entry. No baseline or flag-mode updates are part of this harness fix. Do not run tests, builds, typechecking or browsers on the shared server for this task; only `nice -n 19 npm run lint:changed` is permitted there.

- An intended layout change regenerates the baseline from the `origin/production` build (steps in the spec header) and adds the page to the baseline's `approvedIn` map with the full URL of the ticket where Valentin approved it. The PR body needs the line `Layout change approved: <that URL>`.
- `.github/scripts/layout-lock-approval.mjs` enforces this on every pull request for `layout-lock.baseline.json`, `layout-lock-matrix.baseline.json` and both `*.flag-changes.json` ratchets, and prints the ticket it expects.
- The /admin/flags page is not in the matrix: only user 6 may open it and the smoke session must never be user 6.
- First-load jump (CLS under 0.05) is HTPR-7074, not this check.

## Action archive cache operations

The manifest at [`.github/actions/action-archive-cache-manifest.txt`](../.github/actions/action-archive-cache-manifest.txt) is the single inventory of cached action commits. Workflow `uses:` entries carry the same 40-character SHAs; release tags remain comments for readability and never decide execution.

- **Populate:** after changing the manifest, merge the pinned workflow change first or populate the new archive before dispatching jobs. On the runner host, update a trusted `production` checkout and run `sudo .github/scripts/install-action-archive-cache.sh`. The updater downloads by commit SHA, validates the gzip/tar structure, writes mode `0444`, and atomically publishes each archive. App CI runs on GitHub-hosted runners and downloads actions normally; the host-level cache only accelerates the self-hosted review and analytics lanes.
- **Install:** first-time hosts run the same command with `--install-services`. It writes a root-owned systemd drop-in for every local `actions.runner.*.service`, reloads systemd, and restarts each service. Run this while the lanes are idle because restart interrupts an active job.
- **Concurrency:** the updater holds `$CACHE/.populate.lock`. Parallel invocations serialize, and an already-valid immutable archive is not downloaded again. Runners only read archives; they never populate or mutate the cache.
- **Invalidation:** a new action release gets a new manifest SHA and a new archive. Old commit archives stay available to queued jobs. A corrupt exact-SHA file is quarantined as `.invalid.<UTC timestamp>.<pid>` and replaced; remove quarantined files only after inspection.
- **Upstream outage:** cached commits continue through archive preparation without a codeload request. A manifest miss still uses the runner's ordinary GitHub download path; do not weaken checks or move work to paid runners. If the needed commit is not cached, wait for codeload recovery or populate it from a trusted copy.
- **Restart behavior:** cache content changes are visible immediately and need no service restart. Restart is required only when adding or changing the `ACTIONS_RUNNER_ACTION_ARCHIVE_CACHE` drop-in. Verify with `systemctl is-active` and a worker log containing `Found action archive ... in cache directory` for every action used by the representative job.

The private reviewer workflow is commit-pinned separately in `valentinyeo/hypertask-reviewer`; its checkout and setup-node SHAs must remain present in this shared manifest.

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
CI Tests' `Verify live required-check settings` step compares the live ruleset's exact
context set against the workflow expectation. This change does not modify that ruleset.

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
