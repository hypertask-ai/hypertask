# Board skills (Settings > Board > Skills)

## How a customer reaches it

`https://app.hypertask.ai/settings/board-skills`, or Settings, Board,
Skills. The route `/settings/board/skills` redirects there. Each board
lists its own skills; a skill is typed in AI chat as `/slug`, or as
`@hyperai /slug` in a comment.

## How to drive it

`phone-shot.sh` or Playwright, headless, against production, signed in with
`~/.config/hypertask-videos/storageState-qa.json` (user 985). The New skill
card is one textarea that takes the whole skill (frontmatter plus body) and
a **Create skill** button; an existing skill has **Edit**, **Delete** and an
**Enabled** switch. Watch `GET` and `POST /api/ai/skills?projectId=<board>`
to see the list and the save.

## Save a workflow from AI chat

On a private QA board, ask the sidebar chat to turn the current session
into a skill, or ask `/chat` to create one from a plain description.
Use a unique throwaway slug. The reply must show the slug, name,
description, trigger, body, enabled state and personal or board scope.
Check the actual prior actions and their order appear as reusable
instructions, not an invented transcript.

Before approving, reload the skills list: the draft must not exist.
Reject one draft and verify it stays absent. Edit another draft or change
its scope: the revised draft needs its own approval before saving.
Confirm in a new message, then reload Settings and verify the stored body
and scope. Asking for the same slug again must offer an update, never
silently overwrite or create a near-duplicate. Preview and approve the
update separately.

Invoke the saved `/slug` in chat, the ticket comment skill picker,
Ctrl+J and the Task Writer. Use harmless instructions with a unique
marker, verify that marker reaches each response, and clean up every
throwaway skill and ticket. Board skills still override personal skills
with the same slug. MCP and CLI skill writes retain their existing
permission and write routes.

## What usually breaks

- A skill pasted without a frontmatter header did not save
  ([HTPR-7784](https://app.hypertask.ai/detail/project-15/7784)). The save
  must fall back to the first heading for the name and the slug.
- A save that fails silently: the card must show a specific error, never a
  fake success.
- Agents limited to one team and account-wide skills
  ([HTPR-7663](https://app.hypertask.ai/detail/project-15/7663)).

## What proof to collect

Create a throwaway skill from the textarea, record the `POST /api/ai/skills`
status and the returned name and slug, reload and read the card text back
(name, `/slug`, Enabled), then shoot the page on desktop and at 390x844.
Delete the throwaway skill and reload to prove it is gone.

## Cleanup

Delete every skill you created through its **Delete** control and reload.
Never delete a skill you did not create.
