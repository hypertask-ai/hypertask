# Agent lane

The agent lane on a ticket: agent rows between comments, their spacing, and collapse with Shift+O.

## Sub-features

- `lane-rows` agent rows use the comment card spacing.
- `lane-collapse` Shift+O collapses agent rows to one line, with the comments.

## How to get to it (user POV)

- Open a ticket that has agent activity, then press Shift+O.

## Driving it with design-check

Preconditions:

- A ticket on board 7049 has agent rows. Use its detail URL.

- **Expanded lane.** Run `design-check run <TICKET> "<ticket detail url on board 7049>" --frame <expanded frame.png>`.
- **Collapsed lane.** Run the same with `--press "Shift+O"` and the collapsed frame.
- **Proof.** Attach both side images and `report.md`.

## Gotchas

- A ticket with no agent rows shows nothing to compare. Pick one with rows.
- Shift+O inside the comment box types a letter. The run presses it with the page focused.
