# Quick entry cards

## Sub-features

- `quick-entry-cards` Quick entry cards.
- `drafts` `/drafts` lists your unsent comment drafts. Signed out, the page redirects to `/login`.
- `action-chips` With `htpr-7979-action-chips` on, after Ctrl+J creates a ticket the chat can show up to three next-action buttons. Nothing that fits means no buttons. Off restores the writing chips.
- `picker-auto` With `htpr-8995-picker-auto` on, the New Task model menu lists Auto first and uses that choice. Off hides Auto.
- `ctrl-j-new-task` With `htpr-9002-ctrl-j-new-task` on, Ctrl+J on the desktop new-task screen opens Write with AI inside the description. It does not save the ticket. Off keeps the old Ctrl+J.

## How to get to it (user POV)

On a board in Kanban view, the column **+** at the top (`.create-new-task-button`) or the **Create task** row at the bottom of a column opens a small inline box (`src/components/Common/newTask.tsx`, `aria-label="Title"`) instead of the full create window. `N` opens the same box in the focused column, else the column under the pointer, else the column of the active task (with the HTPR-8716 flag on); `Alt+C` opens it at the top, `Alt+Shift+C` at the bottom. In Table view, the **New task** button and `N` open the inline box above the table (`src/components/PageComponents/Kanban/TableView/TableCreateTaskControl.tsx`). Always on since HTPR-6175; flag removed in HTPR-7358. The top **+** opens the same inline box at every viewport, including a phone with the AI task writer on; the writer is a separate control.

## Driving it with agent-browser

1. Open a board you own in Kanban view at 1440x900, hover a column and click its top **+**. Expect the inline `Title` box in that column, not `#title-input-modal`. On 2026-11-20 the QA Sandbox board showed four `.create-new-task-button` controls and one `[aria-label="Title"]` box after the click, with no create modal.
2. Type a title, press Enter. Expect `POST /api/tasks/create` 200 (1.5-2.5s), the card in the column, and the box still open and empty for the next card. Escape closes it.
3. Click on the board background, press `N`. Expect the inline box at the bottom of the active column. Hover the bottom **Create task** row: the tooltip shows `N` only while `htpr-8265-task-shortcuts-writer-model` is on; with it off the tooltip reads `N / Shift+C`, and the top **+** tooltip reads `C`. With focus outside the board, hover another column and press `N`: the box opens in that column. Focus a column or card, hover another column, press `N`: the focused column wins with the HTPR-8716 flag on; with it off, the hovered column wins. `Shift+C` must do nothing.
4. Switch to Table view, click **New task** (or press `N`). Expect the inline box above the table; Enter creates the task in the selected row's column. The control's accessible name is `Create task (N)` or `Create task in the selected column (N)`, so match `Create task`, never `New task`. The board's saved views decide whether a Table view exists; QA Sandbox has none, so this step is verified-unreachable there.
5. Reload: the new cards stay. Delete the cards you made.

### Unsent comment drafts

Open `/drafts` while signed in. Rows are unsent comment drafts, under
an All tab and one tab per board. An empty list says "No drafts".
Press E on a row. That posts `POST /api/drafts/archiveDraft` and the
row leaves the list. A failed archive shows "Draft wasn’t archived.
Try again." and the row comes back. G then D is Go to drafts. A
signed-out visit redirects to `/login`. Saved comment drafts are not
listed.

### Action chips after Ctrl+J

Turn `htpr-7979-action-chips` on. Create a ticket with Ctrl+J. The
chat sidebar opens on that ticket. Under the first message, the label
is "Questions and ideas for this ticket", then zero to three buttons.
Each button is one next action or one open decision from the original
note and the board rules. Click a button. That text is sent as the
next chat message. When nothing fits, the label and the buttons are
absent. Flag off, the chips are the writing prompts again. The request
is `POST /api/ai/task-questions` with the original note.

### Auto in the New Task model menu

Turn on `htpr-8265-task-shortcuts-writer-model` and
`htpr-8995-picker-auto`. Open Ctrl+J. The compose footer has the model
menu. Auto is the first item. Its title is Auto and its description is
"Picks the right model for each job". Pick Auto, then create a ticket.
The task writer uses the automatic model for that job. A stored named
model stays selected until you pick Auto. Flag off, Auto is not in
that menu, and saving a task-writer preference of auto is rejected.

### Ctrl+J inside the new task screen

On desktop, open `/new?id=<board id>` with `htpr-9002-ctrl-j-new-task`
on. The description placeholder says "Add a description, or press
Ctrl+J to write it with AI" (Cmd+J on a Mac). Press Ctrl+J or Cmd+J.
The Write with AI box opens in the description. The ticket is not
saved, and AI chat does not open. With an empty description the prompt
says "Describe the task…" and the send button says Write. With
`htpr-7472-task-templates` on, the chips are that board's template
names, up to eight. Otherwise the chips are Bug report, Feature, and
Acceptance criteria. Write fills the title and description in the
form and does not create the task. Press the shortcut again to close
the box. The shortcut does nothing while the Ctrl+J palette is already
open. On a phone, the inline box does not open. With the flag off, the
inline box stays closed. The older shortcut, when that behavior is
enabled, still saves the draft and opens the new ticket in AI chat.
If that save fails, the toast says "Could not open AI chat. Your task
draft is still here."

## Gotchas

- The **+**, `N` or table **New task** opens the full create window instead of the inline box, or `N` does nothing.
- The tooltip shows `C`, `N / Shift+C` or anything other than `N` while `htpr-8265-task-shortcuts-writer-model` is on. With that flag off, `N / Shift+C` is the expected bottom-row tooltip.
- `Shift+C` still opens the box, or `N` opens the first column while another column is hovered.
- Enter closes the box after the first card instead of keeping it open for the next.
- The drafts error copy uses a curly apostrophe: "Draft wasn’t archived. Try again."; a straight-quote selector misses it.

### What proof to collect

Checklist written before QA; screenshots of the inline box from the column **+**, from `N` and in Table view, and of the cards after reload (desktop 1440x900, phone 390x844); the create request status; a short video. Record account ids, never credentials.

### Automated evidence

`node --test tests/htpr-6902-n-quick-add.test.cjs` exercises N opening inline entry on boards and tables, the hovered and focused column choice, Shift+C staying cut with the flag on, mobile inline behavior, and the bottom-row shortcut hint; task persistence still needs live proof.

### Cleanup

Delete the QA cards created for the run (titles start with the `QA_TASK_PREFIX` from `e2e/smoke/lib/boardSetup.ts`).
