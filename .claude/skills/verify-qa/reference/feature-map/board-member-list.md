# Board member list

## How a customer reaches it

Settings > Board > Members (`src/components/Modals/Settings/BoardMembersSection.tsx`) lists board members through `GET /api/members/getAllForAssignees?projectId=<id>`. Settings > Team > Members (`src/components/Modals/Settings/MembersSection.tsx`) lists team members and uses `GET /api/members/getAll?projectId=<id>` for board roles only. The invite command dialog also lists teammates not yet on the board (`GET /api/members/getAll?projectId=<id>&teamMembers=true&teamId=<board team>`, `src/components/Modals/commands/inviteMember.tsx`).

## How to drive it

1. Signed in as QA account 985, open an approved QA board belonging to a team, then open the invite dialog: teammates not on the board are listed.
2. Call `GET /api/members/getAll?projectId=<that board>&teamMembers=true&teamId=<the board's team>` and save `teamMembers`.
3. Repeat with `teamId=<any other team id or a made-up id>`: `teamMembers` must be identical to step 2. The route uses the board's stored team and ignores the query (HTPR-7170).
4. With a valid positive integer `projectId`, no login answers 401; a signed-in account that cannot open that board gets 404. Missing or invalid `projectId` returns 200 with `[]` before authentication, so it is not an auth-denial probe.

## What usually breaks

- Routes trusting an id from the request (team, user) instead of the authorized board or the login (HTPR-7170 here, HTPR-7178 for share links).

## What proof to collect

Checklist written before QA; the step 2 and step 3 responses showing the same team members (ids only, no emails in the proof); the 401 and 404 statuses; a screenshot of the invite dialog. Record account ids, never credentials.

## Cleanup

The member-list API reads need no cleanup, but opening the invite dialog fetches the public board join link. If none exists, that GET creates an invite and analytics intent and starts processing it. Follow the agent-list seeding precautions in [Agents and board access](agents-board-access.md) before opening the picker too. Use an approved QA board with an existing link and no required agent seeding for a read-only run. Otherwise record the creation without saving the join URL and do not call the run read-only. Do not reset a shared join link or delete analytics records as cleanup.
