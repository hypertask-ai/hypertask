# Command palette (Ctrl+K)

## How a customer reaches it

`Ctrl+K` (or `Cmd+K`) anywhere in the app opens the command palette. On phones
the same palette lists the commands but hides the key chips
(`CommandList.tsx` renders `keyboardCommands` only when `isMobile` is false).

## How to drive it

- Open any task at `/detail/project-<board>/<number>`, press `Ctrl+K`, type
  `copy private`, and read the key chips on the right of each row.
- The shortcut help list lives in Settings → Shortcuts and in the `?` help
  sheet; it reads `getKeyboardShortcuts()` in
  `src/lib/constants/shortcuts.ts`.
- The Share Task modal shows the same keys in each row's hover tooltip while
  `htpr-7839-share-shortcut-tooltips` is on.
- The palette's four share rows read `src/lib/shortcuts/shareTaskShortcuts.ts`
  while `htpr-7891-palette-share-key-labels` is on, so the printed key and the
  key that copies cannot disagree.

## Search / New Task switch outline

Open Ctrl+J on desktop, or Commands then New Task on a phone. With
`htpr-8015-amoled-mode-outline` enabled, the existing switch above the
composer has a 1px `--border-light-gray-thin` outline in AMOLED only.
The composer outline and the switch's size and position stay unchanged.
Switch to Search and back to New Task; repeat at 1440x900 and 390x844 in
AMOLED, Graphite, Porcelain and Dia. Compare computed outlines and bounding
boxes against the pre-release captures. Flag Off keeps the old appearance.
No tasks need creating for this styling check.

## What usually breaks

- A palette label drifting from the key that actually works: the palette
  printed `CTRL :` and `CTRL SHIFT :` while the help list, the docs page and
  the Share Task tooltips printed `;` for the same physical key
  ([HTPR-7891](https://app.hypertask.ai/detail/project-15/7891)). The merged
  HTPR-7839 pull request said it had fixed this, but its diff never touched
  `taskCommands.ts`, so check the palette itself after any shortcut work.
- On Apple devices `CTRL` must render as `CMD`; `SingleKey` in
  `CommandList.tsx` does that mapping, so a label that hard-codes `CMD` would
  print `CMD` on Windows too.

## What proof to collect

Screenshots of the palette rows with the key chips, the matching help-list
rows, and one Share Task tooltip, then compare the glyphs by eye. Shoot the
desktop viewport at 1440x900; all four themes when row styling changed.
`tests/htpr-7891-palette-share-key-labels.test.cjs` pins the palette labels to
the shared module and the help list.

## Cleanup

None; reading the palette and the help list writes nothing.

## Gap

Phone shots cannot prove the key chips, because the phone palette hides them;
they only prove the rows still render.

## Desktop New Task entry

While `htpr-8035-sidebar-new-task` and the compose task writer are on, the
left sidebar has a primary plus button. Hover shows New Task and Ctrl+J
(Cmd+J on Apple); expanding the sidebar also shows the text label. Clicking
opens the same New Task compose tab as the shortcut, without changing routes.
Check a board, task, Inbox, My Tasks, Calendar and Search; cancel with Escape,
then reopen with Ctrl+J. Check both sidebar widths and all four themes.
The button must not appear at 390x844, or when its flag is off. Existing
navigation must still work, and the main content must not move horizontally.

## Archive one column

With `htpr-7907-column-archive` on, open a board and choose **Archive all
tickets in a column** from Ctrl+K. The existing column picker names the
column; the confirmation counts every active ticket, including tickets
hidden by view filters. Cancel must change nothing. Confirm once, verify
that only that column empties, reload, and check the board archive. One
Undo (or Ctrl+Z) must restore every successful archive. Permission refusals
name the tickets left unchanged and must not stop the other tickets.

Use only your own `[qa-runner]` fixtures on the private QA runner board.
Keep at least one fixture in another column and compare its status before
and after. Repeat the picker, confirmation and Undo at 1440x900 and
390x844, in all four themes. Check an empty column and single-ticket
archive too. With the flag off, the command must be absent. Archive only
your created fixtures after the check.

## New Task board order

With `htpr-8014-compose-board-order` on, Ctrl+J then Ctrl+Shift+B opens the
existing board picker with recently visited boards first. It reuses the
persisted navigation history from the sidebar and board shortcuts. Equal
history values, including boards never visited, sort alphabetically.

Navigate between two QA boards through the sidebar, then return to My Tasks.
Open the picker and compare the visible order with the saved navigation
history. Filter by a board name, press Enter, and verify the composer chip
names that same board. Repeat by clicking a row. Escape must leave the
composer destination unchanged; reload must preserve the history. Check an
empty search and clear it. No task needs creating. Repeat at 1440x900 and
390x844 in all four themes. Compare picker bounds against the before capture.
Flag Off preserves API order; the move-existing-task picker stays unchanged
in either mode. Do not modify shared QA history outside your browser context.

## New Task dictation shortcut

With `htpr-8140-ctrlj-dictation-shortcut` on, open Ctrl+J and type a draft.
Ctrl+Shift+D (Cmd+Shift+D on Apple) starts the existing New Task microphone.
Mouse activation must still work. Repeated keydown, IME composition, extra
Alt, and the Search tab must not start dictation. Escape cancels recording;
Enter uses the existing transcription action. Confirm the original draft
remains, reopening the writer still works, and no background comment or chat
recorder starts. Flag Off restores mouse-only activation in this writer.
Use a permitted test microphone; physical sound quality needs real hardware.
