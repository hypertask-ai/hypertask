# Next-task pick

## How a customer reaches it

An agent asks for the next ticket with `GET /api/mcp/tasks/next?project_id=<id>`.
The in-app picker uses the same taken-work check. Opening one ticket uses
`GET /api/mcp/tasks/context?ticket_number=HTPR-NNNN`.

## How to drive it

1. Sign in as QA 985. Confirm Production is the merge SHA and `/my-tasks` is signed in.
2. Call next-task for project 15 with the QA session. Record the returned ticket numbers.
3. With `htpr-8896-skip-taken-work` on, a ticket that has an open pull request, a pending owner decision, another agent's active run, or an open recorded blocker is absent. Waiting fields may already be empty.
4. The caller's own active run stays pickable. A named column still returns the other tickets in that column.
5. Open task context for a ticket this session is working. The response includes `agentActivities`.
6. Flag off restores the old pick and omits `agentActivities`. Use account 2343 only when that account does not have the flag.

## What usually breaks

- Cleared waiting fields make a pending decision look free.
- The filter drops the caller's own run.
- Task context hides the active agent log while the flag is on.

## What proof to collect

- Next-task JSON with ticket numbers, no tokens.
- One context response showing `agentActivities` is present.
- A signed-in `/my-tasks` screenshot.

## Cleanup

Read-only. Do not assign, move, or comment on tickets found by the pick.
