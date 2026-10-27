# Bounded AI Chat Manager alerts

Ticket: https://app.hypertask.ai/detail/project-15/6354

The server flag `htpr-6354-ai-chat-alerts` defaults to Owner + QA. Only turns in
that audience contribute samples until the flag is widened. Existing PostHog
tracking is unchanged and does not depend on alert delivery.

## Policy

- Separate rolling 15-minute windows for production and preview.
- Open an error-rate incident above 5% or a latency incident above 20 seconds
  p95, with at least 20 completed requests. Equality does not breach.
- p95 is the nearest-rank percentile of completed-turn durations. Failed turns
  use status 500, successful turns 200, and user cancellations 0.
- One open incident per environment and kind. No repeat alert while open,
  including after delivery retries are exhausted.
- Close after the metric remains at or below its threshold for a full window.
  A small unhealthy window resets recovery; an empty window is healthy.
  A later breach opens a new incident with a separate delivery identity.

## Delivery and operations

Manager receives a machine-authored Agent Chat message through the existing
addressed webhook outbox or pending-message polling path. The target is the
owner's active external agent named `Manager`, or the agent identified by
`AI_CHAT_ALERT_MANAGER_AGENT_ID`. No new notification channel is introduced.

Chat schedules the observer with `waitUntil` and never awaits it. Failed
handoffs retry at least 1, 2 and 4 minutes later, at most three retries. Stable
message IDs prevent duplicate handoffs after an uncertain commit. Existing
webhook transport also has its existing three-retry bound; transport failures
and handoff failures are reported as handled errors without exception bodies.

The authenticated, existing 15-minute native-agent-heartbeat cron schedules a
sweep with `after`. It processes both environments even with no new chat turns.
During quiet periods, retries and recovery can be observed up to one cron tick
later than their earliest eligibility. Processing is bounded to eight handoffs
per invocation. Cron failures cannot affect the chat response.

Apply the additive alert migration before enabling the deployed code. The
three alert tables contain only counts, durations, status codes, timestamps,
and incident/delivery identifiers and lifecycle labels. They never contain
original prompts, replies, user IDs, model output or error bodies. Samples
expire after 15 minutes; closed incidents and delivery metadata after seven
days. Open incidents remain until recovery, so a persistent failure cannot
repeatedly reopen. Manager's generated metric messages follow existing Agent
Chat retention.

Focused SQL tests run against isolated in-memory PGlite, never the app database.
The package is already included by the pinned Prisma development dependency.
