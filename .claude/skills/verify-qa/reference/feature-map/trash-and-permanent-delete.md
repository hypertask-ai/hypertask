# Trash and permanent delete

## How a customer reaches it

From a board, press `G` then `#`, or run `Go to trash` in the command palette
(`src/components/generalCommandActions.ts`). Both open
`https://app.hypertask.ai/trash/<boardId>` (`src/app/trash/[projectId]/page.tsx`)
with the heading `<board> - Trash`.

A task lands there when it is deleted: `#` on a board, Delete in the task card
menu, or the CLI. Deleting is a 30-day move, not a removal. Pressing `#` again
inside the trash removes it for good.

## How to drive it

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
   shows creator, title and the permanent-delete date.
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

Drive the refusals too, with ids you create for it. Permanent delete of a live
task answers 409 "Task is not in the trash". Permanent delete of a task you
cannot see answers 404 "Task not found or access denied". A task whose hard
delete is already claimed answers 409 "Task is being restored or permanently
deleted".

Read titles, not screen position: the list container is `flex-col-reverse`, so
the newest row (`#trash-0`, selected by default) sits at the bottom of the screen
and the oldest at the top.

## What usually breaks

- Agents cannot do this at all: they may archive, not delete
  ([HTPR-8215](https://app.hypertask.ai/detail/project-15/8215),
  [HTPR-8231](https://app.hypertask.ai/detail/project-15/8231)). Drive the writes
  as the QA human account, never an agent token.
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

## What proof to collect

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

## Cleanup

Permanently delete the fixture, then reload the trash and confirm the row is
gone and no other task changed. If a delete claim is stuck, recover the task,
wait out the 30-minute claim and start again: never leave a fixture sitting in
the trash of a board that is not yours.
