# My Tasks scope picker

[Approved Option A](https://app.hypertask.ai/detail/project-15/6567) is behind `htpr-6567-command-scope-picker`, default Owner + QA.

On `/my-tasks`, Scope in the toolbar or the Ctrl+K Boards group opens the existing Assign picker in board mode. Search by board name, toggle multiple boards without closing, select All boards to reset, or press Escape to close. Changes apply immediately to the existing My Tasks view configuration; saved views and their persistence are unchanged.

Columns, Completed tasks / Show done, and Show snoozed (when enabled) are in the existing Filters menu. Its count and Clear all include these controls. Table display Columns and Involvement are unchanged.

With the flag off, the original Scope panel and Filters behavior remain. This is client-side composition only: no new API or authorization path. The picker requires the existing My Tasks views and filter-parity flags, like the original Scope button.
