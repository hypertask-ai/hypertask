# Drag and drop

## Sub-features

- `drag-and-drop` Drag and drop.

## How to get to it (user POV)

Dragging a card between columns on a board view.

## Driving it with agent-browser

Verified on production 2026-11-20, board 7049. `@hello-pangea/dnd` emits
`data-rfd-*` attributes (not `data-rbd-*`), reads incremental mouse-move deltas,
and a plain `dragTo()` does not register.

1. Create your own fixture on the QA board (`POST /api/tasks/create` `{title,
   projectId:7049, userId:985}`), then open `/project?id=7049&surface=board`.
2. `page.locator('[data-rfd-draggable-id="task-<id>"]').scrollIntoViewIfNeeded()`.
   The board virtualizes long columns: a card that is in the DOM outside the
   window has no bounding box, so a drag fails until it is scrolled in.
3. Read the card's `data-rfd-droppable-id` (the column's **display index**,
   `0` = Todo, `1` = Doing on 7049) and pick a different target.
4. Mouse down at the card's center, then 8 small `mouse.move` steps toward the
   target column's box (card center x/y to target x/y, 50 ms apart), then
   `mouse.up`.
5. Expect the card to render in the target droppable. The move is optimistic;
   proof is the reload, not the animation.
6. `page.reload()`, wait for the board, and require the card inside
   `[data-rfd-droppable-id="<target>"]`. A card back in the source column means
   the write failed.
7. Drag it back into the source column, reload, and require the original
   column; then delete the fixture with
   `node .claude/skills/verify-qa/scripts/fixture-cleanup <state> <taskId>`.
8. A drop inside the same column is rejected with a toast when board sorting is
   UpdatedAt (`useHandleKeyDownOperations.ts`), so a reorder reads as a broken
   drag. Change columns for this check.

## Gotchas

- The card disappears from the rendered window after reload and looks lost:
  the column virtualizes, so scroll it into view before declaring a failure.
- A drop into a column with no cards can hit the save-view retry loop
  ([HTPR-6588](https://app.hypertask.ai/detail/project-15/6588), [HTPR-6550](https://app.hypertask.ai/detail/project-15/6550)).
- Board filters not re-applying immediately after a move ([HTPR-6595](https://app.hypertask.ai/detail/project-15/6595)).
- Drag-adjacent regressions have been rare lately; the last two on-record
  drag bugs are older ([HTPR-3564](https://app.hypertask.ai/detail/project-15/3564), timeframe button dragging, and
  [HTPR-5854](https://app.hypertask.ai/detail/project-15/5854), a mobile sheet drag crash). Don't assume a drag ticket has a
  matching bug pattern here; read the ticket's own repro.
- `e2e/smoke/journeys.spec.ts`'s `drag-card` case silently skips unless
  `HT_QA_JOURNEYS=1` and a `.state/qa-board.json` fixture exists.

### What proof to collect

Screenshot the board before the move (card in column A) and after (card in
column B, column A's empty state correct if it's now empty). Reload and
confirm both columns still show the moved card in the right place, not just
the optimistic UI update.

### Cleanup

Move the test card back to its original column, or delete it if you created
it for this check.
