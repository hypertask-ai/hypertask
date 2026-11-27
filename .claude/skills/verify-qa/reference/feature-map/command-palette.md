# Command palette (Ctrl+K)

## Sub-features

- `search-new-task-switch-outline` Search / New Task switch outline.
- `new-task-send-shortcut` New Task send shortcut.
- `desktop-new-task-entry` Desktop New Task entry.
- `archive-one-column` Archive one column.
- `new-task-board-order` New Task board order.
- `new-task-model-picker` New Task model picker.
- `new-task-dictation-shortcut` New Task dictation shortcut.
- `new-task-board-shortcut-tooltip` New Task board shortcut tooltip.
- `ctrlj-board-from-text` With `htpr-7305-board-from-text` on, New Task moves the board chip when the note names exactly one board after for, on, in, into, or to. A board you already picked stays put.
- `ctrlj-footer-one-line` The desktop New Task footer permanently hides the Esc Close hint so the other hints stay on one line. Escape still closes the window. The phone layout is unchanged.
- `ctrlj-footer-clickable` With `htpr-7307-ctrlj-footer-clickable` on, the footer hints are buttons. Send creates the ticket, Attach files opens the file picker, Search switches to the Search tab, Board opens the board picker, and Escape closes the window.
- `ctrlj-skills` With `htpr-7312-ctrlj-skills` on, a known `/slug` in the note is sent as a writing template and removed from the text the task writer saves. An unknown token stays in the note.
- `ctrlj-always-board-chip` With `htpr-7313-ctrlj-always-board-chip` on, the board chip is visible as soon as New Task opens, including on a board or ticket whose destination already matches that page.
- `ctrlj-ticket-questions` With `htpr-7317-ctrlj-ticket-questions` on, a created ticket's AI sidebar shows clickable lines under "Questions and ideas for this ticket". The default prompt asks for 2 to 4.
- `ctrlj-sidebar-on-empty-task` With `htpr-7544-ctrlj-sidebar-on-new-task` on, Ctrl+J on an empty task opens the AI sidebar for that task. It does not open New Task.
- `search-lazy-closed` With `htpr-7547-search-lazy-closed` on, the Search page loads the closed command palette only when you open it. Search results stay the same.
- `ctrlj-skill-menu` With `htpr-7656-ctrlj-skill-menu` on and `htpr-7312-ctrlj-skills` on, typing `/` in New Task opens the skill picker. Arrow keys move, Enter or Tab inserts the skill, and Escape closes the picker.
- `ctrlj-composer-keys` With `htpr-8260-ctrlj-composer-keys` on, New Task puts the microphone beside a Create button, spells each footer key as words, and shows a Dictation pill while it listens. The plus-composer layout replaces this row on desktop.
- `ctrlj-plus-composer` With `htpr-8829-ctrlj-plus-composer` on, desktop New Task puts a + menu, a filled microphone, and a text Send inside the box. The board chip and model picker sit under the box. The flag starts on for Owner and QA.
- `ctrlk-integrated-tabs` With `htpr-8931-ctrlk-integrated-tabs` on, desktop Search and New Task tabs sit inside the window. The New Task box uses 4px corners.
- `ctrlk-tabs-on-top` With `htpr-8943-ctrlk-tabs-on-top` on and `htpr-8931-ctrlk-integrated-tabs` on, those tabs stay above the search box, so they do not jump when you switch to New Task.
- `ctrlk-no-footer` With `htpr-8947-ctrlk-no-footer` on, Search hides the shortcut hint row and the version line. The build id stays on the window as a hidden attribute.
- `ctrlk-filled-search` With `htpr-8954-ctrlk-filled-search` on, and both tab flags on, the search box uses the same fill as the New Task box and drops the lines above and below it.

## How to get to it (user POV)

`Ctrl+J` (or `Cmd+J`) opens this window on New Task. `Ctrl+K` (or `Cmd+K`) opens it on Search. On phones
the same palette lists the commands but hides the key chips
(`CommandList.tsx` renders `keyboardCommands` only when `isMobile` is false).

## Driving it with agent-browser

**Production, QA 985 (verified 2026-11-20).** Start one persistent session and
read the real DOM; the phone palette hides the key chips by design.

```bash
H=.claude/skills/verify-hypertask/bin/ht-verify
export HT_VERIFY_RUN=/tmp/b15/9515-evidence/htverify
$H session start --base https://app.hypertask.ai --viewport 1440x900
$H open /my-tasks --full
```

Press the shortcut with `$H press`, which sends a real key or chord to the
session and reports the landed URL and the focused element:

```bash
$H press "Control+k"
```

