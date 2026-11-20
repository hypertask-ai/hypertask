# Starred tasks and comments

## Sub-features

- `starred-tasks-and-comments` Starred tasks and comments.
- `pinned-page` `/pinned` (`src/app/pinned/page.tsx`) lists public comment pins. A signed-out visit goes to `/login`. Your Pins is this account's pins. Team Pins is other people's public pins on boards this account can open. The count sits beside each tab. Tab moves to the other list. Shift+Tab returns to Your Pins. Escape goes back.
- `agent-comment-pin-and-star` With `htpr-8218-comment-pin-star` on, an agent with a write role can pin or star a comment it can read. Pin stores a public marker. Star stores a private marker for that agent. The same call again removes that agent's marker. A person's pin or star stays as it is. Off answers that comment pin and star are not enabled.
- `agent-follow-star-remind` With `htpr-8217-agent-follow-reminder` on, an agent can follow, unfollow, star, unstar, or remind on a ticket it can open. `POST /api/mcp/tasks/follow` takes `action` and an integer `taskId`. `remind` also needs `remindAt` as an ISO date time. `read` returns whether that agent is following, whether the ticket is starred, and `remindAt`. A write needs the agent write role. Off answers that agent task tracking is not enabled. Follow, star, and reminder in the app stay on their own controls.

## How to get to it (user POV)

Open `/starred` in a fresh browser context, before saved content is cached.
Both lists must render safely while the saved-content request is pending.
Select **Starred Tasks** or **Starred Comments**.

Open `/pinned` for public comment pins. Your Pins is the first tab. Team Pins is the second. People pin a comment from the ticket with Ctrl+Shift+P, and star it with Ctrl+Shift+S (Cmd on Apple). An agent's pin uses that same public marker and shows on `/pinned`. An agent's comment star uses the private marker and shows on `/starred`. Follow and remind are on the ticket, not on these two lists.

## Driving it with agent-browser

Use J/K or the arrow keys to select rows. Enter opens the selected task.
Alt+S removes a selected task star. Ctrl+Shift+S removes a selected comment
star (Cmd+Shift+S on Apple devices). Removing the last selected row leaves
the nearest remaining row selected. Switching to a shorter tab keeps a valid
selection. Repeating unstar on an empty list makes no request.

On `/pinned`, sign in as QA 985. Confirm both tabs render, including a zero count. J or Down, and K or Up, move the row. Enter opens that comment's task. Ctrl+Shift+P (Cmd+Shift+P on Apple) on your own pin removes it from the list. Escape returns to the previous screen.

With `htpr-8218-comment-pin-star` on, pin a readable comment, then pin it again. The states come back pinned, then unpinned. Star it the same way and confirm a person's star on that comment does not change. With `htpr-8217-agent-follow-reminder` on, follow, star, and remind one throwaway task, then `read` it. Unfollow and unstar it. With either flag off, that call answers that the action is not enabled, and the ticket is unchanged.

## Gotchas

- A saved row index can outlive a removed row or a longer tab, causing
  shortcuts to crash instead of opening or unstarring the remaining item.
- Star writes must affect only the selected task or comment.

### What proof to collect

As QA 985, create two `[qa-runner]` tasks and a comment on QA Sandbox 7049.
Star both tasks and the comment. On `/starred`, select the second task, then
switch to the one-row comments tab. Press Ctrl+Shift+S. Confirm the comment
star disappears without a browser error. Reload and confirm it stays gone.
Capture desktop and phone screenshots and the saved-content API readback.

Local regression: `npm run test:file -- tests/htpr-8092-starred-selection.test.cjs`.
It dispatches document keyboard events through the real `StarredRow` component
for shorter lists, tab changes, empty lists, and opening the remaining task.

### Cleanup

Unstar and delete only the fixture tasks created by this run. Never change
other QA stars or comments.

Do not switch a production flag to check agent pin, star, follow, or remind.
Screenshot both `/pinned` tabs on desktop and phone, and the task Enter
opens. Save the pin, star, and `read` bodies with no tokens. Unpin, unstar,
unfollow, and clear the reminder only on the throwaway task or comment.
