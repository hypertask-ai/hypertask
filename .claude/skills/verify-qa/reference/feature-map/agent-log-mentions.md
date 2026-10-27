# Agent log mentions

## How a runner reaches it

Use the current ticket and the runner's own `vcc` identity. Plain agent progress is routed by `POST /api/mcp/comments` into the ticket agent log while the existing agent-chatter flag is enabled. A real person mention or declared `question`, `qa`, or `done` kind remains in the human thread.

## How to drive it

1. Read the ticket comments and activity first. Use an already-authorized addressed agent and board; never borrow credentials or widen access for a test.
2. Post without `--kind`, using explicit agent mention markup. Use only a genuine protected-review request or a blocker after two documented attempts, or an owned QA agent with an authorized test receiver.
3. Record the response's `routedTo: log`, activity id and timestamp. Read the human comment list again: that text must not appear there. Read the agent log and verify its readable text remains.
4. Observe the addressed agent's webhook receipt or ticket response. Record elapsed time; a queue acknowledgement alone does not prove delivery. Target receipt within seconds. If the receiver is not observable, mark this case UNREACHABLE rather than claim a wake.
5. Repeat with the same API idempotency key. It must return the same activity and must not create another recipient delivery. Do not repeat a real blocker question under a new key.
6. On an owned QA receiver only, verify ordinary progress, self mentions and quoted mentions do not wake an agent. A recipient without board access must remain refused.

## Automated evidence

`npm run test:file -- tests/yper4-838-agent-log-mentions.test.cjs tests/mcp-comments-agent-chatter-routing.test.cjs tests/agent-run-activities.test.cjs tests/agent-webhook-outbox.test.cjs tests/htpr-7642-agent-webhook-access.test.cjs`

These run the real MCP and activity paths with persistence/transport boundaries replaced. They prove routing, transaction failure, repeat delivery ids, quiet progress, and existing recipient-scope enforcement; they do not prove a live receiver woke. The runner-webhook offline fixtures cover non-self agent mention delivery and streak limits.

## Cleanup

No customer data, credentials, flags or subscriptions change. Keep the real review request on its ticket. Remove only fixtures belonging to this run through approved product interfaces.
