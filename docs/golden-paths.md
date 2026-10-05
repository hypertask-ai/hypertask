# Production golden paths

Monitor for https://app.hypertask.ai/detail/project-4060/198.

`.github/workflows/golden-paths.yml` runs independently of deployments at minute
17 every two hours, plus manual dispatch. It uses Node 24 and built-in modules
only. It never rolls back production or creates accounts, boards or credentials.
Missing configuration reports `NOT CONFIGURED: <name>`, fails the job and is
included in the one aggregated Telegram failure alert. Missing Telegram secrets
fail visibly in logs and the job summary, but cannot deliver an alert.

## Accounts and exact secrets

An operator must supply **two existing, dedicated health accounts**, not
Valentin's account or an agent token:

- One legacy account **with a Firebase uid**.
- One account **without a Firebase uid** (`uid` null or empty), covering the
  regression where `/oauth/authorize` rejected that identity.
- Both must have access to **one dedicated sandbox project only**, with at least
  two columns and permission to create, comment, move, archive and delete tasks.
  Do not use product board 15, infra board 4060 or a real user's workspace.
- Use dedicated Gmail or Google Workspace mailboxes matching the accounts'
  email addresses. Both accounts must already support ordinary email-OTP login.
  The script does not sign them up. The existing QA password route is restricted
  to user 985 and is not a general health-account login mechanism.
- Enable the Gmail API in an operator-managed OAuth project. Authorize each
  mailbox for offline access with `https://www.googleapis.com/auth/gmail.readonly`.
  Use an OAuth consent configuration whose refresh tokens do not expire after
  seven days in external testing mode. These credentials can read only the
  dedicated health mailboxes, never an employee's inbox.
- Give the sandbox team enough normal managed AI allowance for a tiny chat
  reply every two hours. No AI provider key, paid-model override or QA bypass is
  used. The normal app model selection and plan checks apply.

GitHub repository secrets, all consumed by the script:

| Secret | Value |
| --- | --- |
| `HYPERTASK_HEALTH_FIREBASE_EMAIL` | Existing health account email with a Firebase uid |
| `HYPERTASK_HEALTH_NO_FIREBASE_EMAIL` | Existing health account email without a Firebase uid |
| `HYPERTASK_HEALTH_FIREBASE_MAIL_REFRESH_TOKEN` | Gmail readonly offline refresh token for the first mailbox |
| `HYPERTASK_HEALTH_NO_FIREBASE_MAIL_REFRESH_TOKEN` | Gmail readonly offline refresh token for the second mailbox |
| `HYPERTASK_HEALTH_MAIL_CLIENT_ID` | Google OAuth client ID used by both mailbox grants |
| `HYPERTASK_HEALTH_MAIL_CLIENT_SECRET` | Corresponding Google OAuth client secret |
| `HYPERTASK_HEALTH_PROJECT_ID` | Dedicated sandbox project ID, shared by both accounts |
| `TELEGRAM_BOT_TOKEN` | Existing production alert bot token |
| `TELEGRAM_CHAT_ID` | Existing production alert destination |

No stored MCP token, Firebase admin key, app session signing secret, Vercel
firewall bypass secret or Valentin credential is needed. This change defines
configuration only. It does not create the accounts or set any secrets.

## How headless login works

Every run refreshes each **mailbox** token, verifies its email through Gmail's
profile API, and requests a normal sign-in code at
`/api/auth/email-otp/send-verification-otp`. It polls only new Hypertask sign-in
mail after that request, extracts the six-digit OTP and submits it to
`/api/auth/sign-in/email-otp`. Like the web client, it then calls
`/api/auth/bridge-legacy-session`, retaining the server-issued Better Auth,
`ht_session` and `nookies_user` cookies. It checks identity, uid shape and the
sandbox-only board scope. Neither the mailbox grant nor the user cookie is a
substitute for a signed app session.

The QA scripts under the 2026-10-03 evidence for
https://app.hypertask.ai/detail/project-15/6894 reuse Playwright storage state
for user 985; that would miss fresh login failures. Normal password sign-in is
disabled in Better Auth. Email OTP needs no browser and covers both account
shapes through the same supported login surface.

The MCP client discovers `https://mcp.hypertask.ai/.well-known/oauth-protected-resource`
and the advertised authorization server metadata, dynamically registers a
public client, generates PKCE S256 and state, and requests authorization with
that fresh signed session. It loads the consent form and submits the signed
consent token. The `/oauth/success` handoff contains the callback URL, so no
loopback listener or browser is needed. The callback URI, state and code are
validated before exchange. If a refresh token is issued, it is exchanged too.
Currently the server issues refresh tokens only for the native mobile redirect;
this standard loopback MCP client usually receives only an access token.

Each account exercises MCP initialize, initialized notification, core tool
catalog and task operations. Catalog selection follows the live consolidated
or legacy tools. REST repeats create, comment, move, readback, archive and trash
through `app.hypertask.ai/api/mcp`. The released Linux x86_64 CLI binary is fetched
from `hypertask-ai/cli/releases/latest`, checked against GitHub's SHA-256 asset
digest, and uses the fresh no-uid token on `api.hypertask.ai`. CLI deletion is
`task update <id> --status Deleted`, the native CLI's supported trash operation.
AI chat uses the fresh signed-in Firebase health session on the same create,
stream and delete endpoints as the web client. A non-empty content event and a
successful done event are required, not merely HTTP 200.

## Cleanup and reporting

Task operations always run sandbox-scoped cleanup in `finally`. A unique title
recovers a task if a create succeeded but its response was lost. Cleanup marks
only that run's task `Deleted` using the API, with three bounded retries. Trash
is the product's supported delete contract, not permanent erasure. The CLI
binary and temporary home are removed, and the created AI session is deleted
in `finally`. The AI delete endpoint may create an empty replacement session
if it was the account's last session, matching normal app behavior.

Fresh owned OAuth clients are deleted via `/api/connections/<clientId>` and
Better Auth sessions are signed out after the probes. If authorization fails
before code exchange claims client ownership, that deletion API returns 404;
there is no public API for deleting an unowned registration. Such a failed
login remains red and alerts, while the unowned registration may remain. No
database cleanup or identity-wide token revocation is attempted.

Read requests retry up to three times. Writes, code exchanges, refreshes and
Telegram sends are not automatically retried, avoiding duplicate writes, code
reuse and duplicate alerts. Vercel bot challenges are failures, never bypassed.
Every named step records duration, URL without query secrets, status and a
redacted error excerpt in logs and the GitHub job summary. All failures are
aggregated into **one Telegram alert**; there is no green message on failure.

On the first successful run after 07:00 UTC each day, a short green summary is
sent. `GOLDEN_PATHS_STATE_FILE` is a non-secret receipt in `runner.temp`, restored
and saved with the Actions cache. Concurrency serializes runs. A receipt is
written only after Telegram accepts the green message. Cache eviction can cause
an extra green summary, but cannot suppress one; a run failing after 07:00 sends
a red alert, with green deferred until a successful run. If no daily green or
red arrives, inspect the workflow's latest run: an in-job monitor cannot alert
if GitHub scheduling itself stops.

Safe, credential-free production check, with no login or writes:

```sh
node .github/scripts/golden-paths.mjs --only=mcp-discovery,api-reachability
```

Local mock integration suite:

```sh
node scripts/run-tests.mjs tests/golden-paths.test.cjs
```