Then `$H press "Control+j"` for Ctrl+J, and drive with `$H fill '#htc-search'
'copy private'` and `$H shot --session --out <png>`.

Require on Search: tabs `Search` (selected) and `New Task` inside the window,
rows `Copy private task link (title + URL)` with chips `CTRL` `;` and
`Copy private task URL` with `CTRL` `SHIFT` `;`, plus `Search tasks: "copy
private"`. Never `CTRL :`.

Require on New Task with QA 985 (`htpr-8829-ctrlj-plus-composer` on): visible
`Send` (button and text), `Choose a board`, `Auto` model picker, `Attach file`
and `Add context` inside the box, and no footer row and no `Create task` button.
`Escape` closes the window.

**Hands-free drive, loopback only.**
`node .claude/skills/verify-qa/scripts/ctrl-j-drive.mjs <folder> --base http://127.0.0.1:3100 --state <storageState.json>`
presses Ctrl+J on a seeded board, requires the New Task popup and its focused
composer, checks the composer button names, and sends the note with the shortcut
the footer names (`Ctrl Enter create` when the word-keys footer is on, plain
`Enter` when `htpr-8253-ctrlj-ctrl-enter-send` is off). It requires the ticket
to be created and opened at its detail page, records the create response,
deletes the task it created, then reopens and closes the popup with Escape. It
prints `PASS` or `FAIL` per step and ends with `ctrl-j drive ok`. It refuses any
base that is not loopback, so it never drives production: run it on the seeded
browser-smoke stack (`scripts/verify-qa <branch> hands-free-drives` runs it
hosted). `--break shortcut` swallows Ctrl+J on purpose; the run must then end
with `negative control ok`.

**Known harness gap (2026-11-20).** That script is stale for the QA 985
default: it demands `[aria-label="Create task"]` and a footer matching
`/(ctrl|cmd) enter create/`, but the plus composer renders a `Send` control and
no footer, while `htpr-8253` (EVERYONE) turns plain Enter into a paragraph
break. On the QA 985 default the drive creates zero tickets and fails. Fix the
script to accept `Send` and to press Control+Enter before trusting its `ok`.
Reading this file's production steps is the reliable check until then.

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

### Search / New Task switch outline

Open Ctrl+J on desktop, or Commands then New Task on a phone. With
`htpr-8015-amoled-mode-outline` enabled, the existing switch above the
composer has a 1px `--border-light-gray-thin` outline in AMOLED only.
The composer outline and the switch's size and position stay unchanged.
Switch to Search and back to New Task; repeat at 1440x900 and 390x844 in
AMOLED, Graphite, Porcelain and Dia. Compare computed outlines and bounding
boxes against the pre-release captures. Flag Off keeps the old appearance.
No tasks need creating for this styling check.

### New Task send shortcut

With `htpr-8253-ctrlj-ctrl-enter-send` on (default Everyone), Ctrl+Enter opens
in the New Task composer, type a two-paragraph note, and press Enter: a line
break must appear and no ticket may be created. Without the plus composer the
footer below the box reads a spaced `Ctrl Enter` `Send` (not `CTRL+ENTER`), and
the plus composer (`htpr-8829`) hides the footer entirely. Press Ctrl+Enter
(Cmd+Enter on a Mac): exactly one ticket is created with the whole note, the
composer closes and the new ticket opens. Repeat at 1440x900 and 390x844 in
Porcelain, Graphite, AMOLED and Dia, and capture the footer hint in each. With
the flag Off, Enter creates the task again and the hint reads `Enter Send`. The
phone New Task sheet hides the footer and keeps its Send button, so record that
path as the closest check for the phone footer.

### Board named in the note

Turn `htpr-7305-board-from-text` on. Open New Task and type a note that says "for" and then one board title you belong to. The chip must name that board before you send. Two boards that share the name, or a title with no for, on, in, into, or to, leave the chip alone. Open the board picker, pick a different board, and type the first title again. The chip must keep your pick. Turn the flag off and type the same "for" note. The chip must stay on the page's board.

### Footer on one line

Open New Task on desktop. The footer must not show Close. Press Escape. The window must close. Open New Task on a phone. The sheet must still hide the footer.

### Clickable footer

Turn `htpr-7307-ctrlj-footer-clickable` on. Open New Task and click Send with an empty note. Nothing is created. Type two words and click Send. One ticket opens. Reopen New Task and click Attach files, Search, and Board, then press Escape. You get the file picker, the Search tab, the board picker, and a closed window. Turn the flag off. The same hints are text, and a click does nothing.

### Skills in the note

