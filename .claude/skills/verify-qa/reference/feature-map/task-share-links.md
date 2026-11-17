# Task share links

## Sub-features

- `task-share-links` Task share links.
- `board-read-only-share` `/share/project` (`src/app/share/project/page.tsx`) opens with `?id=<invite key>`. The invite dialog copies it as the read-only view (`src/components/Modals/commands/inviteMember.tsx`). A live key shows that board's columns and tickets with no editing, the document title `<board> • Hypertask`, and the line `Part of the team? You're almost there to begin working in Hypertask` plus **Sign up or Login**, which opens `/invite?key=<invite key>`. A missing, unknown, or expired key does not show the board.
- `agent-task-share` With `htpr-8216-agent-task-share` on, an agent token can `POST /api/mcp/tasks/share` with `{ "taskId": <id> }` and `GET /api/mcp/tasks/share?taskId=<id>`. A successful body is `{ success: true, share }` where `share.link` is `/share?id=<shareId>`, `share.isPublic` is true when a live share exists and the task is not Deleted, and a second POST reuses that live share. Flag off, both answers are 404 `{ "success": false, "error": "Ticket sharing is not enabled" }`. A Deleted task or a board whose status is not Normal answers 403 `This board does not allow sharing a ticket` on POST. Default mode is Owner + QA.

## How to get to it (user POV)

A board member opens a task and copies its share link (`POST /api/share/createShareLink`, signed in). The link is `https://app.hypertask.ai/share?id=<shareId>`. The board read-only link is `/share/project?id=<invite key>`, copied from the invite dialog. An agent with `htpr-8216-agent-task-share` uses `POST /api/mcp/tasks/share` and reads the same link back with GET. Someone who opens it sees the shared task (`/api/share/getSharedTask`); after they sign in or sign up, the app calls `POST /api/members/share` with the `shareId` to join them to the task's board (`joinProjectFromShareURL` in `src/hooks/General/useAuth.tsx`).

## Driving it with agent-browser

1. As team owner 4036, create a share link for a task on **QA Team Board** (board 7283) through the task's share action, or `POST /api/share/createShareLink` with `{taskId, projectId}`.
2. Without any login, `POST /api/members/share` with `{"shareId":"<id>","userId":<any id>}`: must answer 401 JSON and add nobody.
3. Signed in as another QA account, `POST /api/members/share` with that `shareId` and a different user's `userId` in the body: only the signed-in account may join; the body `userId` is ignored (HTPR-7178).
4. Open the share URL signed in and confirm the shared task shows.
5. As owner 4036, copy **Read only view** from the invite dialog. Open `/share/project?id=<invite key>` signed out. The board columns show, and **Sign up or Login** goes to `/invite?key=<invite key>`. Open `/share/project` with no `id`, and again with an expired key, and confirm the board does not show.
6. With `htpr-8216-agent-task-share` on for the agent user, `POST /api/mcp/tasks/share` for a Normal task on board 7283. Expect 200, `share.isPublic` true, and `share.link`. GET the same `taskId` and expect the same link. Call POST again and expect that same link, not a second row. Flag off, both calls answer 404 `Ticket sharing is not enabled`.

## Gotchas

- Routes trusting a `userId` from the request body instead of the login (HTPR-7178 here, HTPR-7162 for board invites).
- Domain-restricted links showing the task to people outside the domain (HTPR-7174).
- `/share/project` reads an invite id, not a task share id. A task link is `/share?id=<shareId>`. POST share refuses a Deleted task and a board that is not Normal. GET still returns `isPublic: false` for a Deleted task.

### What proof to collect

Checklist written before QA; the no-login response (status and body); the signed-in response and the board's member list showing only the signed-in account was added; a screenshot of the share page. Record account ids, never credentials.

### Automated evidence

`node --test tests/htpr-7178-share-join-session-user.test.cjs` exercises the share-join route: signed-out calls add nobody, and signed-in calls ignore a different userId in the body.

### Cleanup

Remove any QA account that joined board 7283 only for this run, and delete the share link if the app allows it.
