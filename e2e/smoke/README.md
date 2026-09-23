# Production smoke QA (HTPR-6199)

Runs in the `smoke` job of `.github/workflows/prod-health.yml` after every
production push. Read-only: it opens views, it never submits a form.

## Secrets/vars this job needs

- `SMOKE_SESSION_STATE` (secret) — Playwright `storageState` JSON (cookies)
  for a dedicated, low-privilege production account. Session cookies last 7
  days (`src/lib/configs/auth.config.ts`), so this needs re-capturing weekly;
  when it expires the job alerts on Telegram instead of rolling back
  (see `e2e/smoke/global-setup.ts`) — that's expected, not a bug.
- `SMOKE_BOARD_PATH` (var) — canonical URL path of the seeded board with a
  couple of cards on the smoke account, e.g. `/detail/project-<id>`.
- `SMOKE_TASK_PATH` (var) — canonical URL path of one seeded task on that
  board, e.g. `/detail/project-<id>/<taskNumber>`.

Without `SMOKE_BOARD_PATH`/`SMOKE_TASK_PATH` the kanban-board and task-detail
checks are skipped (they have nothing real to open) — the other six views
still run. Set them once the seeded account exists.

## PR browser check (not required yet)

`browser-smoke` runs the same spec against a locally built app on a hosted runner,
with `BASE_URL=http://127.0.0.1:3100` and `BROWSER_SMOKE_PR=1`. It watches both
board-data endpoints after the first load and checks the columns every 250 ms
for 30 seconds. It never opens
`/demo`: that route creates a guest and writes to the shared live database.
A human must provision a **plain, low-privilege account** (neither owner id 6
nor QA id 985) with access to an existing normal board and an existing demo
board with columns. Set these repository credentials/configuration before
requiring this check in the production ruleset:

- `DATABASE_URL` (secret) — the same database used by the seeded boards.
- `SESSION_SECRET` or `JWT_SECRET` (secret) — whichever signs production `ht_session` cookies.
- `SMOKE_PLAIN_SESSION_STATE` (secret) — this account's Playwright `storageState`
  JSON containing a current `ht_session` and `nookies_user`; renew when expired.
- `SMOKE_PLAIN_BOARD_PATH` (var) — path of the account's seeded normal board
  (passed to the spec as `SMOKE_BOARD_PATH`; distinct from the production smoke account).
- `SMOKE_DEMO_BOARD_PATH` (var) — path of the existing demo board accessible
  by this account (not `/demo` itself).
- `NEXT_PUBLIC_PUSHER_KEY`, `PUSHER_APP_ID` (vars), `PUSHER_SECRET` (secret) —
  realtime subscription credentials. If production uses a custom Pusher host,
  also mirror its `NEXT_PUBLIC_PUSHER_HOST`, `NEXT_PUBLIC_PUSHER_PORT`,
  `NEXT_PUBLIC_PUSHER_USE_TLS`, `PUSHER_HOST`, `PUSHER_PORT`, and
  `PUSHER_USE_TLS` vars (and cluster vars if applicable).

The job fails rather than skips when any required input is missing, the
session belongs to the owner/QA, or the login preflight redirects. It rewrites
cookie domains only in the runner's ignored state file for localhost; it does
not upload that file. After the credentials and fixtures are available and this job is green, a
follow-up must add `browser-smoke` to the production ruleset and the
`ci-tests` live-ruleset assertion, `docs/ci-policy.yml`, and automerge's
`REQUIRED` list together. None of those gates requires it yet.

## Selectors

Each view in `prod.spec.ts` asserts one route-specific DOM element (a
`data-`/`id` attribute or class read straight from the component that
renders it — see the comment above each `VIEWS` entry for the source file).
This is what stops a blank or generic app shell from passing. They're
verified against the current component source, not against a live session
(the smoke account doesn't exist yet) — if a selector ever goes stale after
a UI change, the fix is a one-line update to the `selector` field for that
view, not a redesign of the check.

One nuance: the inbox marker is `display:none` by design, so it asserts
presence (`toBeAttached`) instead of visibility; every other view's element
must actually be visible.

## Re-capturing the session

Log in as the smoke account in a real browser, then export cookies as
Playwright storage state (`await context.storageState()`), and set it with
`gh secret set SMOKE_SESSION_STATE < state.json`.
