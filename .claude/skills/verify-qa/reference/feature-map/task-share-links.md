# Task share links

## How a customer reaches it

A board member opens a task and copies its share link (`POST /api/share/createShareLink`, signed in). The link is `https://app.hypertask.ai/share?id=<shareId>`. Someone who opens it sees the shared task (`/api/share/getSharedTask`); after they sign in or sign up, the app calls `POST /api/members/share` with the `shareId` to join them to the task's board (`joinProjectFromShareURL` in `src/hooks/General/useAuth.tsx`).

## How to drive it

1. As team owner 4036, create a share link for a task on **QA Team Board** (board 7283) through the task's share action, or `POST /api/share/createShareLink` with `{taskId, projectId}`.
2. Without any login, `POST /api/members/share` with `{"shareId":"<id>","userId":<any id>}`: must answer 401 JSON and add nobody.
3. Signed in as another QA account, `POST /api/members/share` with that `shareId` and a different user's `userId` in the body: only the signed-in account may join; the body `userId` is ignored (HTPR-7178).
4. Open the share URL signed in and confirm the shared task shows.

## What usually breaks

- Routes trusting a `userId` from the request body instead of the login (HTPR-7178 here, HTPR-7162 for board invites).
- Domain-restricted links showing the task to people outside the domain (HTPR-7174).

## What proof to collect

Checklist written before QA; the no-login response (status and body); the signed-in response and the board's member list showing only the signed-in account was added; a screenshot of the share page. Record account ids, never credentials.

## Cleanup

Remove any QA account that joined board 7283 only for this run, and delete the share link if the app allows it.
