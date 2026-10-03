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

- `SMOKE_SESSION_STATE` (secret): Playwright `storageState` JSON for plain
  QA user 2343. Owner + QA user 985 is also accepted, never Valentin (6).
  Refresh before the `ht_session` expires. A missing, invalid or expired
  login fails the job with `not tested: QA login missing/expired`, without
  authorizing rollback of a healthy app.
- `SMOKE_BOARD_PATH` (var): `/project?id=6859&surface=board`, the plain QA
  account's existing QA Sandbox board.
- `SMOKE_TASK_PATH` (var): `/detail/project-6859/43`, an existing card on
  that board. Keep both paths pointing at a card visible to the QA account.

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

## Re-capturing the session

Log in as plain QA user 2343 in a real browser, export Playwright storage
state (`await context.storageState()`) to
`~/.config/hypertask-videos/storageState-qa-normal.json`, then refresh:

```bash
gh secret set SMOKE_SESSION_STATE -R hypertask-ai/hypertask < ~/.config/hypertask-videos/storageState-qa-normal.json
```

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
