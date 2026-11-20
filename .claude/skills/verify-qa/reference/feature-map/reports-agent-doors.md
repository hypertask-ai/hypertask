# Board report agent doors

## Sub-features

- `board-report-agent-doors` Board report agent doors.
- `reports-home` Signed-out visitors to `/report` (`src/app/report/page.tsx`) are sent to `/login`. A signed-in person sees the heading Reports and the line `Saved reports and board velocity in one place.` Saved rows are reports on boards they can see. Each row links to `/report/<projectSlug>/<reportSlug>`. An empty list says `Reports are created by asking the AI chat or an agent.` A Velocity section lists one row per visible board.
- `saved-report` `/report/<projectSlug>/<reportSlug>` (`src/app/report/[projectSlug]/[reportSlug]/page.tsx`) shows that saved report's title, description when it has one, board name, updated time, creator, and HTML body. The board segment is the project slug, such as `project-15`. A slug that normalizes to empty, a project id that is not a positive integer, or a report the user cannot see does not render the report. Signed-out visitors go to `/login`.

## How to get to it (user POV)

Two MCP read and write doors on the existing `hypertask_report` tool, both backed by the same computation the board report screen uses.

- Board speed report numbers: `GET /api/mcp/reports/velocity?project_id=<id>` (action `velocity`). Flag `htpr-8219-velocity-report`.
- Board status update draft: `POST /api/mcp/reports/status-update` with `{ project_id, range }` (action `status_update`). Flag `htpr-8219-status-update-door`. It writes the same saved `status-update` report the board report screen's button writes.

Saved reports and the velocity list live at `/report`. One saved report lives at `/report/<projectSlug>/<reportSlug>`. The velocity screen stays at `https://app.hypertask.ai/report/<projectSlug>/velocity` (board 15 is `project-15`). Both doors are flag-gated server-side; with a flag off the route answers 404 `{"success":false,"error":"Not found"}` and every other report action keeps working.

## Driving it with agent-browser

Both doors need an agent token, not a human session, so a cookie-only QA run proves the door is
refused and the pages render, and records the doors as `verified-unreachable` until an agent
token on board 15's team is in hand:

```bash
curl -s -w '\nHTTP %{http_code}\n' "https://app.hypertask.ai/api/mcp/reports/velocity?project_id=15"
# want: {"error":"Unauthorized"} HTTP 401
```

With a token, `curl -H "Authorization: Bearer <agent token>" "https://app.hypertask.ai/api/mcp/reports/velocity?project_id=15"` compares `report.totals` and `report.speed` with the numbers the velocity screen shows for the same board and range.

For the status update, `curl -X POST -H "Authorization: Bearer <agent token>" -H 'content-type: application/json' -d '{"project_id":15,"range":"7d"}' https://app.hypertask.ai/api/mcp/reports/status-update`, then open `https://app.hypertask.ai/report/project-15/status-update` and confirm the headline and title match the response `headline` and `title`. The saved page renders the bullets from the report body. A second call updates the same report instead of creating a duplicate.

`scripts/verify-qa`-style evidence: the door response, the screen text, and desktop 1440x900 plus phone 390x844 screenshots.

Page drive, signed in as QA 985:

```bash
ht-verify open /report --wait h1                       # h1 Reports, sentence "Saved reports and board velocity in one place."
ht-verify probe "a[href^='/report/project-15/']" --attr href   # a saved row, e.g. /report/project-15/status-update
ht-verify open "$THAT_HREF" --wait h1                  # h1 matches the saved row's title
ht-verify open /report/project-15/velocity --wait h1    # h1 Velocity
ht-verify shot --session --out report.png
ht-verify shot https://app.hypertask.ai/report --out report-390x844.png --viewport 390x844
```

Signed out, `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://app.hypertask.ai/report`
gives `307 https://app.hypertask.ai/login`. The board segment is the project slug: `/report/15/status-update`
lands on `/unauthorized`, because `parseProjectSlug` reads the id after `project-`.

## Gotchas

- The agent door drifting from the web screen: both must call `loadVelocityReport` in `src/utils/controllers/reports/velocityReport.ts` and `generateStatusUpdateReport` in `src/utils/controllers/reports/statusUpdate.ts`. A second copy of the maths is the bug.
- A new route that is missing from `config/parity/contract.json` and `config/parity/generated-inventory.json` fails `parity-contract-trusted` before it can merge.
- A route missing from `src/lib/aiFeedback/routes.ts` fails `tests/ai-feedback-catalog-filter.test.cjs`.
- A flag with no entry in `e2e/smoke/flag-modes/` fails `tests/shared-lists-build.test.cjs` until `node scripts/shared-lists/build.mjs --write` runs.
- Status updates need a model for the board's team; a team with status updates turned off answers 400, not a half-written report.
- `/report/project-<id>/velocity` is the built-in velocity page, not a saved report at `/report/<projectSlug>/<reportSlug>`. The saved-report page lowercases the slug and strips characters outside letters, numbers, and dashes before it looks the report up.

### What proof to collect

Checklist first, then: the agent door JSON, the matching screen text, desktop and phone screenshots of the report page, the flag-off 404 for each door, and the core inbox cycle (every app deployment). Record the account id and role, never credentials.

### Cleanup

Read-only door: nothing to clean up. The status update door writes one saved report per board; a QA run may edit or delete only the report it created on the QA board.
