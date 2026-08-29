# AI Gateway: per-team cost attribution

Status: live since 2026-07-07. Last reviewed 2026-08-09.

## Architecture

All LLM traffic goes through the **Vercel AI Gateway**. Premium, legacy AI,
and comped teams use a dedicated platform-managed team key (`vck_...`). Free
and BYOK-plan teams use the shared included-allowance key. A customer BYOK key,
when configured, takes precedence over the funded key. One exception: dictation
speech-to-text calls Deepgram (`api.deepgram.com`) directly because the gateway exposes no audio endpoint
(`POST /v1/audio/transcriptions` → 404, confirmed).

Dictation STT uses **Deepgram**. Legacy OpenAI settings migrate to Deepgram in
`@/lib/dictationProvider`; the backend lives in
`@/lib/services/dictation/transcriptionProviders.ts`. Since STT bypasses the
gateway (no per-team `vck_` key), Deepgram usage is attributed instead via
request **tags** — `team:<id>` and `user:<id>` are attached to every
`/v1/listen` call and are filterable in the Deepgram usage dashboard.

```
AI feature → resolve authenticated owning team → customer BYOK lookup →
  customer key found             → customer's key
  Premium/AI/comped team         → managed_gateway row (dedicated vck_ key)
  Free or BYOK-plan team         → AI_GATEWAY_API_KEY (shared allowance key)
  Premium/AI/comped key missing  → fail closed
```

The current plan is checked on every resolution. Stale dedicated rows cannot
preserve Premium funding after a downgrade, and Free teams cannot keep using a
previously stored customer key. BYOK-plan and Premium teams may use customer keys.

## Key storage

- Table: `TeamByokApiKey` — unique on `(teamId, provider)`. The legacy table
  name stores both customer BYOK secrets and platform-managed keys. New
  platform keys use the internal-only `managed_gateway` provider, which is not
  in the customer BYOK allowlist. Legacy platform rows may use `gateway`,
  `claude`, or `openai` and remain readable during migration. `ciphertext`
  holds the encrypted secret using
  AES-256-GCM (`src/lib/crypto/byokCipher.ts`, key = SHA256 of
  `BYOK_CIPHER_SECRET`). Layout: base64(version byte 0x01 | 12B iv | 16B tag | ct).
- Resolution helper: `getTeamGatewayApiKeyForProvider` (used by chat/stream,
  `_lib/editorAi.ts`, `_lib/customInstructions.ts`, `_lib/taskSummaries.ts`).
- The managed registry contains 14 team rows backed by 11 dedicated customer or
  internal keys. Vetsak's two teams share one key, and Valentin's three internal
  teams share one key.

## Per-agent keys (added 2026-08-19, HTPR-5389)

A native agent can carry its own provider key, so its turns bill that provider
account instead of the team pot. This is what makes per-agent cost an invoice
number rather than an estimate from token counts.

- Table: `AgentByokApiKey` — unique on `(agentId, provider)`, same ciphertext
  format and cipher as `TeamByokApiKey`. Rows cascade-delete with the agent.
- Providers: every customer BYOK provider except `custom`. Custom endpoints
  stay team-only because they also carry a base URL and a GDPR flag.
- Resolution order inside `getByokApiKeyForProvider`: acting agent key →
  request `byokProviderFlags` → team key → funded/shared gateway key. The agent
  key wins because the point of the feature is running on that account.
- Scope: `ByokLookupContext.agentId` is server-derived only. `chat/stream` sets
  it from `loadActingAgent`, so it applies to the agent's own chat turns.
- Guards unchanged: the team plan gate still applies (no BYOK on `Free`), and
  GDPR safe mode still blocks restricted providers for the agent's team.

API (owner of the agent only, cookie auth), `/api/agents/{idOrSlug}/provider-key`:

```bash
# set or replace a key
PUT  {"provider":"openrouter","apiKey":"sk-or-...","enabled":true}
# list configured providers, masked
GET  -> {"keys":[{"provider":"openrouter","enabled":true,"maskedKey":"••••••••1234"}]}
# remove
DELETE ?provider=openrouter
```

## Feature → transport map

| Surface | Transport | Attribution |
|---|---|---|
| AI Chat (side panel) | gateway | per-team |
| Editor AI / slash commands / Task Writer / @AI comments / dictation-improve | gateway (via `_lib/editorAi.ts`) | per-team |
| Task summaries, custom instructions | gateway | per-team |
| Dictation speech-to-text (Deepgram `nova-3`, per-user language) | direct to Deepgram | Deepgram tags (`team:`/`user:`) |

