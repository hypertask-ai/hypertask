# My Tasks

## Sub-features

- `settings-button-accessible-name` Settings button accessible name.
- `scheduled-tasks` `/scheduled` is Tasks with Due Dates. Rows group as Overdue, Today, Tomorrow, This Week and Later. Tabs start with All Due Dates, then My Due Dates when you have any, then one tab per board.
- `my-tasks-priority-filter` With `htpr-6312-my-tasks-priority-filter` on or off, My Tasks does not show the old priority filter button, and that control does not narrow the list.
- `drop-board-tabs` With `htpr-6940-drop-board-tabs` on, My Tasks keeps its saved view tabs and hides the board tab row. Scope chooses All boards or one board. Group: Board shows a section per board. Off puts the board tab row back on desktop and on the phone footer.

## How to get to it (user POV)

`https://app.hypertask.ai/my-tasks`, or press `g` then `m` anywhere in the
app. On a phone it is the My Tasks tab.

Scheduled tasks: Commands, Go to scheduled tasks, or press `g` then `u`.
The address is `https://app.hypertask.ai/scheduled`. A signed-out visit is sent to sign in.

## Driving it with agent-browser

`phone-shot.sh` or `agent-browser`, headless, against production. Load the
page, wait for the table, then look at what sits between the filter row and
the first table row. Scopes are hardcoded on; the flags My Tasks actually read
are `htpr-8144-phone-my-tasks`, `htpr-6940-drop-board-tabs`,
`htpr-6312-my-tasks-priority-filter` and `htpr-8171-hide-tags`. Views, bulk
selection and snooze are not flag-gated, so running both storage states proves
nothing extra for them. Pick a board tab only while `htpr-6940-drop-board-tabs`
is off: it ships `EVERYONE`, so the tab row is gone for every account and the
Tab/Shift+Tab cycling step is verified-unreachable until that flag is off.
On desktop, C opens task creation and Back cancels it. The list uses the
available page width beside the app rail.

Scheduled: open `/scheduled`, wait for Tasks with Due Dates, and confirm the
due-date groups. The `This Week` and `Later` headings appear only when a task
falls in them, so an absent heading with no such tasks is not a failure. Open a
row and confirm that task opens. The board tab strip here follows the same
`htpr-6940-drop-board-tabs` rule as My Tasks: with the flag on there is nothing
to see, flag off the footer tabs return.

Board tabs: on My Tasks with `htpr-6940-drop-board-tabs` on, the board tab
row is absent. Assert on `[data-testid="my-tasks-splits-desktop"]` and
`[data-testid="my-tasks-splits-phone"]` (both zero) and
`[data-testid="my-tasks-list"]` (one). Scope and Group: Board still reach
every board. With the flag off, the desktop row and the phone footer tabs
return. With `htpr-6312-my-tasks-priority-filter` on, the old priority filter
button is absent and the rows stay unfiltered by that control; the table's
`PRIORITY` column header is a sort, not the removed filter button.

### Hands-free drive on production

```bash
node .claude/skills/verify-hypertask/scripts/feature-map-drive.mjs {slug} --dir /tmp/feature-map-drive
```

Prints `PASS` or `FAIL` per step, writes `result.json` and screenshots into `--dir`, and ends with
`{slug} ok`. It refuses any base except `https://app.hypertask.ai`, uses the `qa-login` identities,
creates only fixtures its own cleanup removes, and never prints a cookie, token or email address.

## Gotchas

- Controls nobody asked for showing up on top of the table, like the
  "Quick add a task" bar removed in
  [HTPR-6570](https://app.hypertask.ai/detail/project-15/6570). The page text
  contains no "quick add" string.
- Ctrl+E not archiving the focused row
  ([HTPR-6445](https://app.hypertask.ai/detail/project-15/6445)).
- The board tab row still showing while `htpr-6940-drop-board-tabs` is on, or Scope and Group: Board failing to reach a board.
- A priority filter button appearing for `htpr-6312-my-tasks-priority-filter`. That button stays hidden.

Phone bulk selection keeps its hidden checkbox grid slot, so ticket IDs and
titles stay in separate columns. Scroll to the final task and confirm it
clears the floating Back button. Controls sit together below the heading;
desktop placement stays unchanged. Check all four themes at 390x844.

### What proof to collect

Screenshot `/my-tasks` signed in, desktop and phone width, with both
accounts when a flag is involved. For a removal, also search the page text
for the removed label (for example "Quick add") and record that it is
absent. For scheduled tasks, shoot `/scheduled` with the due-date groups.
For `htpr-6940-drop-board-tabs`, shoot My Tasks with the board tab row gone
and again with it restored. For `htpr-6312-my-tasks-priority-filter`, record
that the old priority button is absent and the rows are unchanged.

### Automated evidence

The old removal test for HTPR-6570 is gone from `tests/`, so nothing checks that
source absence any more. Closest coverage is
`npm run test:file -- tests/my-tasks-priority-filter-component.test.cjs tests/global-shortcut-routes.test.cjs`,
which exercises board URL restoration, Tab bursts, full-width rendering and
global C shortcut eligibility. Layout and keyboard behavior still need live
proof.

### Cleanup

Nothing to clean up for a look-only check. Hard-delete any task you created.

### Settings button accessible name

With `htpr-8146-settings-name` on, the desktop rail gear is named Settings
without hovering. From My Tasks, Inbox and a board, locate
`[data-testid="app-shell-settings"]`, inspect its accessible name, click it,
and confirm Settings opens. Reload and repeat with the rail expanded.
The button's size, position and tooltip must stay unchanged. Flag Off
restores the original unnamed button. On phones, check the existing
Settings top-bar button remains named and opens Settings.
