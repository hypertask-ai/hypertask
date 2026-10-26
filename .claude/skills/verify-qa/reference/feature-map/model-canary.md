# AI model canary

## How a customer reaches it

The internal production cron runs `/api/cron/ai-model-canary` daily at 04:40 UTC.
Authenticated MCP clients read `/api/mcp/ai/models/status`; reads never infer.
This is internal monitoring, not a customer AI entry point.

## How to drive it

1. Verify the merge deployment succeeded and QA 985 is signed in.
2. Read the current MCP model status and save the timestamp and rows.
3. Ask the internal-key owner to confirm server-only
   `MODEL_CANARY_AI_GATEWAY_API_KEY` points to an approved internal tooling key,
   distinct from the shared trials key. Never create, change or expose keys.
4. With existing cron authorization, run the production cron once, or wait for
   its scheduled run. Save safe counts and the updated MCP rows.
5. Correlate `model-canary` gateway requests by timestamp, model and QA user 985.
   The provider's request log must identify the approved internal key, not the
   All Trials Key. Org-wide credit totals are not routing proof.
6. Missing, malformed or trials-identical internal configuration must skip
   gateway inference. Exercise these negative cases with synthetic credentials
   in `tests/htpr-7748-model-canary.test.cjs`, never by editing production keys.
   Enabled direct-provider QA keys still run independently.

## What usually breaks

- A missing internal key silently falls back to the shared trials key.
- An internal key is configured as the trials key itself.
- The generic customer-key classification rejects a valid internal key.
- Gateway changes inadvertently disable existing QA BYOK probes.
- A skipped probe is claimed as a successful model response.

## What proof to collect

Save the safe cron counts, updated model status and provider request identity.
Keep credentials, request headers and full configuration out of evidence.
Capture the signed-in QA doctor page and core inbox cycle for the deployment.
If cron authorization, internal-key configuration or provider observability is
unavailable, mark the corresponding acceptance case UNREACHABLE and keep the
key-routing acceptance open; unit tests do not prove live billing isolation.
No UI change means no theme matrix or feature video is required.

## Cleanup

Read-only status checks require no cleanup. Do not delete canary status rows,
change provider settings or rotate credentials. The cron owns its lock and
status history.