Turn `htpr-7312-ctrlj-skills` on. Open New Task and type a note that contains a skill you own, written as `/` plus its slug. Send it. The saved ticket must not contain that token, and the writer must follow that skill. Type `/not-a-real-skill` and send. That token must remain. Turn the flag off and send the same known skill. The token must remain in the saved text.

### Board chip on every page

Turn `htpr-7313-ctrlj-always-board-chip` on. Open New Task on a board, on a ticket from that board, in Inbox, and on My Tasks. The board chip must be visible in each place before you type. Turn the flag off. On that board, and on a ticket from that board, the chip must stay hidden until the destination differs from the page.

### Questions after create

Turn `htpr-7317-ctrlj-ticket-questions` on. Create a ticket from New Task and wait on the AI sidebar. Under the intro you must see the heading "Questions and ideas for this ticket" and one button per returned line. Click one button. That text must send as your next chat message. Turn the flag off and create another ticket. Those buttons must not appear.

### Empty task uses the sidebar

Turn `htpr-7544-ctrlj-sidebar-on-new-task` on. Open a task whose title is "New Task" or empty and whose description has no text. Press Ctrl+J. The AI sidebar must open for that task, and New Task must stay closed. Repeat on a task that already has a description. Ctrl+J must open New Task. Turn the flag off on the empty task. Ctrl+J must open New Task again.

### Search loads the palette late

Turn `htpr-7547-search-lazy-closed` on. Open the Search page and do not open the palette. Search results must still list matches. Press Ctrl+K. The palette must open, and a failed palette load must close it again. Turn the flag off, reload Search, and confirm results still match the same query.

### Skill picker

Turn `htpr-7656-ctrlj-skill-menu` and `htpr-7312-ctrlj-skills` on. Open New Task and type `/`. A picker of your skills must open. Arrow keys must move the highlight. Enter must insert `/` plus the slug and a space. Escape must close the picker and leave the window open. Turn either flag off, type `/`, and confirm the picker stays closed.

### Create button and word keys

Turn `htpr-8260-ctrlj-composer-keys` on and leave the plus-composer flag off. Open New Task. The microphone must sit beside a Create button. The footer must spell keys as words, such as Ctrl Enter and Ctrl Shift B on Windows, or Cmd Enter and Cmd Shift B on Apple. Start dictation. A pill must show the word Dictation, and that control stops listening. A separate control cancels it. Turn the flag off. The send control must be the old icon button, and the footer must return to the short key chips.

### Plus menu inside the box

Turn `htpr-8829-ctrlj-plus-composer` on. This flag starts on for Owner and QA. Open New Task on desktop. Inside the box you must see a + control, a filled microphone, and a Send label. The + menu must offer Attach file and Add context. The board chip and the model picker must sit under the box, and the old footer must be gone. Open New Task on a phone. This layout must not appear. Turn the flag off on desktop. The previous row and footer must return.

### Tabs inside the window

Turn `htpr-8931-ctrlk-integrated-tabs` on. Open Ctrl+K on desktop, outside a demo and outside the interactive tour. Search and New Task must sit inside the window, not above it. Switch to New Task. The text box corners must be 4px. Open the same window on a phone. The tabs must stay above the window. Turn the flag off on desktop. The tabs must return above the window.

### Tabs stay on top

Turn `htpr-8943-ctrlk-tabs-on-top` and `htpr-8931-ctrlk-integrated-tabs` on. Open Ctrl+K. The tabs must sit above the search box. Switch to New Task and back to Search. The tabs must not move under the search box. Turn only the tabs-on-top flag off, with integrated tabs still on. On Search, the tabs must sit under the search box.

### No shortcut footer

Turn `htpr-8947-ctrlk-no-footer` on. Open Ctrl+K on Search. The shortcut hint row and the version line must be gone. The window element must still carry the build id as a hidden attribute. Switch to New Task and back. Search, results, and the shortcuts themselves must still work. Turn the flag off. Both footer lines must return.

### Filled search box

Turn `htpr-8954-ctrlk-filled-search`, `htpr-8931-ctrlk-integrated-tabs`, and `htpr-8943-ctrlk-tabs-on-top` on. Open Ctrl+K. The search box must use the New Task fill and must not show a line above or below it. Type a command. Results must still filter. Turn only the filled-search flag off. The lines around the search box must return. Turn filled search on without the two tab flags. The search box must keep the old lines.

### Hands-free drive on production

```bash
node .claude/skills/verify-qa/scripts/feature-map-drive.mjs command-palette --dir /tmp/feature-map-drive
```

Prints `PASS` or `FAIL` per step, writes `result.json` and screenshots into `--dir`, and ends with
`command-palette ok`. It opens Search with Ctrl+K and the writer with Ctrl+J, never submits, and
never prints a cookie, token or email address.

