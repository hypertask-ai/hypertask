# Keyboard shortcuts registry (canonical)

**This file is the central inventory of every keyboard binding in the app.** Before proposing or touching ANY shortcut, read this file end to end. Governance lives in `CLAUDE.md` ("Keyboard shortcuts are owner-cleared"): no addition, change, or reassignment without Valentin's explicit OK, long-standing bindings are frozen, and every PR that touches a binding updates this file in the same PR.

Notation: `Mod` = Ctrl on Windows/Linux, Cmd on Mac (`cmdControl` in `src/lib/constants/shortcuts.ts`). `Alt` = Option on Mac. Chords like `G then I` mean sequential presses.

Sources of truth in code (all four must stay in sync per the four-registrations rule):
- `src/lib/constants/shortcuts.ts` (feeds the `?` cheatsheet + Settings → Shortcuts)
- `src/components/Modals/commands/HTC/AllCommands.ts` (Ctrl+K palette `keyboard:` hints)
- Direct keydown handlers (listed per binding below; NOT all bindings appear in the palette)
- docs.hypertask.ai `features/keyboard-shortcuts.mdx`

## Global navigation

| Key | Action |
|---|---|
| `1` `2` `3` `4` | App shell: Inbox / Board / Table / Calendar |
| `5` / `]` | Toggle AI chat (`]` is an additional rail-shell synonym) |
| `6` | Search |
| `7` | Running timers |
| `[` | Collapse / expand the app-shell sidebar (rail shell only, `useAppShellSurfaceShortcuts.ts` → `RAIL_TOGGLE_KEY`; cleared by Valentin 2026-08-02) |
| `/` | Search |
| `?` | Shortcut cheatsheet |
| `\` | Settings |
| `;` | Use snippet |
| `Mod+K` | Command palette, including Agents and Settings |
| `Mod+Z` | Undo the latest pending task, inbox, star, or pin action outside text editors (`UndoProvider`) |
| `Mod+B` | Switch Kanban boards |
| `Alt+0..9` (Windows/Linux) / `Ctrl+0..9` (Apple) | Switch favorite boards (`boardSwitch`) |
| `[` / `]` | Previous / next view — **old shell only.** On the rail shell `[` toggles the sidebar (see above); its former redundant focus-left duty is covered by `ArrowLeft`/`H`. |
| `J` / `K` / arrows | Move focus down / up |
| `gg` / `GG` | Focus top / bottom |
| `TAB` / `Shift+TAB` | Cycle focus |
| `ESC` | Exit / go back |

G-chords (`G` then second key): `I` inbox, `B` task board, `C` calendar, `A` all tasks, `M` my tasks, `U` scheduled, `D` drafts, `S` starred, `P` pinned, `H` reminders, `E` archived tasks, `R` archived inbox, `T` running timers, `V` views, `X` toggle archived on board, `;` snippets, `#` trash.

## Board / table / task list

| Key | Action |
|---|---|
| `C` | Create task (`Shift+C` bottom, `Mod+Shift+C` top) |
| `Mod+J` | Create task with the AI Task Writer open and focused (`useSections.ts`; mirrors `Mod+J` "Write with AI" on task detail) |
| `ENTER` | Open task |
| `A` | Assign user |
| `D` | Set due date (`Shift+D` also bound) |
| `P` | Set priority |
| `S` | Set task size |
| `T` | Set tags |
| `W` | Start/stop timer (also TableView direct handler) |
| `H` | Remind me |
| `F` / `Alt+F` | Follow / unfollow task |
| `U` | Mark unread |
| `M` / `Shift+M` | Move to column / to board |
| `E` | Remove notification |
| `#` / `Shift+3` | Delete task |
| `Mod+E` | Archive task |
| `Alt+S` | Star task |
| `Shift+S` | Sort board |
| `Shift+T` | Toggle table layout |
| `Shift+F` | Filters |
| `Shift+J/K/H/L` (+arrows) | Move task down/up/left/right |
| `Mod+Shift++` | Create subtask / task options |

## Task detail

| Key | Action | Handler |
|---|---|---|
| `B` | Log time modal | `TaskTime.tsx` document keydown |
| `Shift+B` | Blocked by person | `TaskDetailComp.tsx` keydown |
| `L` | **Fast-like the focused comment (thumbs up). FROZEN, do not touch.** | `useCommentAndDescriptions.ts` → `LIKESHORTCUTEVENT` |
| `W` | Start/stop timer | `TaskTime.tsx` document keydown |
| `I` | Expand summary | TaskDetailComp |
| `O` / `Shift+O` | Expand single / all comments | TaskDetailComp |
| `R` | React to comment | palette |
| `Shift+R` | Suggest reply with AI — opens the comment composer and inserts an AI-drafted reply (private draft; never auto-posts; refuses to overwrite an existing draft). Bare `R` stays reactions-only. | `TaskDetailComp.tsx` keydown → `AI_SUGGEST_REPLY_EVENT` |
| `ENTER` | Activate description/comment or reply | TaskDetailComp |
| `F2` | Edit title | TaskDetailComp |
| `Mod+M` / `Ctrl+M` | Add comment | TaskDetailComp |
| `Ctrl+D` | Edit description | TaskDetailComp |
| `Mod+J` | Write with AI | TaskDetailComp |
| `Ctrl+O` | View links / subtasks | TaskDetailComp |
| `Mod+S` | Share task | palette |
| `Mod+E` | Archive | palette |
| `Mod+I` / `Mod+Shift+I` | Copy title+ID / ID | palette |
| `Mod+.` `Mod+:` (+Shift) | Copy public/private links | palette |
| `Mod+Shift+H` | Toggle history | palette |
| `Mod+Shift+P` / `Mod+Shift+S` | Pin / star comment | palette |
| `Mod+Shift+3` | Delete comment | palette |
| `Mod+Shift+D` | Speech to text | palette |
| `Mod+Shift+F` | Dictate and improve | cheatsheet |
| `Mod+Shift+,` | Discard draft | cheatsheet |
| `Mod+ENTER` | Save text entry | editors |

## Inbox

| Key | Action |
|---|---|
| `E` | Archive notification (`Shift+E` bulk, `Mod+E` archive task) |
| `X` | Select message |
| `Mod+A` / `Mod+Shift+E` | Select split / select all |
| `Shift+H` | Bulk reminder |
| `J` / `K` | Focus down / up |

## Calendar

`C` add task, `D` update due date, `I`/`U` next/previous period, `M` month, `W` week, `Shift+D` day, `T` today, `TAB`/`Shift+TAB` day focus, `SPACE` select project filter, `Mod+[`/`]` project filters, `Shift+F` filter, `Shift+V` save view (direct handler in `calendar.tsx`).

## Editor (Tiptap)

`/` menu, `2xTAB` autocomplete, `Shift+ENTER` line break, `Mod+I` italic, `Mod+U` underline, `Mod+E` code, `Mod+Y` video embed, `Mod+Z`/`Mod+Shift+Z` undo/redo, `Mod+Shift+B` quote, `Mod+Shift+H` highlight, `Mod+Shift+8` bullets, `Mod+Alt+0..6` text styles, `Mod+Shift+C` code, `Mod+Alt+Shift+C` code block, `Mod+Shift+V` paste plain.

## Modals / pickers

`J`/`K` mirror arrows in every picker (MoveTaskToBoard, RemindMe, palette, BoardPriorityMode, TableColumnsPicker). `ENTER` confirms, `ESC` closes.

`←`/`→` switches a Labels or Assignees filter between matching **any** or **all** of its selected values, while that filter's value picker is open. This mirrors the parent Filters modal, where the same two keys flip the global "Match ANY/ALL Filters". A letter key is not usable here: these pickers keep their search input focused (`ModalInput` re-focuses on blur), and `Shift+M` is already "move task to a different board".

## AI chat

`Mod+Shift+?` toggle, `Mod+Shift+O` reset session, `Ctrl+Q` focus input.

## Handler-only bindings (easy to miss — NOT in the palette)

These fire from raw keydown listeners and will NOT show up when scanning `AllCommands.ts`:

- `L` fast-like (task detail, `useCommentAndDescriptions.ts`)
- `W` / `B` timer + log time (`TaskTime.tsx`)
- `G` chord starter (archived/reminders pages have their own `g` handlers)
- `E` archive on archived-inbox/reminders pages
- `V` calendar save-view (`calendar.tsx`)
- `C` / `W` in TableView (`TableView.tsx`)
- `1-7` app shell surfaces + `]` AI chat synonym + `[` sidebar collapse/expand (`useAppShellSurfaceShortcuts.ts`)
- `;` snippets (TaskDetailComp)

When auditing whether a key is free, grep for the letter in ALL of: `src/app`, `src/components`, `src/hooks`, `src/lib/contexts` — the palette alone is not the truth.