Live table: https://analytics.hypertask.app/ai-features

## Non-team keys (added 2026-07-14, HTPR-4248)

Not every gateway key maps to a customer team. Two internal keys exist; never
repurpose a team key for tooling:

- **OpenWiki Internal Tooling** ($10/mo quota) — used by the `openwiki` docs
  refresher (`~/.openwiki/.env` on the VPS). Before this key existed, OpenWiki
  ran untagged on the "Team Valentin Yeo Boards" key and showed up as the
  mystery untagged traffic in tag reports.
- **Reporting Bot** ($1/mo quota) — read-only `/v1/report` queries for usage
  analysis. Stored in the repo's gitignored `.env.report.local` on the VPS.
  Report data is org-wide regardless of which key authenticates.
- **Anonymous Demo** (added 2026-07-15, HTPR-4303) — powers board generation
  inside the rate-limited `POST /api/demo/guest` flow using `gpt-5.4-mini` and
  the `demo-board` tag. `DEMO_AI_GATEWAY_API_KEY` is configured on Vercel for
  production, preview, and development. Missing configuration fails closed;
  there is no shared-key fallback. The standalone public generation route was
  removed because it bypassed the guest-flow limits.

Also note: "All Trials Key" is the intentional included-allowance key for Free
and BYOK-plan teams. It is not a fallback for Premium, legacy AI, or comped
teams. Per-team allowance enforcement is tracked in HTPR-5205; until that ships,
shared-key requests are attributed by team/user tags but are not hard-capped.
Turbopuffer embeddings do not use the gateway at all
(direct OpenRouter, `OPENROUTER_API_KEY`) — folding them in is HTPR-4246.

## Operations

- **Add or restore managed team keys:** create the `vck_` keys in Vercel, load
  the matching `GATEWAY_KEY_*` variables and `HYPERTASK_MANAGEMENT_KEY`, then run
  `npm run ai:provision-managed-team-keys`. The admin-only product API resolves
  the registry, encrypts each secret, writes `managed_gateway`, and removes the
  matching obsolete customer-visible rows while preserving any different
  customer-owned BYOK secret. It never returns plaintext keys.
- **Missing keys:** Premium, legacy AI, and comped teams fail closed when their
  dedicated key is absent. Free and BYOK-plan teams intentionally use the
  shared included-allowance key.
- **Verify billing isolation:** trigger any AI feature in two teams' boards,
  then Vercel → AI Gateway → Observability: each request logs the key it used.
- **Costs:** gateway passes through list prices, no markup. Old direct spend
  (~$200/mo Anthropic+OpenAI) now lands as Vercel credits (see
  `hypertask-analytics` stack page).

## Gotchas

- Never put a vck_ key or `BYOK_CIPHER_SECRET` behind `NEXT_PUBLIC_` (see
  security section in CLAUDE.md).
- Preview deployments share the prod DB, so previews resolve and bill the
  same per-team keys as prod.
- The gateway has no audio endpoint; STT stays direct-to-provider until that
  changes. Deepgram (`nova-3`) is the only backend and needs a server-only
  `DEEPGRAM_API_KEY`. Per-customer usage is tracked by Deepgram request tags,
  not gateway keys. Demo guests cannot use dictation, and both dictation routes
  authenticate before parsing audio and reject payloads over 3 MB.

## Current state (updated 2026-08-08)

**EVERYTHING is Vercel AI Gateway.** There are no direct Anthropic/OpenAI API
keys for text inference anywhere. The only exception is dictation
speech-to-text (direct to Deepgram; the gateway has no
audio endpoint). If you are investigating AI cost, the answer is always: which
vck_ key did the request bill to — except dictation, which is Deepgram usage
tagged by `team:`/`user:`.

### Key inventory (source of truth)

- The vck_ secrets live in `~/.config/val-staging/credentials.env` on the VPS
  as `GATEWAY_KEY_*` vars: HYPERTASK, INNE, VETSAK, RODRIGO, KVWULP,
  PUROLOGIX, D2LAW, PERRY, TRIALS, ALLOCATOR, VALENTIN, BAYBELLA.
- `GATEWAY_KEY_HYPERTASK` (dashboard name "Team Hypartask", suffix `3BfZbA`)
  was stored under the stale name `AI_GATEWAY_API_KEY` until 2026-07-11 —
  it had been the prod default before the 2026-07-07 trials-key swap. If a
  key seems missing, check for stale var names before asking anyone.
