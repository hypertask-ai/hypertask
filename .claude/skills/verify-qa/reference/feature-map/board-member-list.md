# Board member list

## How a customer reaches it

Board settings, Members section (`GET /api/members/getAll?projectId=<id>`, `src/components/Modals/Settings/MembersSection.tsx`), and the invite command dialog, which also lists teammates not yet on the board (`GET /api/members/getAll?projectId=<id>&teamMembers=true&teamId=<board team>`, `src/components/Modals/commands/inviteMember.tsx`).

## How to drive it

1. Signed in as QA account 985, open a board 985 can open that belongs to a team, then open the invite dialog: teammates not on the board are listed.
2. Call `GET /api/members/getAll?projectId=<that board>&teamMembers=true&teamId=<the board's team>` and save `teamMembers`.
3. Repeat with `teamId=<any other team id or a made-up id>`: `teamMembers` must be identical to step 2. The route uses the board's stored team and ignores the query (HTPR-7170).
4. Without any login the route answers 401; for a board the account cannot open it answers 404.

## What usually breaks

- Routes trusting an id from the request (team, user) instead of the authorized board or the login (HTPR-7170 here, HTPR-7178 for share links).

## What proof to collect

Checklist written before QA; the step 2 and step 3 responses showing the same team members (ids only, no emails in the proof); the 401 and 404 statuses; a screenshot of the invite dialog. Record account ids, never credentials.

## Cleanup

Read-only; nothing to clean up.
