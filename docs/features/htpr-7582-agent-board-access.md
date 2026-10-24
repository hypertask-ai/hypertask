# Agent board-access requests

The calling agent uses `hypertask_request_board_access` (`hypertask_agents` action
`request_board_access`) with `project_id` and a plain-text `reason`. Its durable
receipt can be read with `hypertask_get_board_access_request` / action
`get_board_access_request`, using `request_id`. These tools require live agent
bearers. Read-role agents can inspect receipts but cannot create requests.

The human owner decides in Inbox → Decisions. Approval uses the existing Board
access grant, in the same Serializable transaction as the request and audit.
Decline, archive and seen changes never grant membership. An approved receipt
never regrants membership after removal. Scoped credentials cannot request a
foreign team; an unscoped agent can request an owner-visible other-team board,
but Approve stays disabled until the existing team predicate allows it.

Requests expire after seven days. New requests are limited to five per agent
per hour, twenty per owner per day and twenty active per owner. Decline, expiry
or cancellation impose a 24-hour agent/board cooldown. Replays preserve the
original reason, expiry and notification. Request and notification retention is
30 days after resolution; the authenticated hourly cron processes bounded batches.
Every read/mutation enforces expiry and current authority independently of cron.

The access-risk flag `htpr-7582-agent-access-request` defaults to Owner + QA.
Switching it Off cancels pending requests in the flag transition transaction.
Re-enable does not revive them. Approved memberships are not revoked by rollback.
Keep the additive schema on rollback. Generic task Inbox readers never receive
this taskless notification variant.

Audit uses the existing durable `Logs` table, type Board, with JSON event
`agent_board_access_request`. It contains request/agent/owner/target IDs,
credential class, operation, outcome and machine reason; never tokens or the
request's reason text. Grant and terminal audit insertions share the grant
transaction. Audit retention follows the existing Logs policy: no new purge or
promise of indefinite retention. Confirm that policy with Fable before release.

## UI reuse inventory

Existing Inbox/Decisions/date-group shell; NotificationRow timestamps; existing
comment-card tokens; native secondary/primary button classes from
AgentChatCreateModal; existing Board access link/disclosure/checkbox rows. The
new AgentBoardAccessDecision variant lives in NotificationRow because task,
invitation and AgentMessage rows cannot represent owner consent. No new page,
composer, navigation item, modal, team switcher or role picker is introduced.

## Follow-ups and release verification

- Zig CLI request-access/access-request dispatch, using the calling-agent bearer,
  is explicitly out of this app-only run.
- Carry the upstream MCP correlation ID into audit (accepted minor follow-up).
- Fable access review and live sandbox membership/access QA before release.
- Published wireframe remains Cloudflare Access protected; implementation uses
  the reviewed local authoring copy. Visually verify porcelain, graphite, AMOLED
  and Dia at desktop/phone sizes before release. No live writes or browser build
  were authorized for this implementation run.
