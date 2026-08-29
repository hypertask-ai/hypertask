# CI contract

_Last updated: 2026-08-22._

**Hypertask uses fixed-cost Contabo runners, a provider-neutral AI review gate, and direct production deploys from `staging`.** The human-readable source is [https://hypertask.app/wiki/deployment](https://hypertask.app/wiki/deployment); the machine-readable companion is [`docs/ci-policy.yml`](ci-policy.yml).

## Review gate

- The private `valentinyeo/hypertask-reviewer` workflow uses this order: **GPT-5.6 Luna through the ChatGPT/Codex subscription, Claude Sonnet through the Claude Code subscription, then GPT-5.6 Luna through Vercel AI Gateway**.
- The historical required-check name remains `claude-review` temporarily so the active GitHub ruleset and queued PRs do not lose their gate. Every review comment identifies the backend that produced its verdict.
- The private repository publishes that gate as a commit status because cross-repository user tokens cannot create GitHub Check Runs. Branch protection and auto-merge consume the same `claude-review` context either way.
- After publishing a final status, the private workflow dispatches the application repository's auto-merge evaluator for that PR. It does this for approvals, concerns, and infrastructure failures, so completion cannot be missed when CI happened to finish first.
- A five-minute application auto-merge sweep is the final availability fallback. It re-evaluates green PRs even if GitHub loses the cross-repository completion dispatch.
- A root-installed systemd timer polls every 30 seconds as the isolated `reviewdispatch` account. It validates each open PR, exact head SHA, same-repository source, and `staging` target before dispatching to the private reviewer repository. The private workflow checks out only the trusted `staging` copy of `.github/scripts/ai-review.mjs`; it reads PR code as data and never checks it out or executes it.
- The dispatcher records terminal `claude-review` results by commit SHA under `/var/lib/hypertask-ai-review/completed`. Each scan uses one GitHub API request to list open PRs, then rechecks only heads without a terminal marker. Keep this cache in place. With 24 or more open PRs, repeated checks of completed heads consumed the 5,000-request hourly quota and made the CI monitor report an unknown topology (HTPR-5548).
- Generated dependency lockfiles are represented by file metadata instead of their full machine-generated contents. The reviewer inspects the package manifest and CI result without spending tens of thousands of tokens on a lockfile.
- Every backend must return the same strict JSON-schema verdict. Quota, authentication, missing CLI, timeout, empty, or malformed responses advance to the next backend. The final gateway backend retries transient infrastructure or response failures three times. A valid `APPROVE` or `CONCERNS` verdict stops the chain. If every backend fails, the required check fails closed.
- The gateway fallback allows up to 24,000 output tokens for Luna high reasoning, three times the previous ceiling. It records the finish reason and token usage when a response contains no review text.
- Existing queued PRs are discovered automatically by the local poller. The broker sends a `repository_dispatch` event, so GitHub always runs the credential-bearing workflow from the private repository's default branch. A trusted infrastructure retry uses the same event and exact PR head SHA; branch-selectable `workflow_dispatch` is forbidden.
- Dispatch markers are reconciled against both the current `claude-review` status and the named private workflow run. Queued or running reviews remain protected for their full duration; the 30-second poller makes a cancelled, failed-before-status, or vanished run retryable after a five-minute GitHub propagation grace.
- Automatic dispatch is capped at two attempts per head: the initial run and one recovery. Further infrastructure-only retries must use a trusted `repository_dispatch` request for the exact PR head, preventing an unhealthy provider from consuming quota indefinitely without making a credential-bearing workflow branch-selectable.
- DeepSeek-produced PRs keep the `hold` label. The automated verdict is evidence, but a trusted release session must still remove the hold before merge.
- Subscription credentials belong only to the isolated `aireviewer` OS account. Only the private repository's `htreviewrunner` identity may invoke the root-owned wrappers. The broker runs only as `reviewdispatch`; the general `ghrunner` identity used by application jobs can invoke neither boundary.
- The broker's cross-repository credential is supplied through a `reviewdispatch`-only curl config file, never a command argument or application workflow environment.
- The safe manual retry command is documented in `openwiki/deployment.md`; it sends `repository_dispatch` with a numeric PR and exact 40-character head SHA. The private workflow and reviewer validate both before using credentials.

## Release contract

- CI Build runs on the heavy `[self-hosted, contabo]` lane. AI review runs from the private reviewer repository on `[self-hosted, ai-review]`. Secret Guard, Revert Guard, and Auto-merge run on `[self-hosted, ci-fast]`; review discovery is a local 30-second systemd timer and occupies no Actions runner.
- CI Build uses the committed `package-lock.json` with `npm ci --prefer-offline`, reusing each self-hosted runner's local npm package cache. ESLint still covers the full repository, but unchanged file results are restored through its content-validated cache; a cache miss performs a complete lint. The workflow relocates ESLint's absolute cache paths when GitHub schedules a run on a different Contabo runner. PRs consume the trusted base-branch cache read-only. Every successful new `staging` commit refreshes it; an exact same-commit rerun skips the duplicate save.
- TypeScript and the full Node test suite remain uncached correctness checks on every CI Build run.
- All six local runner services read pinned GitHub Action archives from the shared root-owned `/opt/github-actions/action-archive-cache`. The runner copies each immutable archive into its per-job temporary directory before extraction, so `_work` cleanup and the `ghrunner` / `htreviewrunner` repository boundary remain unchanged.
- `contabo-1` and `contabo-2` are registered only to the private reviewer repository, carry `ai-review`, and run as `htreviewrunner`. `contabo-4` is exclusive to `ci-fast`; `contabo-3` and `contabo-5` carry `contabo`. Application PR workflows cannot enter the two subscription-review slots.
- The `staging` ruleset requires `ci-build`, `claude-review`, `next-public-secrets`, `revert-guard`, `speed-evidence`, and `speed-qa`. The trusted speed workflow marks both speed checks as not applicable for non-speed PRs, so manual merges cannot skip them on speed PRs.
- PR #2920 is the one-time bootstrap for these two checks because `staging` cannot run a workflow that it does not have yet. The workflow exception matches only its owner, number, exact title, same-repository branch, and full file set. Its owner-authorized manual merge still requires the existing review, secret, and build checks. After deployment, reconcile both speed statuses on every open PR before adding them to the live `staging` ruleset.
- A separate `pull_request_target` workflow judges every PR tagged `[SPEED]` in its required `HTPR-<n> [SPEED] <summary>` title. GitHub's immutable title history keeps that classification after a retitle. The workflow uses the trusted `staging` version of the gate, reads the PR's evidence as data, and publishes the result on the exact PR commit. It never checks out or runs PR code.
- A `[SPEED]` PR must add or update one `performance/evidence/*.json` record for its exact head commit. The gate compares exactly five mobile candidate runs against baselines from trusted `staging`. Every run points to a distinct repository-owner-authored GitHub comment containing the raw JSON result. The gate verifies its SHA-256 digest, commit, profile, identity, timestamp, and metrics before aggregation. It rejects regressions above 5%, enforces the current main-thread limits, and requires the two-session navigation and live-update checks. PR-supplied baseline runs are rejected. Any PR that changes the gate or its limits is parked for manual owner review, regardless of its title. Speed PRs cannot change those files at all.
- Every push to `staging` dispatches speed status reconciliation for all open staging pull requests. This fills both required speed contexts before the live ruleset is updated and keeps existing pull requests from being stranded.
- Every `[SPEED]` PR also requires a successful `speed-qa` status on its exact head commit. Only the repository owner may publish this status. A supervising session outside the Speed Engineer sandbox publishes it after checking the raw measurements and browser proof. The Speed Engineer must never approve its own evidence.
- Auto-merge uses the newest result for each check name. This lets a current provider-portable compatibility check supersede an obsolete reviewer failure on the same backlog commit; the exact-commit `APPROVE` comment is still mandatory.
- Auto-merge keeps all scratch state in a unique directory under `RUNNER_TEMP`. A PR read, diff read, or merge that still fails after retries makes the workflow fail visibly; an incomplete sweep must never report green.
- Vercel previews are optional. Merge to `staging` deploys production.
- Do not add another runner host, VPN, required preview, or paid hosted fallback without a recorded decision.

## Visual regression gate

`visual-regression` screenshots the five screens a user lands on (board, task detail, search, inbox, and the Ctrl+K palette) at 1440 and 390 wide in the `amoled` and `porcelain` themes, and fails when pixels move without an approved baseline. It catches the change that typechecks, lints and tests green and still puts an unwanted control on screen; [HTPR-5649](https://app.hypertask.ai/detail/project-15/5649) shipped an archived-results checkbox into search that way.

- The job builds and serves the application itself against a throwaway PostgreSQL container on the `[self-hosted, contabo]` lane. It does not screenshot a Vercel preview: previews are opt-in here, and auto-merge treats a required check with no run exactly like a failing one, so a preview-triggered required check would freeze merging on every pull request.
- The check reports success on a pull request that changes no pixel-affecting file, which is what makes membership of the auto-merge required list safe. Never add a name to that list unless its job reports on every pull request.
- Chromium runs inside the pinned `mcr.microsoft.com/playwright` image rather than on the runner, so a baseline generated on a developer machine matches one generated in CI. Fonts and the Chromium build are the same in both places.
- The fixture comes from the demo provisioner with the guest prefix removed, so the screenshots show the ordinary signed-in chrome against a realistic board without any network credential.
- Reference images live in [`visual/baseline/`](../visual/baseline). Regenerate them with `node visual/harness.mjs update`, and prove the gate can still fail with `node visual/harness.mjs control`, which injects an unapproved control and expects a red run.
- `.github/scripts/visual-baseline-guard.mjs` rejects any pull request that edits `visual/baseline/**` unless its body carries a `## Visual change` heading. Without that rule a pull request could approve its own regression by committing new pixels.
- The search screenshot pins the search chrome, not result rows: results come from Turbopuffer, which a self-contained job has no key for.

## Action archive cache operations

The manifest at [`.github/actions/action-archive-cache-manifest.txt`](../.github/actions/action-archive-cache-manifest.txt) is the single inventory of cached action commits. Workflow `uses:` entries carry the same 40-character SHAs; release tags remain comments for readability and never decide execution.

- **Populate:** after changing the manifest, merge the pinned workflow change first or populate the new archive before dispatching jobs. On the runner host, update a trusted `staging` checkout and run `sudo .github/scripts/install-action-archive-cache.sh`. The updater downloads by commit SHA, validates the gzip/tar structure, writes mode `0444`, and atomically publishes each archive.
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

Keep this file, [`docs/ci-policy.yml`](ci-policy.yml), and [https://hypertask.app/pipeline](https://hypertask.app/pipeline) synchronized with the canonical wiki page.

## Review-lane baseline

Before the second dedicated runner was restored, the latest 100 AI-review workflow runs had **0 seconds p50 queue time, 398 seconds p95, and 1,019 seconds maximum**. Review execution was 124 seconds at p50. `contabo-1` and `contabo-2` now form the private-repository `ai-review` lane under a separate OS identity; `contabo-4` handles dispatch and the short non-review gates.
