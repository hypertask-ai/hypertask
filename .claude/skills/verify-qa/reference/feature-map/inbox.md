# Inbox

## Sub-features

- `needs-you` With `htpr-9055-needs-you` at Owner + QA, open `/inbox?split=Needs%20you`: one row per ticket, ordered by action priority first and stored score as the tiebreak, across dates. Click, Enter, next-ticket, reload, archive and undo preserve ranking; ordinary tabs and flag-off order stay unchanged.
  Own-AI teams send nothing; outages use rules; reads never call models. Record daily cost and before/after inbox-read timings. Another runner compares Light, AMOLED and Graphite 2.
- `quiet-agent-moves-and-description-edits` Quiet agent moves and description edits.
- `blocked-by-you-bulk-archive` Blocked by you bulk archive.
- `boundary-keyboard-jumps` Boundary keyboard jumps.
- `typed-comments-from-your-own-agent` Typed comments from your own agent.
- `archive-safe` Archive safe.
- `phone-undo-toast` Phone undo toast.
- `keyboard-focus-with-a-parked-pointer` Keyboard focus with a parked pointer.
- `select-all-stays-inside-the-open-tab` Select all stays inside the open tab.
- `ai-inbox-triage-command` AI inbox triage command.
- `blocker-list-api` Blocker list API.
- `agent-inbox` Open `/inbox/agent/<agentId>` for an agent on your account. The browser title is the agent display name followed by Inbox. The screen lists that agent's inbox. An unknown agent returns you to `/inbox`. A missing sign-in cookie goes to `/login`.
- `reminders-list` Open `/reminders` while signed in. The heading is Reminders. Each row shows the task owner, the board, the title, the ticket number, and Remind me with the relative time. Click or Enter opens the ticket. The check control, tooltip Remind now, or E sends that reminder into the inbox. The toast says Please check your inbox!
- `inbox-decisions` With `htpr-7092-decisions` on, Inbox shows a Decisions split. It lists visible mentions whose comment has a line starting with `Question:`. A later comment you write yourself removes that ticket. A comment from an agent does not. Each board also shows a Decisions view for tickets in UX Sign-off, or in a column named with your name and then Review. Flag off hides the split and the view.
- `inbox-selected-count` With `htpr-7111-inbox-selected-count` on, the inbox header shows the selected count beside the bulk archive button. The text is the number, then selected. It appears only when at least one row is selected. Flag off hides the label.
- `task-waiting-on` With `htpr-7723-task-waiting-on` on, an agent can set or clear Blocked by person. The write is POST `/api/mcp/tasks/waiting-on` with a board-member `userId`. Send `userId` null to clear. The CLI door is `task waiting-on`. Flag off returns 404 for that agent write. The in-app Blocked by person modal still saves.
- `agent-clear-blocker` With `htpr-8205-agent-clear-blocker` on, an agent that clears a blocker comment must send a reason. The ticket note names who cleared the blocker and includes the reason. That clear removes the ticket from the asked person's Decisions list. Flag off does not require the reason, and that clear does not drop the Decisions row.
- `inbox-name-column` With `htpr-8264-inbox-name-column` and `htpr-8264-inbox-row-fill` both on, a desktop inbox row gives the sender a fixed 180px column. The ticket number gets a fixed 72px slot. The name-column flag alone does not apply those widths.
- `inbox-row-fill` With `htpr-8264-inbox-row-fill` on, a desktop inbox row packs the sender, ticket number and title on the left. The preview fills the space before the task chips. It joins the leading comment or the reason, the latest human comment when that text differs, and the description when it differs from the title. The joiner is a middle dot. A reason with no other text can show `No comments or description yet`. Flag off restores the previous widths and one preview line.
- `agent-waiting-person` With `htpr-8917-agent-waiting-person` on, a ticket can wait on one board-member agent. Send `agentId` on POST `/api/mcp/tasks/waiting-on` or POST `/api/tasks/waiting-on`. Do not also send a person. The agent sees the ticket in Blocked by you and in GET `/api/mcp/inbox/list?waiting_on=me`. The task field shows the agent display name. Flag off returns 404 for the agent write and hides the agent in that field.
- `sticky-inbox-splits` With `htpr-9029-sticky-splits` on, desktop inbox split tabs stay pinned at the top of the list. Rows scroll underneath. After the list moves, a thin line shows under the tabs. Flag off lets the tabs scroll away with the rows.
- `inbox-zero-image` With `htpr-9071-inbox-zero-image` on, open `/inbox` on an account with no notifications. The inbox-zero image covers the screen with the words `INBOX ZERO`, and no `All` tab, split-tab row, footer tab row or phone dock sits on top of it. Tabs and the sticky bar stay when any split has a row, or when an unsaved comment draft remains. Flag off puts the bar back on the empty inbox. The gate is in `src/app/inbox/Inbox.tsx`.
- `jev-inbox-triage` With `htpr-9045-jev-inbox-triage` on, Inbox Zero preview asks `typesafe/jev-1.14` which eligible rows are noise. A row is suggested for archive only when the answer is noise at 0.9 or higher. Mentions, assignments, reminders, due items, questions, money and access stay out. An unclear answer stays too. One confirmation still archives. Flag off drops the suggestion.
- `inbox-split-overflow` With `htpr-9080-split-overflow` on, Manage inbox splits shows Overflow hidden. The choice is saved per person and starts off. When Overflow hidden is on, desktop splits stay on one horizontal line. Scroll splits left and Scroll splits right appear when that line overflows. The selected split stays visible. Flag off hides the switch and wraps the tabs.

