# Team AI usage

## Sub-features

- `percentage-only-allowance-copy` Percentage-only allowance copy.
- `local-daily-usage-check` Local daily usage check.
- `usage-attribution-htpr-7851` Usage attribution (HTPR-7851).
- `batch-background-ai` With `htpr-7098-batch-background-ai` on, Slack thread summaries and smart-label backfills that bill a Hypertask gateway key are sent to the Anthropic batch path at half price and finish later. A customer key stays on the instant path. If the batch submit fails, the backfill runs immediately. Off runs both jobs immediately.
- `baseten-byok` With `htpr-7732-baseten-byok` on, a paid team’s Bring your own key screen adds a Baseten row. The row takes a Baseten API key and lists DeepSeek V4.1 Flash, DeepSeek V4.1 Flash Fast, Kimi K3.1 Pro, and GLM-5.3 Flash. The connection test calls DeepSeek V4.1 Flash. Off hides the row, skips Baseten routing, and the test answers “Baseten is unavailable”.
- `own-key-rejected` With `htpr-7751-own-key-rejected` on, chat names the rejected own key and says to update it in Settings, AI, Bring your own key. The named providers are OpenAI, Claude, Google, Moonshot, Z.ai, Alibaba, OpenRouter, custom, and Baseten. That reply shows Retry. A DeepSeek own-key failure keeps its existing refusal. Off keeps the generic chat failure.
- `team-ai-breakdown` With `htpr-7788-team-ai-breakdown` on, Settings AI usage shows one card for every team the viewer owns, plus the open team if it is missing from that list. Each card shows the monthly percentage, By model, By feature, and Most active boards. By member is included only for the team owner, and only when the team is not paying with its own key. Off keeps the single selected-team page.
- `always-use-this-key` With `htpr-8049-always-use-this-key` on, a team owner sees Always use this key on each saved, enabled key in Bring your own key. Turning one on clears the others. The model picker then lists only that key’s models. A request that cannot use the key pauses and says the allowance is not used. Off hides the switch.
- `qwen-max-byok` With `htpr-8207-qwen-max-byok` on, the Alibaba connection test calls Qwen3.8 Max, and the model pickers add GLM-5.3 and Gemini 3.1 Pro Preview. Off tests Alibaba with Qwen3.7 Plus and hides those two models.

## How to get to it (user POV)

Open a team board, then Settings > Team > AI usage (`/settings/ai-usage`). The selected settings team controls the request to `/api/settings/ai-usage?teamId=...`; board admins also send `projectId`.

Bring your own key is Settings > Team > AI > Bring your own key. The Baseten row, the Always use this key switch, and the Alibaba test live on that screen. The named own-key rejection appears in the chat transcript, not on the usage page.

## Driving it with agent-browser

1. Use QA BYOK user 3412 and its comped team `977c0c91-c14f-47b0-b8bc-933cc751f19d`. Confirm the selected team in the actual request.
2. Read the production report status before diagnosing a saved key. A 401 means rejected authentication; a 403 means insufficient report permissions, not proof of revocation.
3. With `htpr-8008-gateway-key-errors` on, rejected customer keys show a Settings > Bring your own key instruction. Insufficient reporting rights show a permissions instruction. Reload keeps the correct message.
4. Check a successful report on an available QA team: model breakdown and allowance display remain present. Managed/shared failures must not blame a customer's key. Never edit keys, spend funds, change plans or replace a capped key for this check.
5. Check desktop 1440x900 and phone 390x844 in Porcelain, Graphite, AMOLED and Dia. The existing Gateway card must contain readable copy, without moving the settings shell.
6. Off retains the generic failure. Exercise rollback and 403 fixtures in the isolated route/component tests; never flip production modes merely to manufacture coverage.
7. For `htpr-7788-team-ai-breakdown`, open AI usage as a team owner. Count one card per owned team. Open By model, By feature, and Most active boards only when that card’s response has rows. Confirm By member is absent for a non-owner and for a team on its own key. Do not change teams.
8. For `htpr-7732-baseten-byok` and `htpr-8049-always-use-this-key`, open Bring your own key on a paid team as the owner. Confirm the Baseten row and the Always use this key switch are visible. Do not save a key, run a test, or turn the switch on. A free plan hides the whole screen.
9. For `htpr-8207-qwen-max-byok`, open the model picker and confirm GLM-5.3 and Gemini 3.1 Pro Preview are listed. Do not run the Alibaba connection test.
10. For `htpr-7751-own-key-rejected`, do not provoke a provider rejection. The on-state copy is “Your {provider} key was rejected. Update it in Settings, AI, Bring your own key.” Retry is the only action on that assistant message.
11. For `htpr-7098-batch-background-ai`, do not start a label backfill or a Slack summary. On sends eligible gateway-key work to the batch path at half price. A customer key, a failed submit, and Off all stay on the immediate path.

