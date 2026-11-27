# Agent run lifecycle

## Sub-features

- `scheduled-manager-chat-activity` Scheduled manager chat activity.
- `logs-page` `/logs` (`src/app/logs/page.tsx`) lists rows from the logs table, newest first, grouped by day. User ids 4 and 6 see the list and a back control to home. Any other signed-in user is redirected to `/`. A signed-out visit goes to `/login`. This page is not the agent-run log. User 6 is Valentin. Agents never sign in as user 6. User 4 is not an approved QA account, so the list view is UNREACHABLE in QA.
- `agent-chatter-to-log` An agent comment with no kind is never refused. Its text is stored as a thought on a runtime agent run and the response says `routedTo: "log"`, `visibleToPeople: false` and that it went to the agent log. Kind `question`, `qa` or `done` stays on the ticket. With the writing policy on, `routeComment` in `src/lib/mcp/operations/comments/operation.ts` sends every untyped agent post to the run and checks board membership first; with the policy off and `htpr-7341-agent-chatter-to-log` on, the legacy route sends an untyped post with no reply, no person mention and no image to the run. The same rule holds for `POST /api/comments/create` and the in-chat `hypertask_add_comment` tool. Closest proof is `tests/htpr-9702-kindless-agent-comment.test.cjs`.
- `quiet-personal-logs` With `htpr-7786-quiet-personal-logs` on, server lines for task writes, sign-in, billing, invites and push keep record ids and emails found in the payload, and leave out the request body, display names and device tokens. A failed flag read stays quiet. Flag off prints the raw object. These lines do not appear on `/logs`.
- `abandoned-work` With `htpr-8909-abandoned-work` on, `GET /api/cron/abandoned-work` runs every 30 minutes on boards 15 and 4060. It returns quiet In Progress tickets to the intake they came from (Bugs, Improvements or Features on board 15, from the prior section or a bug or feature label; Backlog on board 4060). An unanswered owner question goes to Valentin Review instead. It keeps a live lease, a human assignee, and an unassigned ticket whose agent run was active in the last 6 hours. Agent assignees are removed. The ticket comment says `Returned abandoned work to` the destination, and open pull requests stay linked. An unassigned ticket with no run in 6 hours is released even when a comment is newer. Flag off returns `enabled: false` and moves nothing. `?dry=1` plans without writing.

## How to get to it (user POV)

Agents use `GET /api/mcp/agents/runs/<runId>` and bodyless
`POST /api/mcp/agents/runs/<runId>/stop`. Owners can use the same
routes with their browser session. Webhook subscriptions expose
`run.created`, `run.prompted`, and `run.stopped` through the agent's
webhook settings. Only user ids 4 and 6 can open `/logs` for the stored
log list. Agents never sign in as user 6, and user 4 is not an approved
QA account, so that list is UNREACHABLE in QA. Agent chatter, quiet
server lines and the abandoned-work cron are not screens on that page.

## Driving it with agent-browser

1. Sign in as QA 985. Require authenticated bootstrap user 985.
2. Read `/api/agent-sidebar-chats?projectId=7049` to discover the
   existing QA Sandbox agents without seeding new agents.
3. Read `/api/agents/<owned-agent-id>/webhook`. Require all three
   lifecycle event names in `availableEvents` and a `subscribable: true`
   definition for each in `eventDefinitions`
   (`src/app/api/agents/[agentId]/webhook/route.ts:46-66`). Never save
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
7. Record the `/logs` day list as UNREACHABLE. `src/app/logs/page.tsx`
   renders it only for user ids 4 and 6. User 6 is Valentin. User 4 is
   not an approved QA account. Never sign in as user 6. Closest proof is
   that page. Open `/logs` as QA 985 and require the redirect home. Open
   it signed out and require `/login`. Do not insert a log row.
8. Do not post on a shared ticket to force chatter routing. An untyped
   agent comment is a 2xx that names the agent log, never a 400. Record
   the live log receipt from the run, not the ticket thread. Closest proof
   is `tests/htpr-9702-kindless-agent-comment.test.cjs`. Kind
   `question`, `qa` or `done` stays a people comment.
9. For quiet server lines, require ids and emails and the absence of the
   raw body. Never paste a live request body into evidence.
10. Do not call the production abandoned-work cron. Read
    `tests/htpr-8909-abandoned-work.test.ts` for keep and release. A dry
    call needs cron authorization and still must not be aimed at production
    during this map check.

### Hands-free drive on production

```bash
node .claude/skills/verify-qa/scripts/feature-map-drive.mjs agent-runs --dir /tmp/feature-map-drive
```

Prints `PASS` or `FAIL` per step, writes `result.json` and screenshots into `--dir`, and ends with
`agent-runs ok`. It refuses any base except `https://app.hypertask.ai`, uses the `qa-login` identities,
creates only fixtures its own cleanup removes, and never prints a cookie, token or email address.

## Gotchas

- An obsolete flag check hides lifecycle events or cancels queued runs.
- Removing the parent rollout accidentally removes the independent
  runtime-title flag.
- A read exposes another owner's run or webhook payload.
- `/logs` is treated as the agent-run log. They are different stores.
- An untyped agent comment is refused instead of stored on its run.
- When the abandoned-work release count and the hand count disagree, that board is left unchanged.
- A capacity comment is posted on the oldest remaining In Progress ticket when the remainder exceeds live runners plus 3 and no such alert was posted in the last day.

### What proof to collect

Record deployment SHA, signed-in doctor screenshot, bootstrap identity,
HTTP statuses, lifecycle event names, and run/agent IDs only. Capture
before/after discovery output. Run the core inbox cycle after deployment.
Targeted tests cover lifecycle creation, reuse, delivery, stop, ownership,
replay payloads, activity feeds without rollout flags, and the independent
runtime-title flag.

### Cleanup

Read-only checks create nothing. Remove only recorded disposable fixtures
created by this run, through approved product routes. Never revoke shared
QA credentials or change existing subscriptions.

### Scheduled manager chat activity

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