## How to get to it (user POV)

`https://app.hypertask.ai/inbox`. Notifications and reminders land here from
`src/pages/api/queues/inboxReminder.ts` and `inboxQueue.ts`.

Open `https://app.hypertask.ai/inbox/agent/<agentId>` for one of your agents.
Open `https://app.hypertask.ai/reminders` for saved reminders.
With `htpr-7092-decisions` on, open `https://app.hypertask.ai/inbox?split=Decisions`,
or the Decisions tab on a board.
Selected count, row layout, sticky tabs and split overflow are on the inbox.
The gear on the last desktop split opens Manage inbox splits.
On a ticket, commands include **Blocked by person**.
Ctrl+K, then **Clear inbox to zero**, opens the sheet titled **Get to Inbox Zero**.

### Quiet agent moves and description edits

With `htpr-8143-quiet-agent-updates` on for the recipient, move and edit a
sandbox ticket using an agent. Neither operation creates a human inbox row,
push or move email; both remain in ticket history. Human moves and description
edits, agent questions/QA/done comments, due dates and archive events keep their
existing delivery. Check mixed recipients: an enabled recipient must not silence
someone whose flag is off. With the flag off, agent moves and edits notify as
before. Do not clear existing inbox items as part of this check. Record the
24-hour inflow comparison separately from immediate delivery proof.

## Driving it with agent-browser

`agent-browser`, headless, `?realtime=on`. Trigger a notification (comment on
or assign a task the QA account watches), then check it lands in the inbox,
and that archiving/undo works.

- **Core inbox cycle (YPER4-629), every app deploy and before any flag goes to Everyone:** `node .claude/skills/verify-qa/scripts/inbox-cycle-live.mjs <folder>` as QA 985 seeds three reminders on QA Sandbox, opens one by click, sends a comment with Ctrl+Enter, presses J and E, opens one by Enter, and prints `inbox-cycle ok`. The same cycle runs in the required `browser-smoke` check (`e2e/smoke/inbox-cycle.spec.ts`) with every flag on and with live-like modes. On 2026-11-20 it printed `inbox-cycle ok` with five steps PASS.
- `/inbox` on 2026-11-20 rendered splits Important, All, Updates and Agents for 985. Needs you, Blocked by you and Decisions appear only when their flag is on and there are rows, so their absence in an empty account is not a failure. `/reminders` showed the Reminders heading and six `Remind me` rows. `/inbox/agent/<id>` titled the tab `<agent display name> Inbox`; an unknown id redirected to `/inbox?split=Important`.
- Archive safe is only an entry point while `htpr-8046-archive-safe` is on. It is currently off for 985, so its whole drive block is verified-unreachable until an Owner + QA hold turns it on; the closest real check is the hidden entry point.
- With `htpr-7311-decision-comment-link` on, open Decisions by click, Enter, and Inbox Next: each ticket jumps to and highlights its latest unanswered Question mentioning the viewer; flag off and other splits keep existing navigation. https://app.hypertask.ai/detail/project-15/7311

