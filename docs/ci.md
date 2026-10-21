# CI contract

_Last updated: 2026-09-17._

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
- TypeScript and the full Node test suite remain uncached correctness checks on every CI Tests run.
- `contabo-1` is registered only to the private reviewer repository, carries `ai-review`, and runs as `htreviewrunner`. Application PR workflows cannot schedule it, and its subscription wrappers are unreachable from hosted runner jobs.
- The repository default branch is `production`. GitHub loads `workflow_run` files from the default branch, so this setting lets the protected App Smoke workflow react to every App Smoke Request run. Frozen `main` remains the legacy EC2 rollback branch.
- The `production` ruleset requires `app-smoke`, `ci-tests`, GitHub AI Review (`ai-review`, or legacy `claude-review` during the transition), `pr-title`, `next-public-secrets`, and `secret-scan`. CI Tests normally reports after the pr-feedback timer applies the `full-ci` label on review success. The speed checks were retired with the 2026-08 staging rename; no `[SPEED]` gate exists today.
- Gitleaks (`secret-scan`) scans only the commits a change adds: a pull request scans base..head, and a push scans the previous tip..new tip (a new branch, or a force push whose old tip is gone, scans everything not on `production`). A finding on one branch therefore cannot turn other branches red. Branch deletions are not scanned.
- Auto-merge uses the newest result for each check name. This lets a current provider-portable compatibility check supersede an obsolete reviewer failure on the same backlog commit; the exact-commit `APPROVE` comment is still mandatory.
- Auto-merge keeps all scratch state in a unique directory under `RUNNER_TEMP`. A PR read, diff read, or merge that still fails after retries makes the workflow fail visibly; an incomplete sweep must never report green.
- Vercel previews are optional. Merge to `production` deploys production; a failed deploy build keeps the previous deployment live.
- Do not add another runner host, VPN, required preview, or paid hosted fallback without a recorded decision.

## Live QA and wireframe capture

