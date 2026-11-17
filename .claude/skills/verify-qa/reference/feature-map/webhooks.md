# Webhooks

## Sub-features

- `webhooks` Webhooks.
- `agent-webhook-auth-header` With `htpr-7905-agent-webhook-auth-header` on, an agent webhook can store one extra header (`auth_header_name` and `auth_header_value`) or a bearer secret (`bearer_secret`, sent as `Authorization: Bearer …`). Deliveries, tests and replays send that header to the saved HTTPS endpoint. The value is sealed. A later read returns `authHeaderName` and `authHeaderSet`, never the value. `clear_auth_header` removes it. Names must be 1 to 64 letters, digits or hyphens, and must not be a reserved HTTP name or start with `x-hypertask-`. Flag off refuses a new header and sends none.

## How to get to it (user POV)

A team owner opens Settings > Webhooks and adds an endpoint for the whole team or one board. Hypertask signs every delivery with that endpoint's `whsec_` key (`X-Hypertask-Signature`, HMAC-SHA256 over `<timestamp>.<body>`). The key is shown once at create or rotate, and after that only as a `whsec_…abcd` hint. Agents get their own webhook through Agents > the agent, or through the MCP webhooks tools. The extra header is on that agent webhook, not on the team Settings endpoint. The MCP action is `configure`, with `auth_header_name` plus `auth_header_value`, or `bearer_secret`, or `clear_auth_header`.

## Driving it with agent-browser

Sign in as QA user 985 (`~/.config/hypertask-videos/storageState-qa.json`) and call the same session route the Settings page uses: `GET /api/settings/webhooks?teamId=<team>`, and `POST` with `action: create | test | rotate` (send an `Origin: https://app.hypertask.ai` header for mutations). QA owns team `9bca4a7c-798a-492f-af71-9324259b98ce`. Use a team-wide endpoint (`projectId: null`), because QA is not the owner of the team that holds sandbox board 7049. Point it at a receiver that answers 2xx, such as `https://httpbin.org/status/204`. `test` queues a delivery. Poll the list until `lastDeliveryAt` changes and read `lastDeliveryOk`. Never print or store the returned key; compare only its last 4 characters with the hint. Do not save a live receiver secret on the shared QA webhook. `tests/htpr-7905-agent-webhook-auth-header.test.cjs` covers set, bearer, reserved names, clear, and that the value is not returned. A live read may show `authHeaderSet` true or false. Never print `authHeaderValue`.

## Gotchas

- Signing keys stored encrypted (`enc:v1:`, HTPR-7624, flag `htpr-7624-sealed-webhook-keys`): a key that cannot be opened (wrong or replaced `BYOK_CIPHER_SECRET`, damaged value) makes the delivery fail with "Webhook signing key is unavailable" and no request is sent. The hint then shows `unavailable`.
- Old plain-text keys must keep delivering until the backfill cron (`/api/cron/webhook-signing-key-sweep`, runs only when the flag is Everyone) seals them.
- Rollback: once any key is sealed, reverting below HTPR-7624 makes those endpoints sign with the stored ciphertext, so receivers reject the deliveries. Switch the flag Off instead.
- Team-owner checks: only the team owner can manage workspace webhooks (403 otherwise), and a board must belong to the chosen team.
- `htpr-7905-agent-webhook-auth-header` off still sending a stored header. Off sends none.
- A sealed header that cannot be opened. The delivery fails and no request is sent.
- Combining `bearer_secret` with `auth_header_name`. The save is rejected.

### What proof to collect

- The create response's hint matches the last 4 of the one-time key, both on create and in the list.
- The test delivery to a 2xx receiver flips `lastDeliveryOk` to true.
- An endpoint created before the change (plain key) still delivers after it.
- For encryption itself, the CI tests `tests/htpr-7624-*.test.cjs`. Sessions never read the database.

### Cleanup

`DELETE /api/settings/webhooks` with `{ teamId, id }` for every endpoint you created.
