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

## What usually breaks

- The UI discards the server's actionable message.
- A report-only permissions failure is misreported as a revoked key.
- A managed-key failure blames a customer's key.
- Successful usage disappears or the selected team changes.

## What proof to collect

Save before/after response status and safe payload, the selected team, production log statuses, reload evidence, screenshots in both viewports and all themes, and a short video. Record unavailable live success or permission fixtures as UNREACHABLE; local tests do not substitute for live proof.

## Cleanup

Read-only checks need no cleanup. Never reveal saved keys or authentication state. Key replacement costs money and belongs to Valentin.
