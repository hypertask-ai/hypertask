# Midscene E2E flow pack — retired

Midscene is retired in favor of the E2B verification fleet (Valentin,
2026-09-15). See `reference/e2b-fleet.md` for the live suite and
[HTPR-6484](https://app.hypertask.ai/detail/project-15/6484) for the port
ticket (which flows below still need an E2B equivalent, plus cron removal).

## The 16 flow names (for traceability)

`e2e/midscene/flows/*.mjs` on `staging` of the legacy private repo
(`hypertask-ai/hypertasks`, formerly `valentinyeo/hypertasks`): all-tasks-loads,
board-comment, board-count-consistency, board-demo, board-edit-title,
board-move-task, board-priority-set, board-prod-loads, calendar-loads,
inbox-loads, landing, login-screen, search-works, starred-loads,
task-create-demo, task-detail-demo.

## Cleanup paths

Dedicated nightly clone (already gone): `~/projects/hypertasks-qa`. Nightly
log: `~/.cache/midscene-nightly.log`. Cron credentials:
`~/.config/val-staging/credentials.env`. Dashboard to retire:
[https://hypertask.app/qa-flows](https://hypertask.app/qa-flows).
