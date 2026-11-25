# Kanban board

The board view a user lands on: columns, cards, chips, avatars, the left rail with New Task, and scrollbars. Design tickets change corners, spacing, card borders and colours here.

## Sub-features

- `kanban-cards` plain, active and blocked cards with their borders and padding.
- `kanban-columns` column titles lined up with card text.
- `kanban-rail` the New Task "+" on the rail.
- `kanban-scroll` square scroll thumbs, no arrows.

## How to get to it (user POV)

- Open any board from the sidebar.
- Open a board link such as `https://app.hypertask.ai/project?id=7049&surface=board`.

## Driving it with design-check

Preconditions:

- Board 7049 has at least one plain card, and ideally an active or blocked card.
- The frame is the ticket's cleanup frame, for example `kanban-cleanup.png` on HTPR-8255.

- **Graphite 2 board.** Run `design-check run HTPR-8255 "https://app.hypertask.ai/project?id=7049&surface=board" --frame kanban-cleanup.png --themes graphite-2 --viewport 1920x1032`. The run folder holds `side-graphite-2.png`, design left and live board right.
- **No change in other themes.** For a Graphite 2 only ticket, run the same with `--themes porcelain,amoled` and compare against production shots taken before the merge.
- **Corners and colours.** Read `audit-graphite-2.json`. Zero corner, purple and sparkle findings, or each one named in the QA comment as a FAIL.
- **Proof.** Attach `side-graphite-2.png` and `report.md` to the `--kind qa` comment.

## Gotchas

- The QA account opening board 15 lands on board 7049. Board 7049 is the target until https://app.hypertask.ai/detail/project-15/8815 ships.
- Without `&surface=board` board 7049 opens as a table. The pair then compares a table with a board and means nothing.
- Board 7049 cards differ from the frame's sample cards. Judge styling, not card text, so the score never reaches 0.
- Columns with no cards hide on some views. Seed a card through the product if a needed column is empty.
