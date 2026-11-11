# Feature flag switch API

## Sub-features

- `release-column-safety` Release-column safety.

## How to get to it (user POV)

Agents owned by the flag owner switch flags through `PATCH /api/mcp/flags` (script `.claude/skills/ship/scripts/ht-flag set KEY MODE --reason <ticket URL>#comment-<id>`). Approval may use Valentin’s thumbs up or a supported yes on a switch question. The trusted HT Product Lead can also send `ownerRequest` with a source comment URL, exact quote, and request time, attesting Valentin’s intent for the requested flag and mode. The source must be unedited and accessible; explicit refusals and later withdrawals are rejected. Human comments order by time and comment ID; trusted chat records use the actual request time. `GET /api/mcp/flags` (`ht-flag get`) reads the modes. For a failed live QA, flag-owner write/admin agents hold the flag at Owner + QA with `ht-flag set KEY owner-qa --failure "reason or evidence URL"`. A hold only narrows who sees the flag, so this path needs no approval, including for high-risk, bugfix and unclassified flags. The failure reason must be nonblank and at most 300 characters. A hold applies only to a flag that is on for Everyone: Off, Owner and Owner + QA are refused, so a hold never widens an audience and never overrides an Off Valentin approved. Repeating the current mode is refused, and re-enabling any Off flag needs the ordinary approved switch. Runners never switch a flag Off: Off is Valentin's own safety switch, set on the admin page or through an approved switch. Other modes keep their approval requirements. Valentin also switches flags by hand on https://app.hypertask.ai/admin/flags, which only his login opens.

## Driving it with agent-browser

**Hands-free drive, every flag-state change:**
`node .claude/skills/verify-qa/scripts/flags-drive-live.mjs <folder> --base http://127.0.0.1:3100 --state <storageState.json>`
reads `GET /api/flags` with the seeded session, tries `PATCH /api/mcp/flags`
without an agent token, expects 401 or 403, then reads the flag states again
and expects them unchanged. It prints `PASS` or `FAIL` per step and ends with
`flags ok`. It refuses any base that is not loopback, so it never switches a
production flag. `--break refusal` answers the switch with HTTP 200 on
purpose; the run must then end with `negative control ok`. The runner check
on a real agent token is still `ht-flag get` and a refused `ht-flag set <key> <its current mode> --reason <ticket URL>#comment-<id>` that is not an approved flag question: 403, then the mode unchanged. Failure-hold validation can safely use an unknown key (400), an empty failure reason (400), or an unrestricted mode (Everyone, Owner, Off) with failure evidence (403). Read the same known flag before and after to prove it stayed unchanged. Actual successful hold, retry and audit/rollback behavior is covered against disposable local data. Record live successful switches UNREACHABLE when no approved disposable flag exists.

## Gotchas

- An approval that survives an edit to the comment, so one thumbs up switches a different key or mode (HTPR-7181).
- The approval check running outside the flag write, so an edit, a removed thumbs up or a deleted ticket lands between check and write (HTPR-7181).
- A failing approval check mapped to 500 instead of 403.
- A read-only agent gaining emergency failure-hold access when the ordinary role-guard flag is disabled.
- Repeated failure-hold requests creating duplicate history, or a failed flag write leaving history behind.

### What proof to collect

Checklist written before QA; `ht-flag get` before and after; the 403 response body for the refusal path (text plus a rendered screenshot). Doctor: merge SHA production deployment success and /my-tasks signed in with a QA account. Non-Off approved switches need Valentin's decision; record them UNREACHABLE without it. A successful failure hold needs no approval but changes live behavior; do not touch a real flag just for proof. Record that path UNREACHABLE without an approved disposable flag, and point at route tests plus disposable PostgreSQL transaction evidence.

### Cleanup

None when only the refusal path and reads were used.

### Release-column safety

Board 15 moves into **Flag: Everyone** must refuse tickets whose own or explicitly mentioned flag is not Everyone. The shared task-update boundary covers board moves, direct task updates and CLI/MCP moves. Ordinary columns and other boards stay unchanged.

Use a temporary ticket created by your own agent, linking a currently restricted flag in its description. Before testing, record its original column. Moving it to Flag: Everyone must return `FLAG_COLUMN_MISMATCH`, name the restricted flag, and leave its original column after rereading. Remove the link from this fixture only, repeat the move to prove an unflagged ticket still moves, then archive the fixture. Never change a real ticket or switch a flag for this test.

`GET /api/cron/flag-column-audit` runs daily at 04:43 UTC with cron authorization. It returns `{ checked, mismatches }` for active board 15 tickets in Flag: Everyone, lists restricted flag keys and modes, and never changes a ticket or flag. Missing authorization returns 401; a missing release column returns 500. If cron authorization is unavailable, use approved CLI reads of that column and `ht-flag get`, checking the same restrictions. Include a restricted fixture as a positive control, even when the column is empty.

A runner is not a manager, so `ht-flag get` and the refused `ht-flag set` above do not send `X-Manager-Grant`. While `yper4-801-manager-lease-flag-switch` is on, a manager-class agent must send the current lease receipt on `PATCH /api/mcp/flags`. A replaced, released, expired, or missing receipt is refused and the flag stays unchanged. Flag off keeps today's approval checks only. The registry at `POST /api/mcp/manager-leases` confirms take, renew, release, and handoff. A repeated operation id returns the stored result. A lost reply is not success unless status or the same operation id says it was saved. Do not switch `yper4-801-manager-lease-flag-switch` during this check.
