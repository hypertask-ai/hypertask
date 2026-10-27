# Webhooks

## How a customer reaches it

A team owner opens Settings > Webhooks and adds an endpoint for the whole team or one board. Hypertask signs every delivery with that endpoint's `whsec_` key (`X-Hypertask-Signature`, HMAC-SHA256 over `<timestamp>.<body>`). The key is shown once at create or rotate, and after that only as a `whsec_…abcd` hint. Agents get their own webhook through Agents > the agent, or through the MCP webhooks tools.

## How to drive it

Sign in as QA user 985 (`~/.config/hypertask-videos/storageState-qa.json`) and call the same session route the Settings page uses: `GET /api/settings/webhooks?teamId=<team>`, and `POST` with `action: create | test | rotate` (send an `Origin: https://app.hypertask.ai` header for mutations). QA owns team `9bca4a7c-798a-492f-af71-9324259b98ce`. Use a team-wide endpoint (`projectId: null`), because QA is not the owner of the team that holds sandbox board 7049. Point it at a receiver that answers 2xx, such as `https://httpbin.org/status/204`. `test` queues a delivery. Poll the list until `lastDeliveryAt` changes and read `lastDeliveryOk`. Never print or store the returned key; compare only its last 4 characters with the hint.

## What usually breaks

- Signing keys stored encrypted (`enc:v1:`, HTPR-7624, flag `htpr-7624-sealed-webhook-keys`): a key that cannot be opened (wrong or replaced `BYOK_CIPHER_SECRET`, damaged value) makes the delivery fail with "Webhook signing key is unavailable" and no request is sent. The hint then shows `unavailable`.
- Old plain-text keys must keep delivering until the backfill cron (`/api/cron/webhook-signing-key-sweep`, runs only when the flag is Everyone) seals them.
- Rollback: once any key is sealed, reverting below HTPR-7624 makes those endpoints sign with the stored ciphertext, so receivers reject the deliveries. Switch the flag Off instead.
- Team-owner checks: only the team owner can manage workspace webhooks (403 otherwise), and a board must belong to the chosen team.

## What proof to collect

- The create response's hint matches the last 4 of the one-time key, both on create and in the list.
- The test delivery to a 2xx receiver flips `lastDeliveryOk` to true.
- An endpoint created before the change (plain key) still delivers after it.
- For encryption itself, the CI tests `tests/htpr-7624-*.test.cjs`. Sessions never read the database.

## Cleanup

`DELETE /api/settings/webhooks` with `{ teamId, id }` for every endpoint you created.
