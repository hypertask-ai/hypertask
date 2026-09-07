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
