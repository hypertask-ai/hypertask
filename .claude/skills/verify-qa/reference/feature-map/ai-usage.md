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

## Local daily usage check

Sources: `src/lib/ai/dailyAiSpend.ts`,
`src/app/api/cron/ai-spend/route.ts` and `vercel.json`.

The paid allowance drift checker and background billed-snapshot refresh are
removed by YPER4-873. The old `/api/cron/ai-allowance-drift` endpoint and
five-minute schedule no longer exist. Do not turn on either existing
HTPR-7692 switch for verification.

The hourly `/api/cron/ai-spend` endpoint requires the existing cron authority.
It sums today's and yesterday's non-BYOK, nonnegative saved `AiUsage.costUsd` records in UTC.
The previous day is checked too, so late usage is not lost at midnight.
An estimate over $5 raises the existing daily-spend incident fingerprint.
Empty priced usage is zero; database failures return 503, not a clean result.
This check makes no provider requests. It is an estimate from saved token
usage, not invoice reconciliation or proof that every provider cost is logged.
Rows without pricing are not included.

- Doctor: successful Production deployment for this PR and signed-in QA985.
- Require HTTP401 from the new cron without authority, before any usage read.
- Verify the retired endpoint is absent on the merged deployment.
- Verify the authenticated new cron returns a local recorded-usage result.
  Never buy provider reports or change production flags to create a fixture.
- Hosted tests exercise the real cron dispatch with a provider-network trap,
  the $5 boundary, UTC day bounds, empty usage and fail-closed reads.
- Foreground allowance admission, settlement and on-demand Settings reports
  remain unchanged. Their existing tests must pass in hosted CI.
- Save actual provider funding history over the required 24-hour window before
  claiming no top-up. Local token costs do not prove funding history.
