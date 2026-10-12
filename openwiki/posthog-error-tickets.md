# PostHog production errors to Bugs

Ticket: https://app.hypertask.ai/detail/project-4060/331

## Why this path

Project 236160 has an enabled destination named `Hypertask server exceptions to rollback relay` (ID `01a08328-e652-0000-6b14-af716f45713c`). It sends `$exception` events with `ht_source=server` to `/api/integrations/posthog/error-alert`. The app verifies both PostHog's webhook signature and its own event signature, claims the event in Redis, and dispatches `PostHog Error Alert`. That path intentionally misses handled and browser errors. The project's error-tracking alerts API returns HTTP 403 with `This feature is not available`.

`PostHog Error Issues` therefore polls every five minutes. It reads the issue metadata API and a production-only HogQL aggregate, then reuses the existing incident-creation API code. A single scheduled writer avoids duplicate tickets from the event relay and issue poll. The relay still verifies events and retains its existing fresh-release rollback safety checks, but does not create a second fingerprint-based bug ticket. Issue filing is not gated on the current deployment SHA or a spike, and needs no product feature flag.

An issue first seen after the fixed activation timestamp gets one board 15 Bugs ticket. Its PostHog issue ID is stored in the description, searched across Normal, Archive and Deleted tickets. Repeated occurrences add an idempotent count comment and update the small count marker plus severity label without changing human edits, assignees or workflow state. A create request also uses an issue-ID idempotency key; persisted markers keep deduplication working after the API's 24-hour idempotency expiry. A successful create response contains `task.ticketNumber`, not `task.uniqueIndex`.

P1 means a crash, failed durable accounting or at least ten known users. P2 means a failed feature. P3 means a known plan/input limit or a deliberate canary. Labels P1/P2/P3 are found or created through the project labels API. Each ticket includes plain-language impact, hits, known users and an issue link. Server captures currently use the shared `hypertask-app` identity; they are not counted as one real user. Their unidentified-hit count is shown explicitly instead. Counts are cumulative since activation and subject to PostHog event retention.

## Activation and required credentials

The owning shipping session must do these steps, not a helper:

1. In GitHub repository `hypertask-ai/hypertask`, ensure secret `POSTHOG_FULL_API_KEY` contains the existing working key from the PostHog key safe. The stored `POSTHOG_READONLY_API_KEY` and `POSTHOG_ALERT_API_KEY` can read issues but return 403 for HogQL queries. Do not print any key. No newly generated PostHog key is necessary.
2. Ensure GitHub secret `POSTHOG_ERROR_TEST_TOKEN` contains the existing test token already configured on production. This is a new GitHub secret reference, not a new credential. Existing `HYPERTASK_MCP_TOKEN` is reused for board reads, labels, tickets, comments and canary closure, as production monitoring already does. It must retain write access to both projects 15 and 4060.
3. Set repository variable `POSTHOG_ISSUES_SINCE` once to the UTC activation timestamp, for example the output of `date -u +%Y-%m-%dT%H:%M:%SZ` immediately before deploying this change. Keep it fixed on retries and future deploys. Missing/invalid/future values fail the poll loudly. This prevents automatic backfill. Do not reset the cutoff each day.
4. Keep `htpr-6238-posthog-error-alert` enabled for its existing receiver and error-test route. The new poll and watchdog have no feature flag.
5. Once production is deployed, manually run `PostHog Error Nightly Canary` and confirm it passes and closes its own test ticket. Then confirm a scheduled issue poll succeeds. A helper does not run these workflows or write any live tickets.

GitHub secret enumeration was unavailable to the helper (403), so the owner must check whether those two secret entries already exist. No PostHog UI or destination change is needed. The repository default branch must remain production for schedules and workflow_run, per the CI contract. GitHub schedules are best effort, not a hard five-minute latency guarantee; the canary detects a pipeline that misses the fifteen-minute target.

## The safety net watches itself

`PostHog Error Nightly Canary` runs at 02:17 UTC. It POSTs to production's existing `/api/integrations/posthog/error-test` with `x-error-test-token` and a bounded, run-specific `x-posthog-canary` marker. The route's normal interactive path still needs the owner's session and test token. Its new machine path accepts only production, the existing enabled flag, the shared token and a marker of the form `yper4-331-<numeric run id>-<numeric attempt>`. It cannot choose arbitrary error text. The route throws a uniquely fingerprinted error through the normal production instrumentation and PostHog capture path.

The canary searches board 15 until a ticket includes both its unique marker and a real PostHog issue-ID marker. A ticket from the older application error reporter is not sufficient proof. It moves only that ticket to board 15's Done section. No ticket within fifteen minutes, bad auth, failed queries or failed closure makes the workflow red.

`PostHog Error Pipeline Watchdog` runs independently when the relay, issue poll or nightly canary fails or times out. It checks out only trusted production code and calls the MCP app API directly using the existing CI token. It never calls the receiver, PostHog, the dispatch signer or the incident response parser. All failures reuse one exact-title ticket on project 4060, including archived/deleted matches, and each run adds an idempotent link comment. Reporter delivery failures themselves remain loud failed jobs. No path can create a board ticket while the app API or its shared token is unavailable.

## Expected errors, without hiding real faults

- `src/app/api/ai/_lib/modelProvider.ts` throws `AiGatewayKeyRequiredError` when neither a dedicated team Gateway key nor a direct BYOK key is available. `src/lib/ai/chatStream/errors.ts:reportHandledChatError` already skips this typed error and `AiPlanAccessError`; other AI routes' catch blocks can still report the raw message.
- `src/app/api/ai/_lib/sharedAllowance.ts` defines `SharedAiAllowanceExceededError`; `src/lib/aiAllowancePolicy.ts` owns the monthly allowance message. Chat stream handling unwraps and skips it, and task-writer has its own expected-allowance guard. Other generic catch/report paths still need the same typed handling.
- User-input failures are validated in MCP validators and route guards. Some catch-all paths, such as AI task generation JSON parsing, call reportError. A JSON parse error from model output is not automatically a user error and must remain P2.
- `src/lib/errors/reportError.ts` sends reported errors to PostHog and the older durable reporter. `src/lib/telemetry/posthogErrorTracking.server.ts` captures the report. `src/instrumentation.ts` captures uncaught server request errors.

Small follow-up proposal: at the existing catch boundaries, detect the named key/plan/allowance errors and explicit input-validation failures, and either return their existing 4xx response without reportError or set one `extra.ht_expected_error=true` property. The capture code already forwards safe boolean extras. Once used consistently, filter that property out of the issue poll, except canaries. Do not infer expectedness from every 4xx, every JSON parse error or every empty model reply. Until then the implemented narrowly matched known limits get one P3 ticket with repeat counts, not a stream of duplicate bugs.

Backfill drafts and the log-backed plain-language root cause are in the uncommitted `.unlazy/helper/backfill.json` and `.unlazy/helper/root-cause.md`.
