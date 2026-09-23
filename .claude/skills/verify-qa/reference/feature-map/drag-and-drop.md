# Drag and drop

## How a customer reaches it

Dragging a card between columns on a board view.

## How to drive it

`@hello-pangea/dnd` (the board's drag library) reads incremental mouse-move
deltas, not a single jump, so a plain `dragTo()` call won't register.
`e2e/smoke/journeys.spec.ts`'s `drag-card` test does it right: mouse down on
`[data-rbd-drag-handle-draggable-id="task-<id>"]`, several small `mouse.move`
steps toward `[data-rbd-droppable-id]` for the target column, then
`mouse.up`. Copy that step shape. It waits ~500ms after `mouse.up` for the
`PUT /api/tasks/moveTask` call to land, then reloads.

## What usually breaks

- Column save-view retries looping on an empty column once a card leaves it
  ([HTPR-6588](https://app.hypertask.ai/detail/project-15/6588), [HTPR-6550](https://app.hypertask.ai/detail/project-15/6550)).
- Board filters not re-applying immediately after a move ([HTPR-6595](https://app.hypertask.ai/detail/project-15/6595)).
- Drag-adjacent regressions have been rare lately; the last two on-record
  drag bugs are older ([HTPR-3564](https://app.hypertask.ai/detail/project-15/3564), timeframe button dragging, and
  [HTPR-5854](https://app.hypertask.ai/detail/project-15/5854), a mobile sheet drag crash). Don't assume a drag ticket has a
  matching bug pattern here; read the ticket's own repro.

## What proof to collect

Screenshot the board before the move (card in column A) and after (card in
column B, column A's empty state correct if it's now empty). Reload and
confirm both columns still show the moved card in the right place, not just
the optimistic UI update.

## Cleanup

Move the test card back to its original column, or delete it if you created
it for this check.