### Percentage-only allowance copy

`htpr-7919-allowance-percent` keeps the existing monthly percentage bar, reset date, projection, warning colours and at-limit recovery controls. It removes the allowance dollar line and the dollar prefix from automatic-feature usage. The trial comparison table's Pro allowance perk also stops promising a dollar value or overage price. Subscription prices and enforced allowance caps remain unchanged. The money-classified preview defaults to Owner + QA; never widen it to create a test fixture.

As QA 985, compare `/settings/ai-usage` against its actual successful `/api/settings/ai-usage` response: displayed percentage and reset date must match. Reload and capture desktop and phone in every theme. Check 0%, near-limit and capped fixtures through the component regression suite; never spend a real allowance to manufacture a state. Off retains both dollar lines. The Free account can verify its actual cap but does not see the restricted preview; the comped Pro fixture's missing managed key makes its live success path unavailable until that separate issue is repaired.

## Gotchas

- The UI discards the server's actionable message.
- A report-only permissions failure is misreported as a revoked key.
- A managed-key failure blames a customer's key.
- Successful usage disappears or the selected team changes.
- Team AI usage shows one card, or By member, for a team the viewer does not own.
- Always use this key is switched on during the check, or a Baseten or Alibaba test is sent.
- A customer-key Slack summary or label backfill is treated as proof of the batch path.

### What proof to collect

Save before/after response status and safe payload, the selected team, production log statuses, reload evidence, screenshots in both viewports and all themes, and a short video. Record unavailable live success or permission fixtures as UNREACHABLE; local tests do not substitute for live proof.

### Cleanup

Read-only checks need no cleanup. Never reveal saved keys or authentication state. Key replacement costs money and belongs to Valentin.

### Local daily usage check

Sources: `src/lib/ai/dailyAiSpend.ts`,
`src/app/api/cron/ai-spend/route.ts` and `vercel.json`.

The paid allowance drift checker and background billed-snapshot refresh are
removed by YPER4-873. The old allowance-drift endpoint and
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

### Usage attribution (HTPR-7851)

Check the persisted feature breakdown after ordinary use, without generating paid calls solely for QA. Status updates use `status-update`; suggested replies use `suggest-reply` and retain their ticket. Native image calls use `generate-image`; demo boards use `demo-board`; search indexing uses `embeddings`; transcription uses `dictation`; key checks use `byok-test`. Failed batch items retain their terminal outcome before instant fallback.

Dedicated system credentials are identified by route: `gateway-demo`, `gateway-embeddings`, and `deepgram`. Key tests use `byok:<provider>`. No secret, transcript, input text, provider error body or key fingerprint belongs in the record. Unknown prices stay null, not zero. Embeddings run globally, so absent team/user IDs are intentional; transcription retains the authorized board and account.

Read the usage API and reload its existing screen as QA 985. Compare only records produced after the deployed merge. Do not test saved keys, generate images, build demo boards, transcribe audio or trigger AI inference without spending approval. Mark absent live paths UNREACHABLE and retain the isolated entry-point test evidence; never present mocks as live proof. Billing, provider choices, allowance limits and output must remain unchanged.
