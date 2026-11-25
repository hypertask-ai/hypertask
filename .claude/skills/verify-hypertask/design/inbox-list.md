# Inbox list

The inbox rows: who, what, tags on the right and row text filling up to the tags.

## Sub-features

- `inbox-rows` row layout and spacing.
- `inbox-tags` tags aligned right.
- `inbox-text` row text fills up to the tags.

## How to get to it (user POV)

- Open Inbox from the sidebar, `https://app.hypertask.ai/inbox`.

## Driving it with design-check

Preconditions:

- The QA account has at least three inbox items, some with tags.

- **Inbox list.** Run `design-check run <TICKET> "https://app.hypertask.ai/inbox" --frame <frame.png>`. `side-<theme>.png` shows the list next to the frame.
- **Proof.** Attach the side images and `report.md`.

## Gotchas

- Today the QA account opening Inbox lands on board 7049 (https://app.hypertask.ai/detail/project-15/8815). Report the Inbox screen `UNREACHABLE` with the landed URL until that ships. Never pass it with `--allow-redirect`.
- An empty inbox shows the inbox-zero screen, not the list. Seed items through the product first.
