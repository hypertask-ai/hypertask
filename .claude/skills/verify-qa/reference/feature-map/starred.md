# Starred tasks and comments

## How a customer reaches it

Open `/starred` in a fresh browser context, before saved content is cached.
Both lists must render safely while the saved-content request is pending.
Select **Starred Tasks** or **Starred Comments**.

## How to drive it

Use J/K or the arrow keys to select rows. Enter opens the selected task.
Alt+S removes a selected task star. Ctrl+Shift+S removes a selected comment
star (Cmd+Shift+S on Apple devices). Removing the last selected row leaves
the nearest remaining row selected. Switching to a shorter tab keeps a valid
selection. Repeating unstar on an empty list makes no request.

## What usually breaks

- A saved row index can outlive a removed row or a longer tab, causing
  shortcuts to crash instead of opening or unstarring the remaining item.
- Star writes must affect only the selected task or comment.

## What proof to collect

As QA 985, create two `[qa-runner]` tasks and a comment on QA Sandbox 7049.
Star both tasks and the comment. On `/starred`, select the second task, then
switch to the one-row comments tab. Press Ctrl+Shift+S. Confirm the comment
star disappears without a browser error. Reload and confirm it stays gone.
Capture desktop and phone screenshots and the saved-content API readback.

Local regression: `npm run test:file -- tests/htpr-8092-starred-selection.test.cjs`.
It dispatches document keyboard events through the real `StarredRow` component
for shorter lists, tab changes, empty lists, and opening the remaining task.

## Cleanup

Unstar and delete only the fixture tasks created by this run. Never change
other QA stars or comments.
