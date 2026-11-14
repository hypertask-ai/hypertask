# Ticket template

Every ticket writer on Hypertask internal boards uses this shape. One file, plain language, a recommendation in every ticket. Do not copy this text into skills or prompts; link to `docs/ticket-template.md` in the repo.

## The block (required for machine checks)

Every new ticket body opens with these five lines in this order, with these exact labels. Technical detail (ids, numbers, logs, resume strings) goes below a horizontal rule.

1. **What's wrong or wanted:** one sentence in plain words.
2. **Who it affects:** customers (how many), a test team, or internal only. If unknown, say so.
3. **Recommended course and why:** the best next step, with one line of why. Not a menu with no pick.
4. **What Valentin must decide:** a yes/no question, or the word "nothing".
5. **How to undo:** the flag, the revert, or "read-only, nothing to undo".

Optional after the divider: related tickets, what was tried, screenshots, and proof for Done when.

## What never goes in the block

- File paths, function names, line numbers, class names. Those belong in the PR or agent log.
- Internal ids, commit hashes, workspace names.
- A question the writer has not answered themselves.

## Rules

- Keep every number, name and quote the person gave, word for word.
- A duplicate is not a new ticket. Search first, then link the existing ticket.
- The recommendation is compulsory. A ticket without one is not finished.

## Example

> **What's wrong or wanted:** In the Inbox, pressing E on a ticket marked blocked by me does nothing.
> **Who it affects:** anyone using Inbox on desktop and phone.
> **Recommended course and why:** Treat blocked-by-me tickets like any other: archive on E, keep the blocker marker, move focus to the next ticket. Why: the marker already explains why the ticket waited.
> **What Valentin must decide:** nothing.
> **How to undo:** revert the PR; no data migration.
>
> ---
>
> Done when: E removes the ticket, it stays gone after two reloads, and the next ticket takes focus.
