# Trash and permanent delete

## Sub-features

- `trash-and-permanent-delete` Trash and permanent delete.
- `archived-list` `/archived` (`src/app/archived/page.tsx`) is the Archive screen. G then E, or **Go to archived tasks**, opens it. The title is Archive. Tabs are Tasks Archive and Inbox Archive. Tab switches them. `/archived?inbox=true` opens Inbox Archive (G then R, or **Go to archived inbox**). Scopes are Active boards, All boards, and Archived boards. The first paint is active boards. Escape goes back.
- `agent-archive-or-trash` With `htpr-8215-agent-archive-delete` on, an agent token can `POST /api/mcp/tasks/archive` or `POST /api/mcp/tasks/delete` with exactly one of `task_id`, `ticket_number`, or `project_id` plus `unique_index`. Archive sets status Archive. Delete calls the same Trash write as the app (`POST /api/queues/tasks/taskDeleteReminder`) and returns the task with `permanentlyDeleteAt`. Flag off, the route answers 404 `Task archive is not enabled` or `Task delete is not enabled`. This does not permanently delete. Default mode is Everyone.
- `agent-archive-done` With `htpr-8231-agent-archive-done` on, an agent write that sets a ticket in a Done column to Archive is allowed. Setting that ticket to Deleted still answers 403 `{ "message": "Authenticated agents cannot delete tasks in Done", "code": "agent_done_lifecycle_denied" }`. Flag off, Archive from a Done column is refused with that same 403. Default mode is Owner + QA.

## How to get to it (user POV)

From a board, press `G` then `E`, or run `Go to archived tasks`, to open `/archived`. Press `G` then `#`, or run `Go to trash`, to open
`https://app.hypertask.ai/trash/<boardId>` (`src/app/trash/[projectId]/page.tsx`)
with the heading `<board> - Trash`. `Go to trash` calls `redirectToTrash` in
`src/components/generalCommandActions.ts`, which pushes `/trash/<current board id>`.
`Go to archived tasks` pushes `/archived`.

A task lands there when it is deleted: `#` on a board, Delete in the task card
menu, or the CLI. Deleting is a 30-day move, not a removal. Pressing `#` again
inside the trash removes it for good.

## Driving it with agent-browser

Headless `agent-browser` against production, with the QA account 985 state file
`~/.config/hypertask-videos/storageState-qa.json`, on a board you own. Drive the
same calls the page drives, in this order.

1. Create one fixture task on the sandbox board and keep its id.
2. Trash it with `POST /api/queues/tasks/taskDeleteReminder` and body
   `{taskId}`. `src/pages/api/queues/tasks/taskDeleteReminder.ts` sets status
   `Deleted`, `deletedAt` now, `permanentlyDeleteAt` 30 days out (`30 Days from
   now`) and schedules the QStash job that hard-deletes it on that date.
3. Open `/trash/<boardId>`. `src/utils/controllers/trash/getByProjectId.ts`
   returns that board's tasks with status `Deleted`, newest `deletedAt` first.
   Each row carries id `trash-<index>`, so the first row is `#trash-0`, and
   shows creator, board ticket id, title and the permanent-delete date.
4. Keys, from `src/lib/contexts/Trash/handleKeyboardFunctions.ts`: `j` and `k`
   move the selection, `Escape` goes back to the board, `Shift+3` recovers, and
   `Ctrl+Shift+3` permanently deletes. The two icon buttons appear only on the
   selected row and ask for a confirm dialog reading "Clicking confirm will
   permanently delete this task. This action cannot be reverted."
5. Recover with `POST /api/tasks/recoverTask` and body `{taskId}`
   (`src/lib/api/task-writes/recover.ts`): the row leaves the trash, the task is
   back on its board as `Normal`, and the scheduled delete job is cancelled.
   Recovering a task whose hard delete already started is refused.
6. Trash it again, then permanently delete with
   `DELETE /api/tasks/deleteTask?taskId=<id>` and expect 200 `Success`; the same
   call again answers 404. `src/utils/controllers/tasks/invokeTaskDelete.ts`
   deletes the whole same-board task tree with the parent, so trash a parent and
   a child together and confirm both are gone.

