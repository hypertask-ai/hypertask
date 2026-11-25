# Activation analytics

## Sub-features

- `activation-analytics` Activation analytics.
- `daily-funnel-probe` With `htpr-7294-daily-funnel-probe` on, the daily workflow passes `GET /api/cron/funnel-probe-signup` and signs up a fresh mailbox at `funnel-probe.hypertask.app`. Flag off, that gate returns 404 and the workflow stops before signup. Customers have no control for this. Probe mail stays out of customer analytics.

## How to get to it (user POV)

Server-side board creation, agent connection, agent task completion and invitations record activation milestones. Lifecycle email senders record successful delivery. Customers have no analytics controls.

### Daily funnel probe

There is no customer screen. The daily run is the GitHub workflow `.github/workflows/funnel-probe-daily.yml`. It signs up a probe mailbox, reads the stored verification link, and later reads that account's board, task, invite, and connection counts. `POST /api/auth/instant-signup` stores the link only for a probe recipient, and only while `htpr-7294-daily-funnel-probe` is on.

## Driving it with agent-browser

- Doctor: production deployment success, QA 985 signed in on `/my-tasks`, and the core inbox cycle.
- Read `/api/flags` with QA 985 and ordinary QA 2343. Retired activation switches must be absent; other switches remain available.
- Never create customer-looking analytics using synthetic QA identities. QA 985, guest users, configured QA emails, and probe mailboxes are excluded from activation (`src/lib/telemetry/accountCategory.ts`). `isSyntheticAccount` treats `qa`, `guest`, and `probe` as synthetic. A probe account is not activation-eligible while `htpr-7292-shared-account-category` and `htpr-9533-probe-synthetic` are both on. Turning `htpr-9533-probe-synthetic` off lets probe activation through again. With the shared category rule off, `legacyAccountCategory` still labels a probe event `customer`.
- Read the existing `https://hypertask.app/signup-check` aggregate report when its Access service identity is available. Follow [signup-check.md](../ops-map/signup-check.md); do not query ticket data through a database.
- Provider-side event delivery is UNREACHABLE when the runner lacks read access. Record that limit rather than claiming a mock proves live delivery.
- `GET /api/cron/funnel-probe-signup` needs cron authorization (`src/app/api/cron/funnel-probe-signup/route.ts:12-21`). Without it the route answers 401 `{"error":"unauthorized"}` before the flag is read, so a QA runner can only prove the refusal. With cron authority, flag off returns 404 and `{ "ok": false, "disabled": true }`, and flag on returns 200 and `{ "ok": true, "runner": "github-actions", "workflow": "funnel-probe-daily.yml" }`.
- `GET /api/ops/funnel-probe-inbox` and `GET /api/ops/funnel-probe-state` answer only on `https://app.hypertask.ai`, only with cron authorization, and only for a probe email. A missing inbox or state row is 404 with `{ "found": false }`.

### Hands-free drive on production

```bash
node .claude/skills/verify-hypertask/scripts/feature-map-drive.mjs activation-analytics --dir /tmp/feature-map-drive
```

Prints `PASS` or `FAIL` per step, writes `result.json` and screenshots into `--dir`, and ends with
`activation-analytics ok`. It refuses any base except `https://app.hypertask.ai`, uses the `qa-login` identities,
creates only fixtures its own cleanup removes, and never prints a cookie, token or email address.

## Gotchas

- Retiring a gate accidentally bypasses synthetic-account exclusions.
- A shared eligibility change disables payment delivery or durable signup identity delivery.
- Retries emit duplicate events or consume an occurrence before delivery succeeds.
- A probe signup without cron authorization is rejected. More than the hourly probe cap is rejected. Do not send probe mail through a customer address.

### What proof to collect

Live flags responses, signed-in doctor screenshot and core inbox evidence. Keep baseline and final targeted activation, wiring, payment, outbox, intent and account-category test results. Include provider aggregate evidence when reachable, with its snapshot time; a pre-deployment snapshot cannot prove post-deployment delivery. For the daily probe, record the flag mode, the cron status body, and whether a probe email's inbox read returns a verification link.

### Cleanup

The core inbox recipe removes its own fixtures. Read-only flags and aggregate checks need no cleanup.
