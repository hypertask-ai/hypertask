# Production smoke QA (HTPR-6199, journeys added HTPR-6636 phase 2)

Runs in the `smoke` job of `.github/workflows/prod-health.yml` after every
production push. That job only ever runs `prod.spec.ts` (`Desktop`/`Mobile`
projects) and stays read-only: it opens views, it never submits a form.

The other projects in `playwright.config.smoke.ts` — `journeys-setup`,
`journeys`, `mobile-journeys`, `demo` — add write journeys (create/edit a
task, comment, drag a card, AI chat, guest demo access) run separately by
`~/projects/hypertask-qa-runner` against three tiered customer accounts,
never by `prod-health.yml`. They're opt-in via `HT_QA_JOURNEYS=1` /
`HT_QA_RUN_DEMO=1`, so a plain `npx playwright test` run with neither set
just skips every write test — see "Write journeys" below.

## Secrets/vars this job needs

- `QA_LOGIN_EMAIL` and `QA_LOGIN_PASSWORD` (existing secrets): the server's
  QA-only `/api/auth/qa-login` credentials. Global setup logs in afresh on
  every post-deploy run, verifies user 985, then saves all server cookies in
  a runner-local file with mode `0600`. It cannot sign in as Valentin (6).
  `SMOKE_SESSION_STATE` is no longer used by this job. Its static cookies and
  client user state could expire or drift independently; recapturing it was
  a manual operation, not a renewable login.
- `AUTOMERGE_TOKEN` (existing secret): reserves daily per-cause notification
  keys in repository variables. The workflow concurrency lock serializes
  runs; a dedup-store failure keeps evidence in the summary instead of risking
  duplicate delivery.
- `HYPERTASK_MCP_TOKEN` (existing agent ticket mechanism): creates or updates
  one monitoring ticket per setup cause on board 4060, at most once daily.
  Failure to record a ticket remains a job annotation and summary.
- The workflow pins `SMOKE_BOARD_PATH` to `/project?id=6121&surface=board`
  and `SMOKE_TASK_PATH` to `/detail/project-6121/1`: the existing private
  "Midscene nightly QA fixture" board and "Midscene persistent browser target"
  ticket, both owned by QA user 985. These checks only read this fixture.
  The old repository vars point at QA user 2343's private board, which user
  985 cannot access, so post-deploy smoke no longer reads those vars.

Post-deploy runs set `SMOKE_POSTDEPLOY=1`. Both paths are required: a missing
fixture is not a passing test. On desktop and phone, the board check clicks
that card, asserts its actual title and body, and observes it staying open
for ten seconds without reloading. No ticket content is changed.

## Required PR browser check

`browser-smoke` runs the same spec against a locally built app on a hosted runner,
with `BASE_URL=http://127.0.0.1:3100` and `BROWSER_SMOKE_PR=1`. It watches both
board-data endpoints after the first load and checks the columns every 250 ms
for 30 seconds. It also clicks the seeded ticket at 1440x900 and 390x844,
checks its actual title and description, and keeps checking the detail URL and
visible content for three seconds without a document reload. The optional pages
request is deliberately left pending to prove it cannot hold back the ticket.
It never opens `/demo`: that route creates a guest.

Every run starts an empty PostgreSQL service and a dedicated local Soketi
realtime service. `scripts/seed-browser-smoke.mjs` creates a plain local user,
two boards with columns, and a fresh signed localhost session. The state file
is runner-local with mode `0600`; it is never printed or uploaded. The job
does not read repository secrets or production configuration, so code from a
pull request cannot reach a production account, database, signing key, or
realtime service through this check.

The seed copies `production-flag-modes.json` into the local database, including
all released `EVERYONE` modes. This dated snapshot comes from a read of the live
admin API; refresh its keys, modes and capture date when production release
modes change. The browser asserts the app's flag response matches those modes
for its plain user. A second card-click run uses `--instant-open-control` to
turn on only the instant-open flag in the disposable database, so a temporary
production OFF mode cannot conceal the PR #997 regression. Neither run changes
production flags or uses a production session.

The query-string realtime override works for automated browsers only on
`localhost` and `127.0.0.1`. Production automation remains disconnected from
hosted realtime even if it adds `?realtime=on`.

`browser-smoke` is required by the production ruleset, the live-ruleset
assertion, and automerge. A failed or missing result blocks merging.

## CI container images

CI pulls the exact official images from `ghcr.io/hypertask-ai/ci-<image>`:
PostgreSQL `16-bookworm` and `16-alpine`, Redis `7-alpine`, Node
`22-bookworm`, and Soketi `1.6-16-alpine`. Tags and immutable digests are
recorded in `.github/ci-images.json`; the copy preserves the full manifest
and all architectures without rebuilding or changing labels.

`ci-images.yml` copies the pinned official Docker Hub and Quay sources on
manual dispatch and every Monday. It publishes with this repo's
`GITHUB_TOKEN` (`packages: write`), which automatically links new packages
to the repository and grants its workflows access. Do not replace it with
a personal token or remove the repository's Actions access in package
settings. A separate `packages: read` job proves every pinned image can be
pulled. CI uses that read-only permission with `docker/login-action` for
command-line pulls and `services.credentials` for services, which start
before workflow steps. Registry credentials stay on the host and are never
mounted or passed into the isolated candidate containers.

Bootstrap order: a push trigger restricted to `yper4-231-ghcr-ci-images`
seeds and verifies the packages before the consumer switch is pushed.
GitHub cannot dispatch a new workflow until it exists on the default branch;
after this single PR is merged into `production`, manual dispatch and the
weekly schedule work normally. Require a successful mirror run, including
all five read-only pulls, before merging. There is no automatic fallback
that silently reintroduces anonymous pulls.