[YPER4-544](https://app.hypertask.ai/detail/project-4060/544) adds three non-required workflows on `ubuntu-latest`; no new host, preview deploy, application build or merge gate:

- `live-qa.yml`: `workflow_dispatch` only, original repository + exact production ref, immutable `github.sha` checkout, `contents: read`, 20-minute bound, environment `live-qa`. `mode=run` validates a reviewed ticket script/manifest, expected live SHA and successful public GitHub Production deployment before login. Only the login step receives `QA_LOGIN_EMAIL`/`QA_LOGIN_PASSWORD`; it reuses `/api/auth/qa-login`, verifies 985 and writes private temporary state (directory 0700/file 0600). Installs use `npm ci --ignore-scripts` with no login secret. The test process receives an explicit safe environment and suppresses raw Playwright diagnostics. Its fixture blocks non-GET browser requests without an allowlisted board ID, WebSockets and service workers. This is defense in depth, not server authorization; reviewed scripts must prohibit unguarded clients/contexts, unrelated task IDs, billing/email and shared-data cleanup. Empty board lists are read-only. The bootstrap script checks identity only; ticket authors add real feature-map cases.
- `wireframe-capture.yml`: path-filtered `pull_request` to production plus manual dispatch, no secrets/environment, readonly token, 10-minute bound. `scripts/wireframe-capture-allowed.json` explicitly registers `docs/wireframes/<TICKET>/index.html`; it starts empty because this is not a UI ticket. PRs capture changed registered ticket directories (all registered pages when capture code/manifest changes), at most ten per run. Static assets stay under each realpath-checked ticket directory, served on loopback; external browser requests/redirects and WebSockets are refused. Four named themes and desktop/phone produce eight PNGs per page, each below 3 MiB. Only public, unauthenticated mockups belong here, never screenshots copied from a customer's board.
- `live-qa-secret-scope.yml`: tiny PR-only absence probe with no checkout or environment. It asserts that neither legacy email/password nor compound QA login credentials are accessible at broad scope. Only `secret-present=false` is success; `true` fails. It does not prove environment policy or inspect any secret value.

Live QA rechecks the deployment after tests, records 1440x900 and 390x844 video, and disables traces/HAR. Only generated PNG/WebM plus sanitized proof/metadata enter a clean evidence directory; raw test reports, auth state, logs and arbitrary files are excluded. Both viewports need a screenshot and video for a successful capture. Test failures can produce encrypted FAIL/UNREACHABLE evidence; dependency, validation and login failures produce no artifact and are not product failures. Media is tarred and age-encrypted to `scripts/live-qa/evidence-recipient.txt` before the only upload. The placeholder `age1REPLACE_WITH_PUBLIC_KEY` deliberately fails before login. Encryption failure means no upload. Ubuntu's `age` package is installed without login credentials. Artifact `live-qa-<TICKET>-<RUN_ID>-<ATTEMPT>` contains only `live-qa-evidence.tar.age`, expires in seven days, and has no plaintext fallback. Plaintext/session state is removed even on failure; runner teardown is the cancellation backstop. Wireframe PNG artifacts use `wireframe-<RUN_ID>-<ATTEMPT>`, also seven days. Inspect decrypted media before any ticket attachment; local evidence and ticket attachments have their own longer-lived retention policy.

Production-health's existing automatic push smoke also declares `live-qa` and the exact production/repository guard. Its health/smoke/core-actions rollback DAG and production triggers are unchanged. Both workflows share concurrency `live-qa-account-985`, with cancellation disabled; Actions can replace pending runs, so the owner must detect cancellation and deliberately redispatch (not assume FIFO). Existing production-health diagnostics/artifacts are unchanged; the encrypted-only guarantee applies to the new live-QA workflow, not a retrofit of monitoring.

### One-time administrator setup (not performed by this change)

1. Before provisioning login secrets, require trusted review of production changes to `.github/workflows/**`, `scripts/live-qa/**`, `e2e/live-qa/**`, `playwright.config.live-qa.ts`, `e2e/smoke/lib/qa-session.ts`, `package.json` and `package-lock.json`. Add CODEOWNERS entries for trusted maintainers and enforce code-owner approval through the production ruleset; a CODEOWNERS file alone is not protection. No workflow may execute PR-selected code with the login. Existing branch review enforcement has not been verified here.
2. Create environment **live-qa** in `hypertask-ai/hypertask`, with **Selected branches and tags**, exactly one **branch** rule `production` (no tags or wildcards). API equivalent: `deployment_branch_policy: { protected_branches: false, custom_branch_policies: true }`, then branch policy `{ name: "production", type: "branch" }`. **No required reviewers or per-run approval/wait timer**: Valentin approved unattended production smoke and manual dispatches. Never broaden the branch policy to make a run work.
3. Copy the existing server-configured QA-985 `QA_LOGIN_EMAIL` and `QA_LOGIN_PASSWORD` into that environment using the authorized secret provider via stdin, then delete repository-level copies and remove applicable organization-level copies/access. Do not change server configuration, rotate the password implicitly, or copy Valentin's login. Until broad-scope copies are removed, same-repository PRs remain able to request them; adding an environment alone is insufficient. Do this coordinated migration after the guarded workflow is deployed so automatic smoke remains provisioned.
4. Generate a QA-evidence-only age key pair on an authorized operator machine, store the private identity in 1Password, and commit only its public `age1...` recipient in place of `scripts/live-qa/evidence-recipient.txt`. Never put the private identity in GitHub, a command argument or the repo. The runner later reads it once into `download.sh` stdin. No secret/settings changes are made by these scripts.
5. After setup, an authorized owner records actual run URLs/SHA/attempt and boolean output for a **same-repository PR** and a fork PR (`false`), a production `mode=probe` dispatch (`true`), and wrong-ref rejection. Independently prove that a non-production job requesting the environment is denied by its branch policy, not just skipped by an `if`. Run a real allowlisted capture, download/decrypt and inspect both viewports/video; confirm production-push smoke completes unattended and rollback dependencies remain available. Static source tests cannot prove GitHub environment settings, secret migration, public deployment metadata availability or real media quality. These operational checks remain required handoff evidence, not a claim that setup/live QA already passed.

### Dispatch and retrieve

Use `.claude/skills/verify-qa/SKILL.md` for the short `gh workflow run` / exact-run correlation / `download.sh` flow, and `.claude/skills/wireframe/SKILL.md` for static dispatch/download. Supply a full expected deployed SHA; scripts must already be reviewed on production. Set `mode=probe` with the same dispatch inputs to check boolean login presence without logging in or installing code. The probe references secrets only in a boolean expression; capture references their values only in its login step. The QA route uses permanent owner-or-QA access, not the removed `htpr-6536-qa-login` flag.

`download.sh TICKET RUN_ID ATTEMPT` requires an age identity **on stdin** and extracts only allowlisted regular files to `~/.local/state/vcc-evidence/<TICKET>/<RUN_ID>-<ATTEMPT>/` with private permissions; it never overwrites an existing run. Do not attach the encrypted bundle as proof or mistake an automatic capture PASS for acceptance. The owning session still reviews media, records feature-map cases, flags/account/deploy/code SHAs, builds the report and attaches evidence through `vcc`. No GitHub job receives a board-write credential. This production flow does not replace PR-head premerge evidence.

Rollback: disable/cancel the new capture workflows and queued runs with owner authorization; block/remove environment login access if necessary. Delete exposed artifacts/attachments after an incident. Credential rotation does not itself revoke minted session cookies: use supported session revocation separately. Never restore repository-level login secrets or weaken production policy as a fallback. Do not disable production-health automatically as part of capture rollback.

## Visual regression gate

`visual-regression` screenshots the five screens a user lands on (board, task detail, search, inbox, and the Ctrl+K palette) at 1440 and 390 wide in the `amoled` and `porcelain` themes, and fails when pixels move without an approved baseline. It catches the change that typechecks, lints and tests green and still puts an unwanted control on screen; [HTPR-5649](https://app.hypertask.ai/detail/project-15/5649) shipped an archived-results checkbox into search that way.

- The job builds and serves the application itself against a throwaway PostgreSQL container on its GitHub-hosted runner. It does not screenshot a Vercel preview: previews are opt-in here, and auto-merge treats a required check with no run exactly like a failing one, so a preview-triggered required check would freeze merging on every pull request.
- The check reports success on a pull request that changes no pixel-affecting file, which is what makes membership of the auto-merge required list safe. Never add a name to that list unless its job reports on every pull request.
- Chromium runs inside the pinned `mcr.microsoft.com/playwright` image rather than on the runner, so a baseline generated on a developer machine matches one generated in CI. Fonts and the Chromium build are the same in both places.
- The fixture comes from the demo provisioner with the guest prefix removed, so the screenshots show the ordinary signed-in chrome against a realistic board without any network credential.
- Reference images live in [`visual/baseline/`](../visual/baseline). Regenerate them with `node visual/harness.mjs update`, and prove the gate can still fail with `node visual/harness.mjs control`, which injects an unapproved control and expects a red run.
- `.github/scripts/visual-baseline-guard.mjs` rejects any pull request that edits `visual/baseline/**` unless its body carries a `## Visual change` heading. Without that rule a pull request could approve its own regression by committing new pixels.
- The search screenshot pins the search chrome, not result rows: results come from Turbopuffer, which a self-contained job has no key for.

## Layout lock matrix (YPER4-252)

`browser-smoke` also runs `e2e/smoke/layout-lock-matrix.spec.ts`, once with live-like flags and once with every flag on. It opens the ticket page (short and long comment thread), board, inbox and search once per sidebar state (AI sidebar open or closed, left sidebar collapsed or expanded) and resizes the window through 1920, 1440, 1280, 1100, 950, 768 and 390 wide. Each main part (title, description, comment list, comment box, properties panel, board columns, left sidebar, AI sidebar) is compared with `e2e/smoke/layout-lock-matrix.baseline.json`. A part that moves more than 8px, changes column, wraps below its neighbour, or leaves the comment box above the last comment fails with `<page> @ <width>px, AI sidebar <open|closed>, left sidebar <collapsed|expanded>: <part> moved <dx>,<dy>px`. Failing runs upload an "after" screenshot with the baseline boxes outlined (artifact `layout-lock-matrix`).

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
