# Inbox

## How a customer reaches it

`https://app.hypertask.ai/inbox`. Notifications and reminders land here from
`src/pages/api/queues/inboxReminder.ts` and `inboxQueue.ts`.

## How to drive it

`agent-browser`, headless, `?realtime=on`. Trigger a notification (comment on
or assign a task the QA account watches), then check it lands in the inbox,
and that archiving/undo works.

- **Core inbox cycle (YPER4-629), every app deploy and before any flag goes to Everyone:** `node .claude/skills/verify-qa/scripts/inbox-cycle-live.mjs <folder>` as QA 985 seeds three reminders on QA Sandbox, opens one by click, sends a comment with Ctrl+Enter, presses J and E, opens one by Enter, and prints `inbox-cycle ok`. The same cycle runs in the required `browser-smoke` check (`e2e/smoke/inbox-cycle.spec.ts`) with every flag on and with live-like modes.
- With `htpr-7311-decision-comment-link` on, open Decisions by click, Enter, and Inbox Next: each ticket jumps to and highlights its latest unanswered Question mentioning the viewer; flag off and other splits keep existing navigation. https://app.hypertask.ai/detail/project-15/7311

## What usually breaks

- Opening a row by mouse click dropped `?inboxFlow=true` (counter "3 / 3" instead of "1 / 3"), so sending a comment saved but stayed on the ticket ([HTPR-7655](https://app.hypertask.ai/detail/project-15/7655)). Keyboard Enter still worked, so always test the click path.

- Undo restore skipping rows that are missing by the time undo runs
  ([HTPR-6527](https://app.hypertask.ai/detail/project-15/6527), "skip missing inbox rows during undo restore").
- Archive undo not taking effect immediately, fixed once already
  ([HTPR-5761](https://app.hypertask.ai/detail/project-15/5761), "make inbox archive undo immediate"); worth a regression
  check on any ticket that touches archive/undo.

## What proof to collect

Screenshot the inbox with the new item present, then after archiving it, then
after undo, showing it restored. Reload between each step, not just after the
last one, since undo bugs tend to be about state surviving a reload.

## Cleanup

Clear any test notification you created (archive it) so the QA
account's inbox stays empty between runs.

## Gap

The PR check runs on a disposable loopback app, and the live script on QA Sandbox; neither covers the phone layout yet (`--phone` exists on the live script but is not required).

- Reply from a board-opened ticket after its Inbox reminder arrives. The reply
  must archive that new message even though the ticket initially had none.
  Check both desktop and phone, then reload the Inbox. The board-opened ticket
  stays open; the advance-on-send preference still controls Inbox-flow navigation.

## Blocked by you bulk archive

With `htpr-7970-bulk-blocked-inbox` and `htpr-7840-blocked-inbox-archive`
on, select several blocked rows using the existing checkboxes, then archive.
Also test Select all with 20 blocked rows. They must disappear immediately and
stay gone after reload. Undo must restore them without clearing the blocker.
Test a mixed selection containing a real notification and a blocked row for the
same task: archive and undo must process that blocked task only once. Include an
ordinary notification for a different task to cover the normal bulk path.

## Boundary keyboard jumps

With blocked tickets present, use a list longer than the desktop viewport.
Move into its middle, press `gg`, then hold Shift for `gg`.
The first shortcut must focus and reveal the first displayed row; the second
must focus and reveal the last. Repeat in Important and Blocked by you:
their displayed date order differs. Include a draft at a boundary when present.
Neither shortcut may reorder rows or scroll a hidden split. J/K and Enter must
continue from the newly focused row. With `htpr-8083-inbox-boundaries` off,
the previous raw-notification boundary behavior remains.

## Typed comments from your own agent

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

## Archive safe

With `htpr-8046-archive-safe` on, select Updates, Important or Agents and click
**Archive safe**. The existing Inbox Zero confirmation shows the eligible count
before anything is archived. Cancel leaves the Inbox unchanged. Confirm, reload,
then undo the batch and reload again. Only moves, edits and their structured agent activity may disappear; Important
and Agents require agent-only events. Mentions, comments (including human replies),
assignments, reminders, direct replies, blocked tickets, assigned tickets, pending
decisions and tickets containing questions or mentions stay. Historical questions
are conservatively kept too. A new protected event between preview and confirm
must refresh the preview instead of archiving. Flag off hides the entry point and
the server refuses the safe rule; ordinary Inbox Zero remains available.

## Phone undo toast

Archive a seeded notification by swiping its Inbox row left. With
`htpr-8097-mobile-undo-toast` on, the small undo card sits at 52% height,
left aligned, at most 110px wide. On a 390x844 phone, verify it stays clear
of the bottom split dock, task comment field and Remove notification action.
Tap Undo and verify the same notification returns, including after reload.
Archive again and dismiss; the notification must stay archived. Check all
four themes. Desktop placement and content stay unchanged; flag off retains
the previous wide bottom-left phone card.

## Keyboard focus with a parked pointer

With `htpr-8142-inbox-keyboard-focus` on, leave the pointer over the list
while J/K scroll through five blocked rows mixed with ordinary notifications.
Repeat on a short list and a 200-row Important list. Each displayed row must be
visited once in order, in both directions. Scrolling a different row under the
stationary pointer must not change selection. Moving the pointer must still
focus its row. Open a blocked row, archive it, Undo, and reload: the blocker
stays set and the row returns. Flag off retains mouse-enter focus.
