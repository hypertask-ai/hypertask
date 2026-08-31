# Typography conventions

The core AMOLED, Graphite, and Porcelain themes render app UI text in **IBM Plex Sans**.
The Dia theme adds italic **Newsreader** to board, column, modal, and `h1`–`h3`
headings. Inter remains the Tailwind `font-sans` default and the fallback for
surfaces not overridden by a theme selector.

Two rules carry most of the UI: **list-view text is 13px, list-view chips are
11px.** Everything below is the concrete convention rolled out in HTPR-4048 /
HTPR-4056. The visual reference lives in the style guide at
`design-system/tokens/typography.html`.

The font files are registered in `src/app/layout.tsx`. Core theme selectors apply
`--font-plex` in `src/styles/tailwindThemes/{amoled,graphite,porcelain}.css`, and
Dia headings use `--font-newsreader` in `src/styles/tailwindThemes/dia.css`.

## List views (inbox, search, all-tasks, archived, pinned, reminders, scheduled)

| Element | Size |
|---|---|
| Row text: task title, ticket number, sender / user name, "Mentioned in" / "Assigned to you", comment preview, timestamp | **13px** |
| Row chips: priority, size/estimate, due date, tag labels, `+N` overflow | **11px** |
| Section headers / inbox split tabs | **14px** |
| Split-tab / section counts | **11px** |

Hierarchy rule: the meta line (timestamp, "Mentioned in"/"Assigned to you",
ticket id, ticket subject, sender name) is always **bigger** than the tags on
the same row. Tags never out-size the content they describe.

Chips are sized via the `fontSize` prop on the shared label components
(`PriorityLabelComponent`, `EstimateLabelComponent`, `DueDateLabel`,
`TaskLabelComponent`) and the `LabelWrapper` (`src/components/Labels/`). Row
text is set on the row component itself
(`src/components/Common/TaskRowComponents/TaskTitle.tsx`,
`src/components/notifications/NotificationRow.tsx`, `src/app/inbox/Inbox.tsx`).

## Task detail: property sidebar (HTPR-4056)

| Element | Desktop | Mobile |
|---|---|---|
| Property label + value text | 13px | 12px |
| Chips (tags, priority, due date, assignee) | 12px | 12px |

Multi-line property rows (Tags, Followers, Related tasks) top-align the label
with the first value row (`TaskInfoRow alignTop`). Mobile chips are borderless
`bg-label-span` with `rounded-sm` (2px) corners. Files:
`src/components/PageComponents/TaskDetail/`.

## Kanban board

Board cards stay at **12px** (denser than the inbox by design). Do not fold
them into the 13px list-view scale.

## Board header

The board title is **16px, font-medium**, normal text color
(`TitleKanbanHeader.tsx` and the shared-project `header.tsx` twin). The header
icons (sort, filter, hidden-columns, calendar, search) render at **14-16px**.
The left board-nav button uses `LuPanelLeft` at **18px desktop / 16px mobile**
(`src/components/PageComponents/Kanban/HeaderComponents/header.tsx`) so it sits
in the same visual weight as its neighbours rather than towering over them.

## What is intentionally out of scope

Modals, comment/description body content, and the AI chat keep their own sizing
and are not part of the list-view scale. The globals mobile `p { font-size:
14px }` override was removed (it silently fought component sizes).
