# Feature flag switch API

## How a customer reaches it

Agents owned by the flag owner switch flags through `PATCH /api/mcp/flags` (script `.claude/skills/ship/scripts/ht-flag set KEY MODE --reason <ticket URL>#comment-<id>`). The switch counts only when Valentin gave his own thumbs up, within 7 days, on an unedited comment whose whole text is `Question: Switch <flag-key> to <mode>?`. `GET /api/mcp/flags` (`ht-flag get`) reads the modes. For emergency Off, flag-owner write/admin agents use `ht-flag set KEY off --failure "reason or evidence URL"`. This path needs no approval, including for high-risk, bugfix and unclassified flags. The failure reason must be nonblank and at most 300 characters; already-Off requests are refused. Other modes keep their approval requirements. Valentin also switches flags by hand on https://app.hypertask.ai/admin/flags, which only his login opens.

## How to drive it

With the runner's own agent identity, `ht-flag get` must list the flags. For the refusal path, `ht-flag set <key> <its current mode> --reason <ticket URL>#comment-<id>` pointing at a comment that is not an approved flag question must answer 403 with the approval error text, and a fresh `ht-flag get` must show the flag mode unchanged. Never switch a production flag merely for QA. Emergency-Off validation can safely use an unknown key (400), an empty failure reason (400), or a non-Off mode with failure evidence (403). Read the same known flag before and after to prove it stayed unchanged. Actual successful Off, retry and audit/rollback behavior is covered against disposable local data. Record live successful switches UNREACHABLE when no approved disposable flag exists.

## What usually breaks

- An approval that survives an edit to the comment, so one thumbs up switches a different key or mode (HTPR-7181).
- The approval check running outside the flag write, so an edit, a removed thumbs up or a deleted ticket lands between check and write (HTPR-7181).
- A failing approval check mapped to 500 instead of 403.
- A read-only agent gaining emergency-Off access when the ordinary role-guard flag is disabled.
- Repeated Off requests creating duplicate history, or a failed flag write leaving history behind.

## What proof to collect

Checklist written before QA; `ht-flag get` before and after; the 403 response body for the refusal path (text plus a rendered screenshot). Doctor: merge SHA production deployment success and /my-tasks signed in with a QA account. Non-Off approved switches need Valentin's decision; record them UNREACHABLE without it. A successful emergency-Off switch needs no approval but changes live behavior; do not flip a real flag just for proof. Record that path UNREACHABLE without an approved disposable flag, and point at route tests plus disposable PostgreSQL transaction evidence.

## Cleanup

None when only the refusal path and reads were used.

## Release-column safety

Board 15 moves into **Flag: Everyone** must refuse tickets whose own or explicitly mentioned flag is not Everyone. The shared task-update boundary covers board moves, direct task updates and CLI/MCP moves. Ordinary columns and other boards stay unchanged.

Use a temporary ticket created by your own agent, linking a currently restricted flag in its description. Before testing, record its original column. Moving it to Flag: Everyone must return `FLAG_COLUMN_MISMATCH`, name the restricted flag, and leave its original column after rereading. Remove the link from this fixture only, repeat the move to prove an unflagged ticket still moves, then archive the fixture. Never change a real ticket or switch a flag for this test.

`GET /api/cron/flag-column-audit` runs daily at 04:43 UTC with cron authorization. It returns `{ checked, mismatches }` for active board 15 tickets in Flag: Everyone, lists restricted flag keys and modes, and never changes a ticket or flag. Missing authorization returns 401; a missing release column returns 500. If cron authorization is unavailable, use approved CLI reads of that column and `ht-flag get`, checking the same restrictions. Include a restricted fixture as a positive control, even when the column is empty.
