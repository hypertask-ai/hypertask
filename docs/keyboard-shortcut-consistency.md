# Shortcut consistency: Unit 1 (report-only)

Ticket: https://app.hypertask.ai/detail/project-4060/676

Regenerate: `node scripts/shortcut-drift.cjs --write`. Check snapshot locally: `node scripts/shortcut-drift.cjs --check`.
CI: `tests/shortcut-drift.test.cjs` emits live diagnostics; drift and stale snapshots do not fail CI. Analyzer regressions still fail.

## Method and limits

Dispatches DOM keydown events through the real global-g capture handler and Calendar hook listener, with React registration and external effects stubbed. Loads real help and Ctrl+K command factories; no source-regex binding extraction. This is not full-app/browser QA.
Global-g: every KeyCodes value, plain and Shift. Calendar: every KeyCodes value, plain, Shift and platform command modifier; also g+plain sequences that consume the prefix; selected-task/no-modal context, one project. Help: rail off, including inherited global focus/exit entries; commands: union of Others/Task/Kanban with rail on (availability superset). Apple and Windows are separate.
Findings are review candidates, not assertions of product intent or proof that an action is unavailable in every dynamically-added palette context.
Action/title and action/command-key crosswalks are explicit audit metadata, not handler definitions. Unknown actions remain diagnostics. Missing-command actions are deduplicated per scope; the first observed key is shown. Calendar modified-key acceptance is reported literally, not endorsed as intended UX. Unvisited contexts, other modifier combinations, route/permission filtering, editor and board handlers remain follow-up.
`Global g` duplicates include the Calendar listener on that page, probed in isolation. Capture precedence is also exercised: g+t reaches Timers only, shadowing Calendar's task-board action. The isolated Calendar g+d listener also opens the due-date modal before navigating to Drafts; capture shadows that listener too. These are competing registrations, not proof of double navigation in the composed app.

## Findings

### Windows

Observed bindings: 55. Composed g+t: Timers.

#### binding-missing-help (17)

- Calendar: H → focus:left
- Calendar: SHIFT H → move:left
- Calendar: SHIFT J → move:down
- Calendar: SHIFT K → move:up
- Calendar: L → focus:right
- Calendar: SHIFT L → move:right
- Calendar: SHIFT ← → move:left
- Calendar: SHIFT ⭡ → move:up
- Calendar: SHIFT → → move:right
- Calendar: SHIFT ⭣ → move:down
- Calendar: ENTER → open-task
- Calendar: SHIFT ENTER → open-task
- Calendar: CTRL ENTER → open-task
- Calendar: SHIFT SPACE → project:toggle
- Calendar: CTRL SPACE → project:toggle
- Global g: G then D → due
- Global g: G then T → task-board

#### help-without-binding (1)

- Calendar: SHIFT V → save-view

#### action-missing-command (19)

- Calendar: SHIFT D → day
- Calendar: H → focus:left
- Calendar: SHIFT H → move:left
- Calendar: I → next
- Calendar: J → focus:down
- Calendar: SHIFT J → move:down
- Calendar: K → focus:up
- Calendar: SHIFT K → move:up
- Calendar: L → focus:right
- Calendar: SHIFT L → move:right
- Calendar: M → month
- Calendar: T → today
- Calendar: U → previous
- Calendar: W → week
- Calendar: ENTER → open-task
- Calendar: ESC → back
- Calendar: SPACE → project:toggle
- Calendar: CTRL [ → project:focus
- Global g: G then T → task-board

#### duplicate-keys (2)

- Global g: G then D → Drafts / due
- Global g: G then T → Timers / task-board

### Apple

Observed bindings: 55. Composed g+t: Timers.

#### binding-missing-help (17)

- Calendar: H → focus:left
- Calendar: SHIFT H → move:left
- Calendar: SHIFT J → move:down
- Calendar: SHIFT K → move:up
- Calendar: L → focus:right
- Calendar: SHIFT L → move:right
- Calendar: SHIFT ← → move:left
- Calendar: SHIFT ⭡ → move:up
- Calendar: SHIFT → → move:right
- Calendar: SHIFT ⭣ → move:down
- Calendar: ENTER → open-task
- Calendar: SHIFT ENTER → open-task
- Calendar: CMD ENTER → open-task
- Calendar: SHIFT SPACE → project:toggle
- Calendar: CMD SPACE → project:toggle
- Global g: G then D → due
- Global g: G then T → task-board

#### help-without-binding (1)

- Calendar: SHIFT V → save-view

#### action-missing-command (19)

- Calendar: SHIFT D → day
- Calendar: H → focus:left
- Calendar: SHIFT H → move:left
- Calendar: I → next
- Calendar: J → focus:down
- Calendar: SHIFT J → move:down
- Calendar: K → focus:up
- Calendar: SHIFT K → move:up
- Calendar: L → focus:right
- Calendar: SHIFT L → move:right
- Calendar: M → month
- Calendar: T → today
- Calendar: U → previous
- Calendar: W → week
- Calendar: ENTER → open-task
- Calendar: ESC → back
- Calendar: SPACE → project:toggle
- Calendar: CMD [ → project:focus
- Global g: G then T → task-board

#### duplicate-keys (2)

- Global g: G then D → Drafts / due
- Global g: G then T → Timers / task-board

## Follow-up (no product changes here)

Decide whether to restore or remove Calendar Shift+V help; reconcile Calendar's shadowed g+t task-board and g+d due-date side effect; decide which local focus/view actions belong in Ctrl+K and whether modifier-permissive bindings are intended. Extend the behavioral harness to board, task detail, app shell, editor, modal, typing and flag contexts before treating this as an exhaustive audit. No flag or key binding is changed by this PR.