## Gotchas

- A palette label drifting from the key that actually works: the palette
  printed `CTRL :` and `CTRL SHIFT :` while the help list, the docs page and
  the Share Task tooltips printed `;` for the same physical key
  ([HTPR-7891](https://app.hypertask.ai/detail/project-15/7891)). The merged
  HTPR-7839 pull request said it had fixed this, but its diff never touched
  `taskCommands.ts`, so check the palette itself after any shortcut work.
- On Apple devices `CTRL` must render as `CMD`; `SingleKey` in
  `CommandList.tsx` does that mapping, so a label that hard-codes `CMD` would
  print `CMD` on Windows too.
- The skill picker opens only when `htpr-7656-ctrlj-skill-menu` and
  `htpr-7312-ctrlj-skills` are both on. The filled search box changes only
  when `htpr-8954-ctrlk-filled-search`, `htpr-8931-ctrlk-integrated-tabs`,
  and `htpr-8943-ctrlk-tabs-on-top` are all on. The plus-composer row
  replaces the Create-button row on desktop while `htpr-8829-ctrlj-plus-composer`
  is on.

### What proof to collect

Screenshots of the palette rows with the key chips, the matching help-list
rows, and one Share Task tooltip, then compare the glyphs by eye. Shoot the
desktop viewport at 1440x900; all four themes when row styling changed.
`tests/htpr-7891-palette-share-key-labels.test.cjs` pins the palette labels to
the shared module and the help list. The copy-private rows print `;` and
`SHIFT ;` today (verified live), never `:`.

### Gap

Phone shots cannot prove the key chips, because the phone palette hides them;
they only prove the rows still render. The loopback `ctrl-j-drive.mjs` is stale
for the QA 985 plus-composer default; see the harness gap above.

### Cleanup

None; reading the palette and the help list writes nothing.
### Desktop New Task entry

While `htpr-8035-sidebar-new-task` and the compose task writer are on, the
left sidebar has a primary plus button. Hover shows New Task and Ctrl+J
(Cmd+J on Apple); expanding the sidebar also shows the text label. Clicking
opens the same New Task compose tab as the shortcut, without changing routes.
Check a board, task, Inbox, My Tasks, Calendar and Search; cancel with Escape,
then reopen with Ctrl+J. Check both sidebar widths and all four themes.
With `htpr-8035-new-task-fill` on, the primary button uses the same inverted
foreground and background as Sign up for free: light fill in dark themes, dark
fill in light themes. Off restores `bg-shadcn-primary` with
`text-primary-foreground`. Its size, position, plus icon and tooltip must
remain unchanged either way.
The button must not appear at 390x844, or when its flag is off. Existing
navigation must still work, and the main content must not move horizontally.

### Archive one column

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

### New Task board order

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

### New Task model picker

With `htpr-8265-task-shortcuts-writer-model` on, Ctrl+J New Task shows the
shared model picker left of the attach button. It starts on the board or
plan default, the same as the AI chat picker, and its model list, effort
submenu and Reset to default behave the same. Pick a non-default model,
send a note, and confirm the task writer request carries that model id; the
created ticket still opens normally. Reopening the writer keeps the choice,
and the task-detail AI writer shows the same model because both use the
`taskWriter` preference. Flag Off hides the picker and restores the board
default. Repeat at 1440x900 and 390x844 in all four themes.

### New Task dictation shortcut

With `htpr-8140-ctrlj-dictation-shortcut` on, open Ctrl+J and type a draft.
Ctrl+Shift+D (Cmd+Shift+D on Apple) starts the existing New Task microphone.
Mouse activation must still work. Repeated keydown, IME composition, extra
Alt, and the Search tab must not start dictation. Escape cancels recording;
Enter uses the existing transcription action. Confirm the original draft
remains, reopening the writer still works, and no background comment or chat
recorder starts. Flag Off restores mouse-only activation in this writer.
Use a permitted test microphone; physical sound quality needs real hardware.

### New Task board shortcut tooltip

With `htpr-8141-board-shortcut-tooltip` on, hover the destination board chip
inside Ctrl+J New Task. The shared tooltip shows Change board and
Ctrl+Shift+B (Cmd+Shift+B on Apple), matching the footer. Click the chip and
use the shortcut independently; both open the existing board picker.
Escape preserves the destination and draft. Repeat desktop and phone in
all four themes; phone keeps the existing hidden-tooltip behavior.
Compare the composer and chip dimensions against the before capture.
Flag Off restores the existing board-name title without the shortcut tooltip.
No tasks need creating.
