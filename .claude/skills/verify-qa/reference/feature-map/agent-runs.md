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
   If no recorded run exists, mark positive read and cross-owner read
   UNREACHABLE; retain the successful webhook discovery as closest proof.
5. Read an invented run ID as QA 985 and require 404. Read that same
   ID without a login and require 401.
6. Stop only a disposable run this QA run created. Never stop a
   pre-existing run or replay its webhook during read-only verification.

## What usually breaks

- An obsolete flag check hides lifecycle events or cancels queued runs.
- Removing the parent rollout accidentally removes the independent
  activity or runtime-title flag.
- A read exposes another owner's run or webhook payload.

## What proof to collect

Record deployment SHA, signed-in doctor screenshot, bootstrap identity,
HTTP statuses, lifecycle event names, and run/agent IDs only. Capture
before/after discovery output. Run the core inbox cycle after deployment.
Targeted tests cover lifecycle creation, reuse, delivery, stop, ownership,
replay payloads, and the remaining independent flags.

## Cleanup

Read-only checks create nothing. Remove only recorded disposable fixtures
created by this run, through approved product routes. Never revoke shared
QA credentials or change existing subscriptions.
