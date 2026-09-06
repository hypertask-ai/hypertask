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

Missing `SMOKE_BOARD_PATH`/`SMOKE_TASK_PATH` fall back to `/all-tasks`, which
still exercises login + rendering but skips the "board with cards" and
"task detail" checks the ticket asks for — set them once the account exists.

## Re-capturing the session

Log in as the smoke account in a real browser, then export cookies as
Playwright storage state (`await context.storageState()`), and set it with
`gh secret set SMOKE_SESSION_STATE < state.json`.
