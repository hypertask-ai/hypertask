# Board report agent doors

## How a customer reaches it

Two MCP read and write doors on the existing `hypertask_report` tool, both backed by the same computation the board report screen uses.

- Board speed report numbers: `GET /api/mcp/reports/velocity?project_id=<id>` (action `velocity`). Flag `htpr-8219-velocity-report`.
- Board status update draft: `POST /api/mcp/reports/status-update` with `{ project_id, range }` (action `status_update`). Flag `htpr-8219-status-update-door`. It writes the same saved `status-update` report the board report screen's button writes.

The web screen lives at `https://app.hypertask.ai/report/<projectSlug>/velocity` (board 15 is `project-15`). Both doors are flag-gated server-side; with a flag off the route answers 404 `{"success":false,"error":"Not found"}` and every other report action keeps working.

## How to drive it

Use any agent token, not a human session: `curl -H "Authorization: Bearer <agent token>" "https://app.hypertask.ai/api/mcp/reports/velocity?project_id=15"`. Compare `report.totals` and `report.speed` with the numbers the report screen shows for the same board and range.

For the status update, `curl -X POST -H "Authorization: Bearer <agent token>" -H 'content-type: application/json' -d '{"project_id":15,"range":"7d"}' https://app.hypertask.ai/api/mcp/reports/status-update`, then open `https://app.hypertask.ai/report/15/status-update` and confirm the headline and bullets match the response. A second call updates the same report instead of creating a duplicate.

`scripts/verify-qa`-style evidence: the door response, the screen text, and desktop 1440x900 plus phone 390x844 screenshots.

## What usually breaks

- The agent door drifting from the web screen: both must call `loadVelocityReport` in `src/utils/controllers/reports/velocityReport.ts` and `generateStatusUpdateReport` in `src/utils/controllers/reports/statusUpdate.ts`. A second copy of the maths is the bug.
- A new route that is missing from `config/parity/contract.json` and `config/parity/generated-inventory.json` fails `parity-contract-trusted` before it can merge.
- A route missing from `src/lib/aiFeedback/routes.ts` fails `tests/ai-feedback-catalog-filter.test.cjs`.
- A flag with no entry in `e2e/smoke/flag-modes/` fails `tests/shared-lists-build.test.cjs` until `node scripts/shared-lists/build.mjs --write` runs.
- Status updates need a model for the board's team; a team with status updates turned off answers 400, not a half-written report.

## What proof to collect

Checklist first, then: the agent door JSON, the matching screen text, desktop and phone screenshots of the report page, the flag-off 404 for each door, and the core inbox cycle (every app deployment). Record the account id and role, never credentials.

## Cleanup

Read-only door: nothing to clean up. The status update door writes one saved report per board; a QA run may edit or delete only the report it created on the QA board.
