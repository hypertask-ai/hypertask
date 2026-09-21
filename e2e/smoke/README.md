# Production smoke QA (HTPR-6199)

Runs in the `smoke` job of `.github/workflows/prod-health.yml` after every
production push and in the required `browser-smoke` job of
`.github/workflows/ci-tests.yml` against a local candidate build. The run is
read-only: it opens views and never submits a form. CI sets `BASE_URL` to the
loopback server; production keeps using `SMOKE_BASE_URL`.

## Account and secrets

The job signs in through `/api/auth/qa-login` as the dedicated QA robot account.
It needs the same repository secrets as the production TestSprite workflow:

- `QA_LOGIN_EMAIL`
- `QA_LOGIN_PASSWORD`

Setup mints fresh session cookies on every run and saves them only in the
runner's ignored `.state` directory. Cookies and authenticated traces are never
logged or uploaded.

The account must own one board with at least two seeded cards. Setup reads the
board ID returned by login, confirms the cards through the authenticated board
API, and writes the board and task paths for the view checks. A missing login,
bot challenge, board, or seeded card makes the job fail as unrunnable and can
never authorize rollback.

## Selectors

Each view in `prod.spec.ts` asserts one route-specific DOM element from the
component that renders it. This stops a blank or generic app shell from passing.
If a selector goes stale after a UI change, update that view's `selector` field.

The inbox marker is `display:none` by design, so its check asserts presence
instead of visibility. Every other view's element must be visible. Each view
also fails if its main frame performs another full navigation during the first
30 seconds after load.