Fallback for a GHCR outage: explicitly revert only the CI image references
to `public.ecr.aws/docker/library/<image>:<tag>@<same digest>` (Soketi uses
`quay.io/soketi/soketi:<tag>@<same digest>`), then rerun the checks. Both
Docker Hub and anonymous ECR Public pulls can be throttled, so this is a
temporary, visible recovery choice, not the normal path. For a missing copy,
rerun `Mirror CI images` instead of weakening the digest pin. Keep
`app-smoke`, `browser-smoke`, and `ci-tests` required; production deploy
configuration is not changed by this image mirror.

## Selectors

Each view in `prod.spec.ts` asserts one route-specific DOM element (a
`data-`/`id` attribute or class read straight from the component that
renders it — see the comment above each `VIEWS` entry for the source file).
This is what stops a blank or generic app shell from passing. They're
verified against the current component source and the live QA Sandbox.
If a selector ever goes stale after
a UI change, the fix is a one-line update to the `selector` field for that
view, not a redesign of the check.

The PR job creates its separate account and boards only inside the disposable
CI database.

One nuance: the inbox marker is `display:none` by design, so it asserts
presence (`toBeAttached`) instead of visibility; every other view's element
must actually be visible.

## Session renewal and alert policy

Post-deploy login is self-renewing through the existing QA-only password flow.
The server checks the fixed QA identity and the `htpr-6536-qa-login` flag.
If login is unavailable, check that flag and the existing QA secrets; never
replace them with Valentin's credentials or extend a signed cookie manually.
Local post-deploy runs also require these two QA environment variables.

An unrunnable check fails visibly but never sends Telegram or contributes to
consecutive smoke reds. Confirmed live failures and rollback operations retain
Telegram, at most once per UTC day for each cause across SHAs and reruns.
Runner-only challenges, unit-test failures, healthy-site build/drift problems and QA setup failures go
into infrastructure tickets and job evidence instead. Provider status alone is
not a confirmed live-site failure. The classifier sends the smoke notification;
the consecutive alarm records the incident and authorizes guarded rollback,
without a second Telegram or a recovery message.

Never print, commit or upload the state, and never use Valentin's login.
Manually prove the browser step on a non-production branch without data
writes or rollback. The existing input disables the core-actions write probe;
its provisioning job is restricted to the production ref, so it also skips:

```bash
gh workflow run prod-health.yml -R hypertask-ai/hypertask --ref <non-production-branch> -f provision_core_actions=true
```

Do not use that input on production unless you intend to provision the
core-actions fixture. A normal production dispatch also runs core-actions.

For a local read-only run with the same suite:

```bash
umask 077
mkdir -p e2e/smoke/.state
cp ~/.config/hypertask-videos/storageState-qa-normal.json e2e/smoke/.state/smoke-state.json
SMOKE_BASE_URL=https://app.hypertask.ai SMOKE_POSTDEPLOY=1 \
  SMOKE_BOARD_PATH='/project?id=6859&surface=board' \
  SMOKE_TASK_PATH='/detail/project-6859/43' \
  npx playwright test -c playwright.config.smoke.ts --project Desktop --project Mobile
```

## Write journeys (HTPR-6636 phase 2)

`journeys.spec.ts`, `journeys.setup.ts` and `demo.spec.ts` create, edit and
delete real data — approved ONLY on a private board named exactly
`"QA runner board"` (see `lib/boardSetup.ts`), owned solely by the test
account, no other members. `journeys.setup.ts` finds or creates that board
and refuses (fails loud) if it has any other member.

Env vars these read:

- `HT_QA_JOURNEYS=1` — required to run anything in the `journeys-setup` /
  `journeys` / `mobile-journeys` projects; every test in them self-skips
  otherwise.
- `HT_QA_TIER` (`free` / `light` / `premium`, free-form) — tags test ids
  and ticket titles per account. Optional; omit for a single untiered
  account.
- `HT_QA_EXPECTED_PLAN` — the plan label expected in `/settings/billing`
  for this tier (e.g. `Free`, `BYOK`, `Pro` — see
  `src/lib/subscriptionPlans.ts`). The "plan shows correctly" test skips
  itself with a clear reason when unset, since the free/light/premium to
  Free/BYOK/Pro mapping isn't confirmed yet.
- `HT_QA_RUN_DEMO=1` — required to run `demo.spec.ts`'s guest-access test
  (tag `@demo`). It creates its own unauthenticated context regardless of
  storageState. Not gated to a single run per se — the caller (the QA
  runner) is responsible for only setting this once per deploy, since
  `/api/demo/guest` rate-limits at 5 guest creations per IP per hour.
- `HT_QA_NO_ACCOUNT=1` — tells `global-setup.ts` to skip its login
  precheck, for a demo-only invocation that carries no account state at
  all.

Every test tags itself `@id:<name>` (tier-prefixed when `HT_QA_TIER` is
set) — the stable id `hypertask-qa-runner`'s `lib/process-report.mjs`
dedups tickets on, read from Playwright's own `spec.tags`, not the test
title (which changes per tier).

Cleanup: every task a journey creates is deleted in its own `afterEach`
(soft-delete via `/api/queues/tasks/taskDeleteReminder`, then a hard
delete via `/api/tasks/deleteTask` — see `lib/api.ts`). `journeys.setup.ts`
also sweeps any `[qa-runner]`-prefixed task older than an hour before the
journeys run, in case a previous run crashed before its own cleanup.
