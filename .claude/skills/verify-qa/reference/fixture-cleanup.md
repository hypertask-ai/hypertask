# Cleaning up a QA fixture

Test tickets on the QA boards are deleted, never archived. Deletion is two
calls in a fixed order, and the second call alone is a trap: it answers `404`
`Task not found or access denied` for a ticket that exists but has not been
moved to the trash, which reads as a missing ticket.

## One command

```text
.claude/skills/verify-qa/scripts/fixture-cleanup <state-file> <taskId...> [--base-url <origin>]
```

It reads the cookies for `app.hypertask.ai` from a Playwright storage state
(`qa-login flags --state` prints the flags account file), then for each id:

1. `POST /api/queues/tasks/taskDeleteReminder` with `{ taskId }` moves the
   fixture to the trash.
2. `DELETE /api/tasks/deleteTask?taskId=<id>` deletes it permanently.
3. `POST /api/tasks/getTaskMinimal` with `{ id }` confirms it is gone; `404`
   or `null` means gone.

Each id prints one line, `cleaned <id>` or `failed <id> <reason>`. The run
exits `0` when every id is cleaned, `1` when any failed, and `2` for unusable
arguments or when the state has no app cookie for one of the three endpoints.
Cookies are chosen per endpoint, so a path-restricted cookie only reaches its
own route. A fixture that is already gone reports `cleaned`, so a second run is
safe. Cookie values are never printed.

## By hand

Use the same three requests. Do not stop after the delete: it answers `200`
only once the trash step has run. A `409` naming a restore or another delete
in progress means the fixture is being changed elsewhere; retry once, then
report it instead of forcing the row away.

Only clean fixtures this run created, on the QA boards. Never delete a
customer ticket or another session's work.

## Logins, labels and switched settings

Ticket deletion does not undo these. Put each one back before the proof
says `Leftovers: none`. If it cannot be undone, name it on that line.

**Logins.** The shared accounts in [logins.md](logins.md) stay. Do not create
a new production user for a live run. If this run did create a user or an
invite, remove it through the same product screen that created it. Until it
is gone, the leftovers line names the user id. Never print a password,
cookie or login code.

**Labels.** Delete a label this run created with the same call the label
editor uses: `DELETE /api/labels/updateLabel?labelId=<id>&projectId=<id>&userId=<id>`,
from the QA state file. Take a label off a ticket you did not delete by
clearing it on that ticket. Leave labels that were already on the board.

**Switched settings.** Read the old value before you change a setting, then
write that value back with `POST /api/users/preferences`, the same route
Settings uses. Card parts, theme and notification choices are settings.
Read the saved value after the write and confirm it matches.

Write `Leftovers: none` only when nothing from this run remains; otherwise list the test logins, labels, switched settings, reminders and production rows you left in place.

A reminder on a ticket this command deletes is already cleared by the trash
step. A reminder left on any other ticket is a leftover. Name that ticket,
or clear the reminder, before you write `none`.