Open `/archived` and confirm Tasks Archive, the active-boards scope, and a count. Press Tab and confirm Inbox Archive. Open `/archived?inbox=true` and confirm Inbox Archive is already selected. Escape returns to the previous screen.

With `htpr-8215-agent-archive-delete` on, `POST /api/mcp/tasks/archive` for a fixture not in a Done column. Expect 200 and status Archive, then see that task on `/archived`. `POST /api/mcp/tasks/delete` for a second fixture not in a Done column. Expect 200 and a `permanentlyDeleteAt` about 30 days out, then see it on `/trash/<boardId>`. Flag off, both routes answer 404. With `htpr-8231-agent-archive-done` off, archive of a fixture in a Done column answers 403 `Authenticated agents cannot delete tasks in Done`. Turn `htpr-8231-agent-archive-done` on and expect that archive to return 200, while delete of a Done-column fixture still answers 403.

Drive the refusals too, with ids you create for it. Permanent delete of a live
task answers 409 "Task is not in the trash". Permanent delete of a task you
cannot see answers 404 "Task not found or access denied". A task whose hard
delete is already claimed answers 409 "Task is being restored or permanently
deleted".

Row `#trash-0` is the newest deleted task, it carries the selection on load,
and only the selected row shows the two icon buttons: `Trash2` first, then
`RotateCcw`. The confirm dialog is a command list, `Delete task` with ENTER and
`Cancel` with ESC, so ESC closes it and leaves the row in place.

## Gotchas

- Permanent delete on the trash page stays a human write. `htpr-8215-agent-archive-delete` lets an agent archive or move a ticket to Trash. It does not call `DELETE /api/tasks/deleteTask`. `htpr-8231-agent-archive-done` allows Archive out of a Done column and still refuses Deleted. Drive permanent delete as the QA human account.
- Permanent delete of a live task used to answer "Task not found or access
  denied", which read as a missing ticket instead of a refusal
  ([HTPR-8431](https://app.hypertask.ai/detail/project-15/8431)).
- A hard delete holds a claim for 30 minutes
  (`HARD_DELETE_PROCESSING_TIMEOUT_MINUTES`). A run that dies mid-delete leaves
  the task in the trash and retries answer 409 until the claim goes stale.
- A due task is also hard-deleted by the hourly sweep
  (`src/pages/api/queues/sweep.ts`), so "it never went away" and "it vanished
  early" are both possible and both need the `permanentlyDeleteAt` value.
- The recover tooltip shows `#` while the binding that works is `Shift+3`.
- Legacy cross-board sub-tasks are detached instead of trashed with the parent
  ([HTPR-7187](https://app.hypertask.ai/detail/project-15/7187)).

### What proof to collect

Four screenshots, all on the same fixture: the board before deleting, the trash
row with its permanent-delete date, the board after recovering, and the trash
after the permanent delete with the task gone. For each write record the fixture
id, the board id, the account (985), the status and message returned, and the
`permanentlyDeleteAt` value read back from trash. Reload between steps; the page
reads the server, so a reload is the only honest check.

### Automated evidence

`node --test tests/feature-map-shape.test.cjs` holds this page to the five
headings and the `INDEX.md` link.
`node .claude/skills/maintain-verification-skill/scripts/feature-map-check.mjs`
re-checks that every path and route named above still exists.
`node --test tests/htpr-8431-trash-message.test.cjs` covers the 409 for a live
task, `node --test tests/task-hard-delete-auth.test.cjs` the hard-delete access
rules, and `node --test tests/htpr-7185-delete-task-undo.test.cjs` the board-side
delete and undo.

### Cleanup

Permanently delete the fixture, then reload the trash and confirm the row is
gone and no other task changed. If a delete claim is stuck, recover the task,
wait out the 30-minute claim and start again: never leave a fixture sitting in
the trash of a board that is not yours.