### Agent inbox

Sign in as the agent owner. Open `/inbox/agent/<agentId>` with that agent's id.
Confirm the browser title uses the display name and the rows belong to that agent.
Open an id you do not own and confirm the app lands on `/inbox`.

### Reminders

Open `/reminders`. Move with J or K. Press Enter and confirm the ticket opens.
Press E, or the Remind now check, on a sandbox reminder.
Confirm the toast Please check your inbox! Then find that item in the inbox.

### Decisions

Turn `htpr-7092-decisions` on for the QA account.
Post a comment with a `Question:` line and a real mention of that account.
Open `/inbox?split=Decisions` and confirm the ticket is there.
Reply as that person, reload, and confirm the ticket leaves the split.
On a board, confirm the Decisions tab shows tickets in UX Sign-off or in a column named with your name and Review.
Turn the flag off and confirm the split and the tab are gone.

### Selected count

Turn `htpr-7111-inbox-selected-count` on. Select two inbox rows.
Confirm the header reads `2 selected` beside bulk archive. Clear the selection and confirm the label goes away.

### Waiting on a person or an agent

With `htpr-7723-task-waiting-on` on, POST `/api/mcp/tasks/waiting-on` as an agent with a member `userId`.
Setting or clearing a blocker comment also needs `htpr-7724-blocker-comment`
(Everyone); with it off the write answers 404.
Confirm the ticket shows Blocked by that person. POST `userId` null and confirm the clear.
With the flag off, the same agent write returns 404. The in-app modal still saves.
With `htpr-8917-agent-waiting-person` on, POST an accepted board-member `agentId` and no person.
Open that agent's inbox and confirm the ticket is in Blocked by you.
GET `/api/mcp/inbox/list?waiting_on=me` as that agent and confirm the same ticket.
Sending both a person and an agent returns 400. Flag off returns 404 and hides the agent on the task.

### Clear a blocker

With `htpr-8205-agent-clear-blocker` on, an agent clears a blocker comment and sends a reason.
Confirm the note says who cleared the blocker and includes the reason.
Confirm the ticket leaves Decisions for the person who was asked.
Omit the reason and confirm the write is refused. Flag off does not add that note.

### Row layout

On a desktop inbox, turn `htpr-8264-inbox-row-fill` on and `htpr-8264-inbox-name-column` off.
Confirm the sender shrinks to at most 180px and the preview fills the space before the chips.
The preview parts are separated by a middle dot.
Turn the name-column flag on as well. Confirm the sender column is 180px and the ticket number slot is 72px.
Turn both off and confirm the older packed row returns.

### Sticky splits and overflow

With `htpr-9029-sticky-splits` on, scroll a desktop inbox list.
Confirm the split tabs stay at the top and a thin line appears under them after the scroll.
The line is a box-shadow token, not a border, so a `border-bottom` assertion
finds nothing. Flag off lets the tabs leave with the rows.
With `htpr-9080-split-overflow` on, open Manage inbox splits from the gear on the last split.
Confirm Overflow hidden is off. Turn it on, reload, and confirm the tabs stay on one line.
The switch is a per-person preference read through the raw flag key string
`useFlag("htpr-9080-split-overflow")`, not the definitions constant, and it
starts off for each person.
When they overflow, use Scroll splits left and Scroll splits right.
Confirm the selected split stays in view. Flag off hides the switch and the tabs wrap.

### Inbox Zero suggestion

With `htpr-9045-jev-inbox-triage` on, press Ctrl+K and choose **Clear inbox to zero**.
Confirm the sheet is **Get to Inbox Zero** and the preview count excludes questions, mentions, assignments, reminders, due items, money and access.
Cancel. Nothing is archived until you confirm. With the flag off, the same command still opens. The preview no longer uses the model suggestion.

## Gotchas

