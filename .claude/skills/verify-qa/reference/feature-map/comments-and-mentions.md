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

## Local writing corrections

When local sentence capitalization is enabled, type `hello` in an empty
comment draft. It becomes `Hello`; the brief correction underline covers
the whole word. Delete the whole word and type `hello` again: it must stay
lowercase. Selecting the whole corrected word and replacing it must also
keep lowercase. A fresh paragraph or sentence must still capitalize.
Backspace or Ctrl+Z immediately after the first corrected letter still
restores lowercase. Pasting and code blocks remain unchanged.

Run the same draft checks in the AI chat composer, which uses the shared
writing extension. Clear drafts without sending them. For flag-off checks,
use the plain QA account and confirm typing remains unchanged.

## Durable agent attribution

Agent comments keep the name stored when written. Removing the acting agent
must not replace that name with "Private agent". Living private agents remain
hidden from callers who cannot access them.

On QA Sandbox 7049 as QA 985, create only throwaway external agents and a
throwaway task. Post through one agent's MCP credential, then read through the
other agent's credential using `/api/mcp/comments` and `/api/mcp/tasks/context`.
Read the same thread through `/api/comments/getByTask` with the QA session.
Delete only the throwaway author through its owner's agent surface. Repeat all
three reads: the stored author name must remain. Reload task detail on desktop
and phone and verify the rendered author. Delete the observer and test task.
Never save credentials, credential-bearing responses, traces, or token screens.

Targeted dispatch and privacy coverage:
`npm run test:file -- tests/htpr-8114-agent-attribution-removal.test.cjs tests/mcp-comments-cross-team-agent-visibility.test.cjs tests/mcp-task-context-agent-visibility.test.cjs tests/mcp-comment-reactions.test.cjs`.