- Prod env `AI_GATEWAY_API_KEY` = `GATEWAY_KEY_TRIALS` (suffix `06UTtr`)
  since 2026-07-07. Free and BYOK-plan included usage intentionally bills
  there; Premium, legacy AI, and comped usage must not.

### provider column ≠ vendor API key

`TeamByokApiKey` is unique on `(teamId, provider)`. Platform-owned team keys use
one `managed_gateway` row. Customer BYOK uses its provider row. The older
`gateway`, `claude`, and `openai` platform rows are compatibility artifacts and
should be migrated with the managed-key provisioning command.

### Team wiring status

- Team "Hypertasks" (`08f79efd-770e-4e32-9728-65e6d29ec893`, boards 15 /
  229 / 1534 / 2063) uses `GATEWAY_KEY_HYPERTASK`. Before dedicated wiring,
  its traffic billed the trials key (~72% of that key's volume).
- inne swapped to Pro-monthly x16 with a permanent $300-off coupon (flat
  $100/mo deal) on 2026-07-11; gateway key unchanged. Their legacy raw
  OpenRouter BYOK row was deleted the same day.
- Plan classification (`storePlanId` Free/AI/BYOK/Pro) comes from the Stripe
  price id (`src/lib/planFromStripePriceId.ts`), NOT from `TeamByokApiKey`.
  Seeding a gateway key changes billing attribution only, never the plan.

### Gotcha: /v1/credits is org-wide

`GET https://ai-gateway.vercel.sh/v1/credits` returns the shared org credit
pool no matter which vck_ key authenticates. It cannot verify per-key
routing. Per-key usage = AI Gateway dashboard (quota column / key detail) or
the Observability request log.

## Team → key registry (decrypt-verified from prod, 2026-07-11)

The registry below maps every dedicated funded team to its `GATEWAY_KEY_*`
credential. Provisioning returns a non-secret fingerprint for exact verification.

| Team (title) | teamId | Owner | GATEWAY_KEY_* | Notes |
|---|---|---|---|---|
| Hypertasks (boards 15/229/1534/2063) | 08f79efd… | valentin.yeo@gmail.com | HYPERTASK | internal; wired 2026-07-11 |
| inne | b660876d… | valentin.yeo@gmail.com | INNE | Premium (Pro-monthly x16 + permanent $300-off coupon = flat $100/mo since 2026-07-11; was mislabeled BYOK for spend visibility). Legacy openrouter sk-or- row deleted 2026-07-11 |
| Vetsak | a85701ec… | kendall@vetsak.com | VETSAK | |
| vetsak (second team) | 2b8a811d… | marcoschache@vetsak.com | VETSAK | shares the VETSAK key |
| Baybella | 99bbe346… | valentin.yeo@gmail.com | BAYBELLA | |
| Rodrigo | f533c54b… | nask@rodrigonask.com | RODRIGO | |
| MyTeam (D2 Law) | 4cd3406b… | anatoly@d2law.ca | D2LAW | default team title |
| MyTeam (Perry Lawrence) | 92c25c5d… | perry.lawrence@gmail.com | PERRY | default team title |
| MyTeam (Purologix) | d0c3ef29… | brandon@purologix.com | PUROLOGIX | default team title |
| MyTeam (Kvwulp) | e46da609… | kvwulp@gmail.com | KVWULP | default team title |
| MyTeam (Allocator One) | fde44a30… | michael@allocator.one | ALLOCATOR | default team title |
| Valentin Private (Zigshell #2060) | da1167a2… | valentin.yeo@gmail.com | VALENTIN | internal |
| Valentin Yeo's Team | 35c2b765… | valentin.yeo@gmail.com | VALENTIN | internal |
| Endless Testing | 02f13a92… | valentin.yeo@gmail.com | VALENTIN | internal |

Free and BYOK-plan teams outside this table bill the shared included-allowance
key (prod `AI_GATEWAY_API_KEY` = `GATEWAY_KEY_TRIALS`). Known residents there
as of 2026-07-11: Zubair's
"MyTeam" (board 2071, dead Cursor test), Abdul's "team 1" (board 1096),
Eco Inno / Northwind (board 318, external), plus ~1,000 dormant signup teams.

Five customer teams are all titled "MyTeam" (the default) — never identify a
team by title, only by teamId or owner email.

**Business model context:** there is NO free tier. Users get a 7-day trial,
then must be Premium or BYOK. Trial expiry is currently enforced only by a
root-route redirect; server-side AI entitlement is HTPR-4130.
