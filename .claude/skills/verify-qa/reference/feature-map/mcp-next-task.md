# Next-task pick

## Sub-features

- `next-task-pick` Next-task pick.

## How to get to it (user POV)

An agent asks for the next ticket with `GET /api/mcp/tasks/next?project_id=<id>`.
The in-app picker uses the same taken-work check. Opening one ticket uses
`GET /api/mcp/tasks/context?task_id=<id>&project_id=<id>`; both parameters are
required, and `ticket_number` is not parsed (the call answers 400
`task_id is required`).

## Driving it with agent-browser

1. Sign in as QA 985. Confirm Production is the merge SHA and `/my-tasks` is signed in.
2. Call next-task for project 15 with the QA session. Record the returned ticket numbers.
3. With `htpr-8896-skip-taken-work` on, a ticket that has an open pull request, a pending owner decision, another agent's active run, or an open recorded blocker is absent. Waiting fields may already be empty.
4. The caller's own active run stays pickable. A named column still returns the other tickets in that column.
5. Open task context for a ticket this session is working, with `task_id` and `project_id`. The response includes `agentActivities`.
6. Flag off restores the old pick and omits `agentActivities`. Use account 2343 only when that account does not have the flag.

```bash
TOKEN=<a QA agent bearer token>
curl -s "https://app.hypertask.ai/api/mcp/tasks/next?project_id=15" -H "Authorization: Bearer $TOKEN"
curl -s "https://app.hypertask.ai/api/mcp/tasks/context?task_id=<id>&project_id=15" -H "Authorization: Bearer $TOKEN"
```

`next` takes `project_id` (required), `limit` 1-50 default 10, plus `section`,
`labels` and `exclude_blocked`. `htpr-8786-picker-skips-other-agents` and
`htpr-8738-picker-skips-parked` also change the pick; the second nulls
`waitingOnUserId` and `blockerCommentId` in the rows it returns.

## Gotchas

- Cleared waiting fields make a pending decision look free.
- The filter drops the caller's own run.
- Task context with the flag on keeps `agentActivities`, but for non-terminal runs only: finished runs disappear from the log.

### What proof to collect

- Next-task JSON with ticket numbers, no tokens.
- One context response showing `agentActivities` is present.
- A signed-in `/my-tasks` screenshot.

### Cleanup

Read-only. Do not assign, move, or comment on tickets found by the pick.