- Opening a row by mouse click dropped `?inboxFlow=true` (counter "3 / 3" instead of "1 / 3"), so sending a comment saved but stayed on the ticket ([HTPR-7655](https://app.hypertask.ai/detail/project-15/7655)). Keyboard Enter still worked, so always test the click path.

- Undo restore skipping rows that are missing by the time undo runs
  ([HTPR-6527](https://app.hypertask.ai/detail/project-15/6527), "skip missing inbox rows during undo restore").
- Archive undo not taking effect immediately, fixed once already
  ([HTPR-5761](https://app.hypertask.ai/detail/project-15/5761), "make inbox archive undo immediate"); worth a regression
  check on any ticket that touches archive/undo.

### What proof to collect

For Inbox visual changes, an independent reviewer must compare the live Inbox
against its Figma frame in Light, AMOLED and Graphite 2. Capture three
side-by-side screenshot pairs, one per theme, and record pass or fail for
each brief item. Return mismatches to Bugs.

Screenshot the inbox with the new item present, then after archiving it, then
after undo, showing it restored. Reload between each step, not just after the
last one, since undo bugs tend to be about state surviving a reload.

### Cleanup

Clear any test notification you created (archive it) so the QA
account's inbox stays empty between runs.

### Gap

The PR check runs on a disposable loopback app, and the live script on QA Sandbox; neither covers the phone layout yet (`--phone` exists on the live script but is not required).

- Reply from a board-opened ticket after its Inbox reminder arrives. The reply
  must archive that new message even though the ticket initially had none.
  Check both desktop and phone, then reload the Inbox. The board-opened ticket
  stays open; the advance-on-send preference still controls Inbox-flow navigation.

### Blocked by you bulk archive

With `htpr-7970-bulk-blocked-inbox` and `htpr-7840-blocked-inbox-archive`
on, select several blocked rows using the existing checkboxes, then archive.
Also test Select all with 20 blocked rows. They must disappear immediately and
stay gone after reload. Undo must restore them without clearing the blocker.
Test a mixed selection containing a real notification and a blocked row for the
same task: archive and undo must process that blocked task only once. Include an
ordinary notification for a different task to cover the normal bulk path.

### Boundary keyboard jumps

With blocked tickets present, use a list longer than the desktop viewport.
Move into its middle, press `gg`, then hold Shift for `gg`.
The first shortcut must focus and reveal the first displayed row; the second
must focus and reveal the last. Repeat in Important and Blocked by you:
their displayed date order differs. Include a draft at a boundary when present.
Neither shortcut may reorder rows or scroll a hidden split. J/K and Enter must
continue from the newly focused row. With `htpr-8083-inbox-boundaries` off,
the previous raw-notification boundary behavior remains.

### Typed comments from your own agent

With `htpr-8090-assignee-inbox` on, assign a sandbox ticket to the QA
account as a person. Post a `kind: qa`, `done` or `question` comment using
that account's own agent, without mentioning the person. The comment must
create one human inbox item even with quiet-owner mode on. An agent-only
assignment is not a human assignment. With the flag off, quiet-owner mode
keeps its previous behavior. Untyped agent chatter and the person's own
human comments stay quiet. Check the Important split, not only All or Agents: typed comments for an
explicit human assignee must earn the ordinary Important slot. A newer agent
move must not hide that comment. Keep agent identity, Important permission,
project split mutes, and stale/done routing intact. For an owner-specific report,
read that owner's actual inbox through the approved CLI; a QA fixture alone
does not prove the reported ticket works. Archive the QA item, reload, and
confirm it stays gone.
Email recipients must not change: this restoration is inbox-only.

### Archive safe

With `htpr-8046-archive-safe` on, select Updates, Important or Agents and click
**Archive safe**. The sheet that opens is headed **Archive safe**, not Get to
Inbox Zero, and shows the eligible count before anything is archived. Cancel
leaves the Inbox unchanged. Confirm, reload,
then undo the batch and reload again. Only moves, edits and their structured agent activity may disappear; Important
and Agents require agent-only events. Mentions, comments (including human replies),
assignments, reminders, direct replies, blocked tickets, assigned tickets, pending
decisions and tickets containing questions or mentions stay. Historical questions
are conservatively kept too. A new protected event between preview and confirm
must refresh the preview instead of archiving. Flag off hides the entry point and
the server refuses the safe rule; ordinary Inbox Zero remains available.

### Phone undo toast

Archive a seeded notification by swiping its Inbox row left. With
`htpr-8097-mobile-undo-toast` on, the small undo card sits at 52% height,
left aligned, at most 110px wide. On a 390x844 phone, verify it stays clear
of the bottom split dock, task comment field and Remove notification action.
Tap Undo and verify the same notification returns, including after reload.
Archive again and dismiss; the notification must stay archived. Check all
four themes. Desktop placement and content stay unchanged; flag off retains
the previous wide bottom-left phone card.

### Keyboard focus with a parked pointer

With `htpr-8142-inbox-keyboard-focus` on, leave the pointer over the list
while J/K scroll through five blocked rows mixed with ordinary notifications.
Repeat on a short list and a 200-row Important list. Each displayed row must be
visited once in order, in both directions. Scrolling a different row under the
stationary pointer must not change selection. Moving the pointer must still
focus its row. Open a blocked row, archive it, Undo, and reload: the blocker
stays set and the row returns. Flag off retains mouse-enter focus.

### Select all stays inside the open tab

With `htpr-8148-inbox-tab-selection` on, keep messages in at least two
splits, select one row, then click the existing group-header checkbox.
The selected count must equal the open split, not All. Click again to clear.
Repeat with Ctrl+A (Cmd+A on Mac). Ctrl+Shift+A remains explicitly global.
Archive the selected split, reload, and verify every unselected message remains.
Existing ticket-wide archive and Undo behavior stays unchanged.
Flag off retains the previous global checkbox behavior.

### AI inbox triage command

With `htpr-8044-triage-inbox` and `htpr-8045-inbox-batches` on, press
Ctrl+K, search **Triage inbox**, then press Enter in the palette field. A fresh full-screen human chat opens
with the triage request; an agent-selected conversation is never reused. No new panel or archive engine is involved.
Enter from the palette field must never open the highlighted inbox ticket; a click on the row also opens the chat.

Use a clean QA chat composer. Seed more than 100 QA-only notifications,
including pure agent updates and a question/reminder that must stay. Require
all pages to be read before the single archive preview. Check every previewed
ticket, including sibling notifications. No archive occurs before a later
explicit yes. After approval, compare the returned IDs with the preview,
reload the inbox, then ask **Undo** and prove the entire batch returns.
Questions and review decisions remain linked in the report. Treat ticket
claims about money or outages as unverified, not current facts.

Turn either flag off in an isolated flag-provider test: the new command
must disappear, but **Clear inbox to zero** and the other Inbox commands
must remain. Demo/tutorial palettes must not launch real inbox triage.
Keep a draft in the chat composer and verify opening the command never
sends or clears that draft. Capture the existing palette and full-screen chat at
1440x900 and 390x844 in Porcelain, Graphite, AMOLED and Dia.

### Blocker list API

With `htpr-8200-blocker-list` enabled, GET `/api/mcp/inbox/list?waiting_on=me` with an MCP token. `waiting_on` is `me` or a positive user ID. Repeat `projectId` or `project` for numeric board IDs; both names combine. Optional `state` is `waiting`, `answered`, or `no-question`. The response is `{ success: true, blockers: [...], total }`; each row has `id`, `ticketNumber`, `url`, `title`, `projectId`, `boardTitle`, `section`, `priority`, `waitingSince`, `blockerCommentId`, `question`, `recommendation`, and `state`. Missing values are null. No state filter returns all three states.

On a sandbox board, mark a Question on a normal ticket waiting on the target person. Verify waiting, then have the target person comment on the ticket or react to the marked Question and verify answered. An agent acting for that person must not answer it. Remove or replace the marker with a non-question and verify no-question. Check repeated board filters and each state filter. Repeat with a human, scoped agent and scoped token; inaccessible boards must never appear, even when requested explicitly. Management tokens get 403. Invalid filters get 400; a disabled flag gets 404. Restore sandbox changes after checking.

### Proof for the inbox routes and flags above

Save the inbox or reminders URL, the flag mode, and a screenshot of the row, split, sheet or task field you checked.
For `/reminders`, capture the list before E and the inbox after the toast.
For Inbox Zero, capture the preview and then the unchanged inbox after Cancel.

### Cleanup for the inbox routes and flags above

Archive the sandbox inbox row the reminder created.
Clear any waiting-on person or agent you set, and restore the blocker comment if you cleared one.
Return each flag to the mode it had before the check.
