# PostHog production errors to Bugs

Ticket: https://app.hypertask.ai/detail/project-4060/331

## Native PostHog alerts are the trigger

PostHog EU project [236160](https://eu.posthog.com/project/236160/error_tracking) owns issue detection and spike detection. On 2026-10-12 the following enabled `internal_destination` Hog functions were configured through `/api/projects/236160/hog_functions/`:

| Name | Event | Destination ID |
| --- | --- | --- |
| Hypertask Issue created | `$error_tracking_issue_created` | `01a13150-e706-0000-9b57-68ca588c2555` |
| Hypertask Issue reopened | `$error_tracking_issue_reopened` | `01a13150-e7c7-0000-9b39-cb83aab69dbe` |
| Hypertask Issue spiking | `$error_tracking_issue_spiking` | `01a13150-e882-0000-984a-aa5b3ba6e039` |

All three use `template-webhook`, POST `{ "event": "{event}" }` with Hog templating, and reuse the URL and Svix signing secret of `Hypertask server exceptions to rollback relay` (`01a08328-e652-0000-6b14-af716f45713c`): `https://app.hypertask.ai/api/integrations/posthog/error-alert`. Updates match an existing name or lifecycle-event filter, never create a second alert for the same event. Redacted before/after snapshots are in the ignored `.unlazy/helper2/` directory.

Each destination has masking **`ttl: 900`, `hash: "{event.distinct_id}", threshold: null`**. This allows the first notification for an issue, then masks repeats for 15 minutes, separately for each alert. `distinct_id` is the PostHog issue ID, not a user ID. A threshold of 1 would allow every event and is not a rate limit. The existing PostHog spike settings are unchanged: multiplier 10, threshold 500, snooze 10 minutes.

The receiver verifies the existing webhook signature before parsing native lifecycle events. It uses the issue's `distinct_id`, the event UUID, and native spike count/baseline. A Redis ownership claim prevents duplicate GitHub dispatches and is released on dispatch failure. It signs a fresh workflow payload with `POSTHOG_ALERT_DISPATCH_SECRET` and dispatches only the operator-controlled production ref of `PostHog Error Alert`.

## One issue, one ticket writer

`posthog-error-alert.mjs` handles the three native event kinds through the shared `posthog-error-issues.mjs` writer. It reads metadata and a production-only HogQL aggregate for **only the alerted issue ID**. Each run retries at 10, 20, 30 and 60 seconds, waiting 120 seconds total for ClickHouse ingestion. If production counts remain zero, it queries the same issue across **all environments**, then rechecks production if any rows exist. Confirmed non-production-only issues return `skip` with a reason and never write Bugs tickets. Explicit preview events also never write tickets. Counts cover the issue's whole production history, not one release. There is no scheduled discovery poll, custom issue-spike detector, activation cutoff, or automatic historical backfill.

Zero exceptions anywhere mean ingestion lag, not a production bug or a successful skip. The workflow re-dispatches `posthog-error-alert.yml` on its current ref with the **unchanged signed payload** and the separate `attempt` input incremented (default 1, maximum 3). Only this job has `actions: write`; dispatch uses the existing `GITHUB_TOKEN`. Every attempt gets the normal 120-second retry window and signature/timestamp validation. If attempt 3 still has zero rows, the script exits non-zero with an ingestion-lag error so the independent pipeline watchdog files an infra ticket. Failed dispatches also fail the run. No provisional ticket is created.

A created or reopened issue gets one board 15 Bugs ticket. The PostHog issue ID is persisted in its description and searched across Normal, Archive and Deleted tickets. Creates use an issue-ID idempotency key. Workflows remain independent per run so pending lifecycle alerts are not dropped; racing creates reconcile onto the oldest matching ticket. The description is written **once, at creation**, then belongs to humans: the bot never edits any part of it again. The creation alert marker remains for nightly canary verification, but generated-section boundaries and mutable count markers are removed. Every later alert run posts one short HTML comment with a bold first sentence, current hit/user counts, any reopen or spike details, severity changes and a final `Next:` paragraph. Comment idempotency keys use the GitHub run ID. Reopened issues move an existing Done or archived ticket back to Bugs; active human workflow state, titles and assignees are preserved. Deleted tickets are left untouched without comments or replacement tickets.

P1 means a crash, failed durable accounting or at least ten known users. P2 means a failed feature. P3 means a known plan/input limit or deliberate canary. Labels P1/P2/P3 are found or created through the project labels API. Severity is recomputed from the confirmed production aggregate on later alerts. When it changes, `/api/mcp/tasks/update` uses `remove_labels` for the old P labels and `add_labels` for the new one, never a wholesale `labels` replacement; human labels survive concurrent edits. That alert's comment explains the change. Tickets include what the user sees, initial hits, known users, first/last seen and the PostHog issue link. Later counts live in comments, not the description. Server captures using the shared `hypertask-app` identity are shown as unidentified hits, not counted as a real user.

The original signed `$exception` destination is retained **only for the existing emergency rollback guard**, not ticket detection. Its rolling server-error count still permits at most one rollback per release. Only a production server-error spike on the current live SHA, with the deployment and exception inside the fresh 15-minute window, can request rollback. Native issue alerts never bypass those guards or create fingerprint-based duplicate tickets.

## Required credentials and deployment verification

The retained GitHub workflows require `HYPERTASK_MCP_TOKEN`, `POSTHOG_FULL_API_KEY`, `POSTHOG_ERROR_TEST_TOKEN`, `POSTHOG_ALERT_DISPATCH_SECRET` and `VERCEL_TOKEN`. `HYPERTASK_MCP_TOKEN` must retain write access to projects 15 and 4060. The full PostHog key is required for HogQL reads and canary issue resolution; the stored readonly/alert keys cannot run the aggregate query. No new credential was generated. The two missing repository entries, `POSTHOG_FULL_API_KEY` and `POSTHOG_ERROR_TEST_TOKEN`, were installed from the key safe without printing their values. The receiver continues to use its existing production webhook, event-signing and GitHub-dispatch credentials.

Keep `htpr-6238-posthog-error-alert` enabled for the existing receiver and error-test route. This infra change adds no product flag. The obsolete `PostHog Error Issues` workflow and poll script are removed; `POSTHOG_ISSUES_SINCE` is no longer used. The repository default branch remains production for schedules and workflow_run, per the CI contract.

After this local change is shipped, the owning session must run `PostHog Error Nightly Canary` on production and confirm its ticket and PostHog issue are both closed. The helper does not dispatch production workflows or write any board content. Local tests exercise signed native alerts through the actual receiver, workflow handler, issue aggregate and mocked ticket API; they are not a claim of deployed verification.

## The safety net watches itself

`PostHog Error Nightly Canary` runs at 02:17 UTC. It POSTs to `/api/integrations/posthog/error-test` with `x-error-test-token` and a bounded marker `yper4-331-<run id>-<attempt>`. The route's normal interactive path still needs the owner's session and test token. The machine path accepts only production, the enabled flag, the shared token and that marker format; it cannot choose arbitrary error text.

The robust canary design is a **nightly-unique fingerprint**, not a repeat on an already-active issue. The normal server capture supplies `$exception_fingerprint`, derived from the run-specific error message and stack frame. The canary therefore proves test error -> PostHog issue -> native Issue created alert -> signed webhook -> board ticket within 15 minutes. It searches only for its unique marker together with a valid PostHog issue-ID marker and native created/reopened alert marker. A legacy reporter or former poll ticket is not sufficient proof. It also checks the issue metadata matches its marker before moving only that ticket to Done and PATCHing only that PostHog issue to `resolved`. Resolution or closure failure makes the workflow red. A rerun uses its own attempt marker; other issues are never resolved.

`PostHog Error Pipeline Watchdog` independently observes failed or timed-out `PostHog Error Alert` and `PostHog Error Nightly Canary` runs. It checks out trusted production code and calls the MCP app API directly using the existing CI token. It never calls PostHog, the receiver, dispatch signer or incident parser. Failures reuse one exact-title ticket on project 4060, including archived/deleted matches, with an idempotent run-link comment. Reporter delivery failures make the watchdog itself red; GitHub Actions failure notifications remain the last resort if the app API or CI credential is down. Silent alert delivery failure is caught by the nightly canary.

## Expected errors, without hiding real faults

- `src/app/api/ai/_lib/modelProvider.ts` throws `AiGatewayKeyRequiredError` when neither a dedicated team Gateway key nor a direct BYOK key is available. `src/lib/ai/chatStream/errors.ts:reportHandledChatError` already skips this typed error and `AiPlanAccessError`; other AI routes' catch blocks can still report the raw message.
- `src/app/api/ai/_lib/sharedAllowance.ts` defines `SharedAiAllowanceExceededError`; `src/lib/aiAllowancePolicy.ts` owns the monthly allowance message. Chat stream handling unwraps and skips it, and task-writer has its own expected-allowance guard. Other generic catch/report paths still need the same typed handling.
- MCP validators and route guards handle user-input failures. Some catch-all paths, such as AI task-generation JSON parsing, call reportError. A JSON parse error from model output is not automatically a user error and must remain P2.
- `src/lib/errors/reportError.ts` sends reported errors to PostHog first; the older durable reporter files its own ticket only when PostHog did not get the error, so each error gets one ticket (YPER4-334). `src/lib/telemetry/posthogErrorTracking.server.ts` captures the report. `src/instrumentation.ts` captures uncaught server request errors.

Small follow-up proposal: consistently detect named key/plan/allowance errors and explicit input-validation failures at existing catch boundaries, returning their existing 4xx response without reportError or tagging `extra.ht_expected_error=true`. Keep unclassified failures visible. Do not infer expectedness from every 4xx, JSON parse error or empty model reply. This change rates known messages P3 without suppressing other alerts.

Backfill drafts and the prior log-backed root cause remain in the uncommitted `.unlazy/helper/backfill.json` and `.unlazy/helper/root-cause.md`.
