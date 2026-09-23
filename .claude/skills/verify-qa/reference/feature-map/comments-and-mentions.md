# Comments and mentions

## How a customer reaches it

The comment box at the bottom of a task detail view. `@` opens the mention
picker.

## How to drive it

`agent-browser`, headless, `?realtime=on` on the task. Post a comment, edit
your own comment, and if the ticket touches mentions, `@` a user and confirm
the picker resolves and the mention renders as a link/chip, not plain text.

## What usually breaks

- Edit control ordering on your own comment (`HTPR-6514`, "keep Edit first on
  your own comment").
- Attachment styling regressions: border mismatch against the comment card
  (`HTPR-6474`, two rounds, `#684` and `#675`), selected-attachment background
  (`HTPR-6552`), light-theme comment separation (`HTPR-6554`).
- Direct task closing after posting a comment when it should stay open
  (`HTPR-6559`).

## What proof to collect

Screenshot the comment thread after posting, showing the new comment and any
attachment rendered correctly (border, background, light and dark theme if
the ticket is theme-related). Reload the task and confirm the comment
persisted with the same formatting.

## Cleanup

Delete any test comment you posted on the QA runner board's task. Comments
don't currently have a bulk-cleanup script, so do it by hand through the UI.
