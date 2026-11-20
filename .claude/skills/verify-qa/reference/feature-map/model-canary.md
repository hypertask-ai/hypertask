# AI model canary

## Sub-features

- `ai-model-canary` AI model canary.
- `model-canary-state` With `htpr-7748-model-canary-state` on, `GET /api/mcp/ai/models/status` adds `state` (`never_run`, `enabled` or `disabled`), `reason`, `stateCheckedAt`, `configured` and `configuredReason`. `configured` is true only when `MODEL_CANARY_AI_GATEWAY_API_KEY` is a `vck_` key different from the trials key. Missing, malformed or trials-identical keys set `configured` false and `configuredReason` to `missing_internal_gateway_key`, `malformed_internal_gateway_key` or `internal_key_equals_trials_key`. No stored state and no prior check is `never_run`. Flag off returns `checkedAt` and `models` only.

## How to get to it (user POV)

The internal production cron runs `/api/cron/ai-model-canary` daily at 04:40 UTC.
Authenticated MCP clients read `/api/mcp/ai/models/status`; reads never infer.
This is internal monitoring, not a customer AI entry point.
Authenticated clients read the state fields on that same status route.
There is no customer screen for `htpr-7748-model-canary-state`.

## Driving it with agent-browser

1. Verify the merge deployment succeeded and QA 985 is signed in.
2. Read the current MCP model status and save the timestamp and rows.
   With `htpr-7748-model-canary-state` on, require `state` to be one of
   `never_run`, `enabled` or `disabled`, and require `configured` plus
   `configuredReason`. Flag off must omit `state`. Never infer a state
   the body did not return. Do not print the gateway key.
3. Ask the internal-key owner to confirm server-only
   `MODEL_CANARY_AI_GATEWAY_API_KEY` points to an approved internal tooling key,
   distinct from the shared trials key. Never create, change or expose keys.
4. With existing cron authorization, run the production cron once, or wait for
   its scheduled run. Save safe counts and the updated MCP rows.
5. Correlate `model-canary` gateway requests by timestamp, model and QA user 985.
   The provider's request log must identify the approved internal key, not the
   All Trials Key. Org-wide credit totals are not routing proof.
6. Missing, malformed or trials-identical internal configuration removes the
   gateway lane, with zero gateway inference; the run still probes enabled
   direct-provider QA keys and records the rows it checked. With no usable
   credential on any lane the run writes `state: "disabled"` and no model rows.
   Exercise these negative cases with synthetic credentials
   in `tests/htpr-7748-model-canary.test.cjs`, never by editing production keys.

## Gotchas

- A missing internal key silently falls back to the shared trials key.
- An internal key is configured as the trials key itself.
- The generic customer-key classification rejects a valid internal key.
- Gateway changes inadvertently disable existing QA BYOK probes.
- A skipped probe is claimed as a successful model response.
- An empty `models` list is reported as disabled. Empty models with no stored state and no `checkedAt` are `never_run`. `disabled` is a stored state with a reason.
- `configured` is treated as proof the daily run passed. It only says the internal gateway key is present and distinct from the trials key.

### What proof to collect

Save the safe cron counts, updated model status and provider request identity.
Keep credentials, request headers and full configuration out of evidence.
Capture the signed-in QA doctor page and core inbox cycle for the deployment.
If cron authorization, internal-key configuration or provider observability is
unavailable, mark the corresponding acceptance case UNREACHABLE and keep the
key-routing acceptance open; unit tests do not prove live billing isolation.
No UI change means no theme matrix or feature video is required.

### Cleanup

Read-only status checks require no cleanup. Do not delete canary status rows,
change provider settings or rotate credentials. The cron owns its lock and
status history.
