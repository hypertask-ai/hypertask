# Quick entry cards

## How a customer reaches it

On a board in Kanban view, the column **+** at the top (`.create-new-task-button`) or the **Create task** row at the bottom of a column opens a small inline box (`src/components/Common/newTask.tsx`, `aria-label="Title"`) instead of the full create window. `N` opens the same box in the focused column, else the column under the pointer, else the column of the active task (with the HTPR-8716 flag on); `Alt+C` opens it at the top, `Alt+Shift+C` at the bottom. In Table view, the **New task** button and `N` open the inline box above the table (`TableCreateTaskControl.tsx`). Always on since HTPR-6175; flag removed in HTPR-7358. On a phone with the AI task writer on, the **+** opens the full writer instead.

## How to drive it

1. Open a board you own in Kanban view at 1440x900, hover a column and click its top **+**. Expect the inline `Title` box in that column, not `#title-input-modal`.
2. Type a title, press Enter. Expect `POST /api/tasks/create` 200, the card in the column, and the box still open and empty for the next card. Escape closes it.
3. Click on the board background, press `N`. Expect the inline box at the bottom of the active column. Hover the bottom **Create task** row: the tooltip shows `N`. With focus outside the board, hover another column and press `N`: the box opens in that column. Focus a column or card, hover another column, press `N`: the focused column wins with the HTPR-8716 flag on; with it off, the hovered column wins. `Shift+C` must do nothing.
4. Switch to Table view, click **New task** (or press `N`). Expect the inline box above the table; Enter creates the task in the selected row's column.
5. Reload: the new cards stay.

## What usually breaks

- The **+**, `N` or table **New task** opens the full create window instead of the inline box, or `N` does nothing.
- The tooltip shows `C`, `N / Shift+C` or anything other than `N`.
- `Shift+C` still opens the box, or `N` opens the first column while another column is hovered.
- Enter closes the box after the first card instead of keeping it open for the next.

## What proof to collect

Checklist written before QA; screenshots of the inline box from the column **+**, from `N` and in Table view, and of the cards after reload (desktop 1440x900, phone 390x844); the create request status; a short video. Record account ids, never credentials.

### Automated evidence

`node --test tests/htpr-6902-n-quick-add.test.cjs` exercises N opening inline entry on boards and tables, the hovered and focused column choice, Shift+C staying cut with the flag on, mobile inline behavior, and the bottom-row shortcut hint; task persistence still needs live proof.

## Cleanup

Delete the QA cards created for the run (titles start with the `QA_TASK_PREFIX` from `e2e/smoke/lib/boardSetup.ts`).
