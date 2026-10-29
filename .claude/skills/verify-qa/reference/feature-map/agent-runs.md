# Agent run lifecycle

## How a customer reaches it

Agents use `GET /api/mcp/agents/runs/<runId>` and bodyless
`POST /api/mcp/agents/runs/<runId>/stop`. Owners can use the same
routes with their browser session. Webhook subscriptions expose
`run.created`, `run.prompted`, and `run.stopped` through the agent's
webhook settings.

## How to drive it

1. Sign in as QA 985. Require authenticated bootstrap user 985.
2. Read `/api/agent-sidebar-chats?projectId=7049` to discover the
   existing QA Sandbox agents without seeding new agents.
3. Read `/api/agents/<owned-agent-id>/webhook`. Require all three
   lifecycle event names and their subscribable definitions. Never save
   signing secrets or authentication headers from the response.
4. If its recorded deliveries contain a run ID, read that run through
   `/api/mcp/agents/runs/<runId>`. Require matching run and agent IDs.
   Repeat with QA 2343 and require 404 for the other owner's run.
   Read `/api/mcp/agents/runs/<runId>/activities` with the same
   accounts: owner 200 with an activities array, other owner 404.
   Activity reads have no rollout flag; authorization still applies.
   If no recorded run exists, mark positive read and cross-owner read
   UNREACHABLE; retain the successful webhook discovery as closest proof.
5. Read an invented run ID as QA 985 and require 404. Read that same
   ID without a login and require 401.
6. Stop only a disposable run this QA run created. Never stop a
   pre-existing run or replay its webhook during read-only verification.

## What usually breaks

- An obsolete flag check hides lifecycle events or cancels queued runs.
- Removing the parent rollout accidentally removes the independent
  runtime-title flag.
- A read exposes another owner's run or webhook payload.

## What proof to collect

Record deployment SHA, signed-in doctor screenshot, bootstrap identity,
HTTP statuses, lifecycle event names, and run/agent IDs only. Capture
before/after discovery output. Run the core inbox cycle after deployment.
Targeted tests cover lifecycle creation, reuse, delivery, stop, ownership,
replay payloads, activity feeds without rollout flags, and the independent
runtime-title flag.

## Cleanup

Read-only checks create nothing. Remove only recorded disposable fixtures
created by this run, through approved product routes. Never revoke shared
QA credentials or change existing subscriptions.

## Scheduled manager chat activity

`POST /api/mcp/chat/activity` records a manager's cycle in its owner's
Agent Chat. This route has no rollout flag. Use an isolated QA-owned
agent token, not a human token or a standing runner's chat, for writes.
Post a unique `clientMessageId`, read the owner's transcript, and replay
that same request: one delivered assistant message must remain, attributed
to that agent, and the replay must return `duplicate: true`.
A human token remains refused with 403; an anonymous request gets 401.
Empty text or an invalid client ID gets 400 without writing.
Delete only the disposable conversation created by this run. If an
isolated agent credential is unavailable, record the successful write as
UNREACHABLE; exercise authenticated refusal and discovery instead.
