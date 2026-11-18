# Board skills (Settings > Board > Skills)

## Sub-features

- `save-a-workflow-from-ai-chat` Save a workflow from AI chat.
- `a-repeated-instruction-becomes-a-skill-offer` A repeated instruction becomes a skill offer.
- `skill-chat-followup` With `htpr-7319-skill-chat-followup` on, Ctrl+J that used a skill opens AI chat at once. The first message still says it created the ticket from your note, then adds how that skill changed the ticket.
- `scoped-agent-skills` With `htpr-7663-scoped-agent-skills` on, a team-bound agent can list board skills on readable boards in its team without a project id. Off, that list is refused.
- `chat-skill-drafts` With `htpr-7768-chat-skill-drafts` on, AI chat shows a full skill draft and saves it only after you approve that draft in a new message.
- `skill-offers` With `htpr-7779-skill-offers` on, the same instruction repeated on one board can show one Skill suggestion card. Off hides the card and stops counting.
- `skill-runs-in-sidebar` With `htpr-7800-skill-runs-in-sidebar` on, picking a `/slug` in a ticket comment runs it in the AI chat sidebar with the ticket and the comment draft. Off opens the comment skill writer.

## How to get to it (user POV)

`https://app.hypertask.ai/settings/board-skills`, or Settings, Board,
Skills. The route `/settings/board/skills` redirects there. Each board
lists its own skills; a skill is typed in AI chat as `/slug`, or as
`@hyperai /slug` in a comment.

## Driving it with agent-browser

`phone-shot.sh` or Playwright, headless, against production, signed in with
`~/.config/hypertask-videos/storageState-qa.json` (user 985). The New skill
card is one textarea that takes the whole skill (frontmatter plus body) and
a **Create skill** button; an existing skill has **Edit**, **Delete** and an
**Enabled** switch. Watch `GET` and `POST /api/ai/skills?projectId=<board>`
to see the list and the save.

### Save a workflow from AI chat

This approval flow is `htpr-7768-chat-skill-drafts`. Off, chat can write
the skill on the first save, with no separate draft approval.

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

### A repeated instruction becomes a skill offer

The card is `htpr-7779-skill-offers`. Off, no card appears, and chat
does not count repeated instructions.

On a private QA board, sign in as user 985 and start three separate
sidebar chats on that board. In each chat, give the same standing
instruction in your own words five times in total, for example "put the
ticket id next to the title, not in the body". The fifth message must be
followed by one card under the reply: "Skill suggestion", the count of
times you said it, the number of chats, your own quoted words, and one
reason for skill or board memory.

Dismiss with **Not now**: the card must say it will not be suggested
again, and the next qualifying chat turn on that board must show no
card. A second pattern must not appear in the same six hours on that
board. Check `GET /api/ai/skill-offers?id=<id>` returns only your own
offer, and that another account gets 403 or 404.

**Draft it** must send one chat message and the usual skill draft must
follow, with nothing saved until you approve. **Save board rule** on a
memory suggestion must fail with a clear message while board memory is
off, and write the rule into Settings > Board > Memory once it is on.

### Skill follow-up after Ctrl+J

Turn `htpr-7319-skill-chat-followup` on. In Ctrl+J, run a saved `/slug`
so the writer receives that skill, then create the ticket. AI chat
opens before the follow-up returns. While it is loading, the thread
shows a typing indicator and the ticket chips wait. The first assistant
message still starts with "I created" and the ticket id "from your
note. Want me to refine it?" and then adds the skill explanation.
A failed follow-up leaves that generic greeting. Flag off keeps the
generic greeting and still opens chat.

### Team-bound skill list

Turn `htpr-7663-scoped-agent-skills` on for a team-bound agent. Call
`GET /api/mcp/skills` with no `project_id`, or the chat tool
`hypertask_list_skills` with no project. The list is board skills on
boards that the credential can read in its team. Personal skills stay out.
The same call with the flag off returns "Account-global skills access
denied". A call that includes `project_id` still checks access to that
board with the flag on or off.

### Run a comment skill in the sidebar

On a ticket, open the comment box. `htpr-7480-comment-skill-run` and
`htpr-7393-comment-inline-ai` must be on, or the slash menu cannot
start a skill. Type `/` and pick a skill. With
`htpr-7800-skill-runs-in-sidebar` on, the AI chat sidebar opens and the
first message is `/slug` plus the current comment text. The comment
skill writer stays closed. If chat is already sending, the toast says
"Could not run the skill. Please try again." Flag off opens the
comment skill writer instead.

## Gotchas

- A skill pasted without a frontmatter header did not save
  ([HTPR-7784](https://app.hypertask.ai/detail/project-15/7784)). The save
  must fall back to the first heading for the name and the slug.
- A save that fails silently: the card must show a specific error, never a
  fake success.
- Agents limited to one team and account-wide skills
  ([HTPR-7663](https://app.hypertask.ai/detail/project-15/7663)).
  With `htpr-7663-scoped-agent-skills` off, a team-bound list with no
  project id is "Account-global skills access denied". On, that list
  is only boards the credential can read in its team.

### What proof to collect

Create a throwaway skill from the textarea, record the `POST /api/ai/skills`
status and the returned name and slug, reload and read the card text back
(name, `/slug`, Enabled), then shoot the page on desktop and at 390x844.
Delete the throwaway skill and reload to prove it is gone.

### Cleanup

Delete every skill you created through its **Delete** control and reload.
Never delete a skill you did not create.
