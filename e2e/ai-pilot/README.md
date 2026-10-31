# AI smoke pilot

This optional experiment does not replace required smoke tests. Pull requests
changing the pilot run a secretless static job: syntax checks, `npm ci` for the
pilot, and `e2e list --reporter json` with disposable synthetic state and card
fixture files. Collection requires exactly the two runnable pilot cases. It loads
configuration and imports, but starts no browser or model.

For a recording, configure the GitHub Actions secret `OPENCODE_API_KEY` for the
existing OpenCode Go subscription. Manually dispatch **AI smoke pilot** on the
`production` ref. Other refs cannot run the recording job. For a three-day soak,
dispatch once daily for three consecutive days. Each run builds a disposable
local fixture, records both cases once, removes the key from replay processes,
and runs 20 old/new paired trials. Download the `ai-smoke-pilot-summary`
artifact. There is no automatic schedule or required check.

Recording uses `https://opencode.ai/inference/go/v1`, the prescribed provider
base, with `deepseek-v4.1-flash`. The provider appends `/chat/completions`.
OpenCode currently documents the native OpenAI-compatible base as
`https://opencode.ai/inference/go/openai/v1`; the prescribed base has not been
verified against the service. No other provider or paid fallback is used.
Recording sends synthetic fixture browser context to OpenCode Go. The local
server and search fixture receive no provider key.

Each pair compares the existing Desktop `layout baseline: ticket` and
`layout baseline: ticket from board card` tests with these pilot cases:

- `ticket layout after AI board card entry`: AI opens the named board card;
  deterministic actions expand both comments.
- `ticket layout after AI hovercard and comment expansion`: deterministic
  actions open the card and author hovercard; AI closes the hovercard and
  expands both comments.

Each case makes one agent action invocation; recording can make multiple model
requests per invocation, including retries. The original ticket baseline
already includes the hovercard workaround; it is not a separate comment test.
Both pilot cases check fixture flags, title, comments and composer. They check
visibility using the framework matcher and compare six ticket landmarks and
vertical order against the existing desktop layout evaluator. This is a
Desktop two-case comparison, not full suite or production coverage.

Every recording and trial must report exactly its two named tests, each executed
and passed once. Missing reports, missing tests, skips, nonruns, duplicates and
unexpected results fail that run regardless of exit code. The summary includes
per-run and aggregate discovered, executed, passed, skipped and nonrun counts, safe
failure diagnostics, request counts, wall-clock durations and failure rates.
`consecutiveNewPasses` is the final uninterrupted new replay streak. All 20
pairs run even if recording fails. Old failures are measured separately and do
not fail an otherwise passing pilot.

A successful dispatch requires successful recording, at least one recording
request, and 20 consecutive successful new replays. Each replay must also record
two agent actions with `modelCalls: 0`, `self-finalized` cache mode and replayed
actions. Strict read-only cache and a v4 denial model prevent model fallback.
A missing secret, cache miss or failed replay cannot pass.

Only the safe summary is uploaded. It excludes prompts, responses, credentials,
headers and raw child output. Local caches, traces, cookies and logs may contain
sensitive data; do not upload or commit them. Failures before measurement may
leave no summary. Durations include runner startup and Playwright session
preflight, not just action time. Hosted collection, provider compatibility,
recording and the three-day soak require CI evidence.
