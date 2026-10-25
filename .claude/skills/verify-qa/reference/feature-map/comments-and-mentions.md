# Comments and mentions

## How a customer reaches it

The comment box at the bottom of a task detail view. `@` opens the mention
picker.

## How to drive it

`agent-browser`, headless, `?realtime=on` on the task. Post a comment, edit
your own comment, and if the ticket touches mentions, `@` a user and confirm
the picker resolves and the mention renders as a link/chip, not plain text.

## What usually breaks

- Edit control ordering on your own comment ([HTPR-6514](https://app.hypertask.ai/detail/project-15/6514), "keep Edit first on
  your own comment").
- Attachment styling regressions: border mismatch against the comment card
  ([HTPR-6474](https://app.hypertask.ai/detail/project-15/6474), two rounds, `#684` and `#675`), selected-attachment background
  ([HTPR-6552](https://app.hypertask.ai/detail/project-15/6552)), light-theme comment separation ([HTPR-6554](https://app.hypertask.ai/detail/project-15/6554)).
- Direct task closing after posting a comment when it should stay open
  ([HTPR-6559](https://app.hypertask.ai/detail/project-15/6559)).

## What proof to collect

Screenshot the comment thread after posting, showing the new comment and any
attachment rendered correctly (border, background, light and dark theme if
the ticket is theme-related). Reload the task and confirm the comment
persisted with the same formatting.

### Automated evidence

`node --test tests/comment-attachment-background.test.cjs` checks comment attachment surface, border and theme-token source rules; screenshots still prove the rendered appearance.
`node --test tests/linkable-mention.test.cjs` round-trips task and page mentions as links and person mentions as spans in the rich-text extension; it does not drive the picker or save a comment.

## Cleanup

Delete any test comment you posted on the account's own board. Comments
don't currently have a bulk-cleanup script, so do it by hand through the UI.
