# Team AI usage

## How a customer reaches it

Open a team board, then Settings > Team > AI usage (`/settings/ai-usage`). The selected settings team controls the request to `/api/settings/ai-usage?teamId=...`; board admins also send `projectId`.

## How to drive it

1. Use QA BYOK user 3412 and its comped team `977c0c91-c14f-47b0-b8bc-933cc751f19d`. Confirm the selected team in the actual request.
2. Read the production report status before diagnosing a saved key. A 401 means rejected authentication; a 403 means insufficient report permissions, not proof of revocation.
3. With `htpr-8008-gateway-key-errors` on, rejected customer keys show a Settings > Bring your own key instruction. Insufficient reporting rights show a permissions instruction. Reload keeps the correct message.
4. Check a successful report on an available QA team: model breakdown and allowance display remain present. Managed/shared failures must not blame a customer's key. Never edit keys, spend funds, change plans or replace a capped key for this check.
5. Check desktop 1440x900 and phone 390x844 in Porcelain, Graphite, AMOLED and Dia. The existing Gateway card must contain readable copy, without moving the settings shell.
6. Off retains the generic failure. Exercise rollback and 403 fixtures in the isolated route/component tests; never flip production modes merely to manufacture coverage.

## Percentage-only allowance copy

`htpr-7919-allowance-percent` keeps the existing monthly percentage bar, reset date, projection, warning colours and at-limit recovery controls. It removes the allowance dollar line and the dollar prefix from automatic-feature usage. The trial comparison table's Pro allowance perk also stops promising a dollar value or overage price. Subscription prices and enforced allowance caps remain unchanged. The money-classified preview defaults to Owner + QA; never widen it to create a test fixture.

As QA 985, compare `/settings/ai-usage` against its actual successful `/api/settings/ai-usage` response: displayed percentage and reset date must match. Reload and capture desktop and phone in every theme. Check 0%, near-limit and capped fixtures through the component regression suite; never spend a real allowance to manufacture a state. Off retains both dollar lines. The Free account can verify its actual cap but does not see the restricted preview; the comped Pro fixture's missing managed key makes its live success path unavailable until that separate issue is repaired.

## What usually breaks

- The UI discards the server's actionable message.
- A report-only permissions failure is misreported as a revoked key.
- A managed-key failure blames a customer's key.
- Successful usage disappears or the selected team changes.

## What proof to collect

Save before/after response status and safe payload, the selected team, production log statuses, reload evidence, screenshots in both viewports and all themes, and a short video. Record unavailable live success or permission fixtures as UNREACHABLE; local tests do not substitute for live proof.

## Cleanup

Read-only checks need no cleanup. Never reveal saved keys or authentication state. Key replacement costs money and belongs to Valentin.

## Automatic reporting cost controls

Sources: `src/lib/ai/gatewayReport.ts`,
`src/lib/ai/dailyGatewaySpend.ts`, and
`src/app/api/cron/ai-allowance-drift/route.ts`.

- Entry point: the authenticated production allowance cron. An unauthenticated
  GET must remain 401; non-production invocations do not read credits.
- Read both `htpr-7692-allowance-drift-check` and `htpr-7692-billed-cost` modes
  through `ht-flag get`; never enable them merely for QA.
- Use production cron logs for the merged deployment to prove hourly
  `ai-gateway-credit-observation` records even while both switches are Off.
  These contain only time, balance, cumulative spend and cumulative funding.
  Missing credentials, malformed metadata or failed credit reads make the cron
  return 503 rather than a false clean result.
- Confirm ordinary Settings reports still load through their existing
  on-demand path. Do not repeatedly buy reports for QA.
- The cron's metered transports share one rolling-hour Redis reservation.
  Foreground admission and resync remain outside this async-local budget.
  The narrower background-only scope requires the ticket owner's approval.
  Prove concurrency, upstream failure, Redis refusal and estimate fallback
  with `tests/yper4-873-paid-reports.test.cjs`; never manufacture paid live
  traffic to fill that budget.
- Prove the $5 alert, day boundary and existing daily fingerprint using
  `tests/yper4-873-daily-spend.test.cjs`. Never spend money to trigger an alert.
- Save actual funding observations or provider credit history spanning at
  least 24 hours. No increase in cumulative funding proves no top-up over
  that observed window; a single balance or a passing fixture cannot.
- Label unavailable production logs and incomplete time windows UNREACHABLE,
  not PASS. Keep the ticket open until its no-top-up requirement is proven.
