# My Tasks scope picker

[Approved Option A](https://app.hypertask.ai/detail/project-15/6567) is behind `htpr-6567-command-scope-picker`, default Owner + QA.

On `/my-tasks`, Scope in the toolbar or the Ctrl+K Boards group opens the existing Assign picker in board mode. Search by board name, toggle multiple boards without closing, select All boards to reset, or press Escape to close. Changes apply immediately to the existing My Tasks view configuration; saved views and their persistence are unchanged.

Columns, Completed tasks / Show done, and Show snoozed (when enabled) are in the existing Filters menu. Its count and Clear all include these controls. Table display Columns and Involvement are unchanged.

## No board tab row (HTPR-6940)

`htpr-6940-drop-board-tabs` removes the second row of tabs on `/my-tasks`, on desktop and phone. The saved view tabs stay on top. Boards are picked with Scope, which this doc covers, and seen with Group: Board, where each board section keeps its ticket count and its overdue number. The Tab key no longer cycles boards; the remembered board is not restored. With the flag off, the board row, its Tab cycling and the remembered board return unchanged.
