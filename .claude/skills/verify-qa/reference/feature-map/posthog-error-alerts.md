# PostHog error alerts

## How a customer reaches it

Not directly. A production error reaches PostHog, PostHog calls the signed webhook `POST /api/integrations/posthog/error-alert` (behind `htpr-6238-posthog-error-alert`), the route starts the GitHub workflow `posthog-error-alert.yml`, and that workflow files one board 15 Bugs ticket per new issue. Infrastructure only, no app UI.

## How to drive it

- Refusal: an unsigned `curl -X POST https://app.hypertask.ai/api/integrations/posthog/error-alert --data '{}'` must return 401 (404 means the flag is off).
- End to end: run `gh workflow run posthog-error-nightly.yml --ref production`. It raises a marked canary error on production, waits up to 15 minutes for the matching board 15 ticket, then resolves the PostHog issue and closes the ticket. The run log must say "Nightly PostHog canary passed", and `gh run list --workflow posthog-error-alert.yml` must show new `workflow_dispatch` runs after the deploy time.
- GitHub retry and failure paths cannot be forced live: cover them with `tests/posthog-error-dispatch.test.cjs`.
- PostHog query 502/503/504 responses retry only the read, twice with bounded waits. Persistent errors still fail the workflow. Replay these paths with `node --test tests/posthog-query-retry.test.cjs`; never force a provider outage live.
- Browser noise filters (HTPR-7399): headless Chromium with QA 985, a normal Chrome user agent and `navigator.webdriver` false, `context.route('**/api/errors')` answered 204 locally so nothing reaches PostHog. On a board, `Promise.reject` an AxiosError-shaped error (`isAxiosError`, `code: 'ECONNABORTED'`, `config.url`). `Request aborted` must send no beacon; `timeout of 1000ms exceeded` with the same code and a plain `Error('Request aborted')` must each send one.

- Bare network noise (HTPR-7570): after deploy, run `node ~/.local/state/vcc-evidence/HTPR-7570/live-check.mjs` on a machine permitted to run browser QA, optionally with `QA_TICKET_URL=https://app.hypertask.ai/detail/project-7049/<existing-ticket-number>`. It uses QA 985, intercepts `/api/errors` locally, checks frame-less lowercase network notifications are filtered without replacing the ticket, then throws a render error through the deployed Next boundary and app global-error component and requires a report. This verifies telemetry filtering, not recovery from the original unidentified failure.
- Self-recovered chunk errors (HTPR-7714): after deploy, run `node ~/.local/state/vcc-evidence/HTPR-7714/live-check.mjs`. It uses QA 985 and answers PostHog and `/api/errors` locally. PostHog-js skips headless Chromium as a bot unless `navigator.userAgentData.brands` is overridden without `HeadlessChrome`. A plain `Error` rejection must send one `$exception`; a `ChunkLoadError` rejection must send none, report to `/api/errors` once the reload attempts are used up, and reload with `__ht_chunk_reload` when they are not.

## What usually breaks

- The webhook secret or GitHub token missing in Vercel, so every alert 503s.
- The workflow disabled or renamed, so dispatch returns 404 or 422 (YPER4-146).
- Brief GitHub 5xx turning into false "dispatch failed" bug tickets (HTPR-7354).
- Duplicate tickets when a claim is not released or committed.

## What proof to collect

Doctor: merge SHA production deployment success and /my-tasks signed in as QA 985 (phone shot). The 401 curl output with timestamp, the canary run URL and its "passed" log line, and the alert workflow run ids after the deploy.

## Cleanup

The canary closes its own ticket and resolves its PostHog issue. Nothing else is written.


## Related Vercel error collector

The separate VPS collector is installed from
`.claude/skills/ship/scripts/error-collector/collector.mjs`. It reads production
logs and writes through `vcc`; PostHog issue alerts keep their existing path.

For route/root grouping changes, first inspect the hosted `ship-scripts-tests`
replay. It must show one incident for the recorded project-list failures, separate
different-field and different-route failures, and recover interrupted activities.
After merge, install the merged collector, run `user-unit-check --first-run
error-collector.service`, then inspect its result and journal. Run the collector
with `--dry-run --sources vercel` against a fresh state directory; retain its
read-only plan and live related-ticket lookup. Never raise real errors or file
customer tickets merely to verify grouping. A read-only replay proves the live
lookup and installed code; the hosted isolated replay proves write side effects.
