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
arguments or a state file without an app cookie. A fixture that is already
gone reports `cleaned`, so a second run is safe. Cookie values are never
printed.

## By hand

Use the same three requests. Do not stop after the delete: it answers `200`
only once the trash step has run. A `409` naming a restore or another delete
in progress means the fixture is being changed elsewhere; retry once, then
report it instead of forcing the row away.

Only clean fixtures this run created, on the QA boards. Never delete a
customer ticket or another session's work.
