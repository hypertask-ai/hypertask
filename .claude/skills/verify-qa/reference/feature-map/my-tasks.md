# My Tasks

## How a customer reaches it

`https://app.hypertask.ai/my-tasks`, or press `g` then `m` anywhere in the
app. On a phone it is the My Tasks tab.

## How to drive it

`phone-shot.sh` or `agent-browser`, headless, against production. Load the
page, wait for the table, then look at what sits between the filter row and
the first table row. Many parts are behind Owner + QA flags (views, scopes,
bulk selection, snooze), so check with the QA flag identity
(`storageState-qa.json`) and with the plain account
(`storageState-qa-normal.json`). Pick a board tab, reload, and confirm the
`board` URL parameter and selected list remain. On desktop, Tab and Shift+Tab
cycle board tabs; C opens task creation and Escape cancels it. The list uses
the available page width beside the app rail.

## What usually breaks

- Controls nobody asked for showing up on top of the table, like the
  "Quick add a task" bar removed in
  [HTPR-6570](https://app.hypertask.ai/detail/project-15/6570).
- Ctrl+E not archiving the focused row
  ([HTPR-6445](https://app.hypertask.ai/detail/project-15/6445)).

## What proof to collect

Screenshot `/my-tasks` signed in, desktop and phone width, with both
accounts when a flag is involved. For a removal, also search the page text
for the removed label (for example "Quick add") and record that it is
absent.

### Automated evidence

`node --test tests/htpr-6570-my-tasks-no-quick-add.test.cjs` checks that My Tasks source no longer references the removed Quick add component or flag; layout and keyboard behavior still need live proof.
`npm run test:file -- tests/my-tasks-priority-filter-component.test.cjs tests/global-shortcut-routes.test.cjs`
exercises board URL restoration, Tab bursts, full-width rendering and global
C shortcut eligibility without the retired shortcuts/width flag.

## Cleanup

Nothing to clean up for a look-only check. Hard-delete any task you created.
