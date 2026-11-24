# Task detail and description

## Sub-features

- `ctrl-o-ticket-link-labels` Ctrl+O ticket link labels.
- `background-smart-labels` Background smart labels.
- `description-ai-draft-review` Description AI draft review.
- `time-reports` Signed-in `/time` (`src/app/time/page.tsx`) is the Time reports screen. Scope by team, board, date range, and user when the report allows other people. Group by day, task, or user. Export CSV, add a time entry, and pause, resume, or stop a running timer.
- `local-writing-assistance` With `htpr-5908-local-writing-assistance` on (Everyone), a lowercase letter typed at a paragraph start or after sentence punctuation is capitalized in an editable editor when the browser does not do it.
- `auto-task-descriptions` With `htpr-6177-auto-task-descriptions` on, Settings, Task page, shows Suggest descriptions from task titles. The line under it is Show an AI draft below empty task descriptions. The saved preference defaults on. The command list includes Settings: Suggest descriptions from task titles.
- `autocap-undo` With `htpr-6906-autocap-undo` on (Everyone) and local writing assistance on, Backspace, Ctrl+Z, or Cmd+Z right after that automatic capital restores the lowercase letter. The changed letter stays underlined for 1800ms.
- `unread-ticket-opens-top` With `htpr-7315-unread-ticket-opens-top` on (Owner + QA), a ticket with no deep link opens at the description when it was never read, at the first unread comment when one exists, and at the newest comment otherwise.
- `ticket-chat-reminder` With `htpr-7318-ticket-chat-reminder` on (Everyone), above the comments the viewer sees You chatted about this ticket and Only you see this, then that viewer's three newest chats on this ticket that already have messages. A row opens the AI sidebar and resumes that chat.
- `cached-static-first` With `htpr-7395-cached-static-first` on (Everyone), a cached ticket paints the saved description before the rich editor loads, then mounts the editor after paint. A warm editor keeps the immediate path. Off mounts the editor immediately.
- `inline-agent-images` With `htpr-7514-inline-agent-images` on (Everyone), an agent image write embeds the image in the description or comment. Attachment only, link only, or inline_images false keeps the file or link.
- `ticket-first-screen` With `htpr-7627-ticket-first-screen` on (Owner + QA), a full ticket page seeds that account's flags and board display preferences into the HTML before the first client render. An RSC request or a missing display cookie skips the seed.
- `summary-on-view` With `htpr-7848-summary-on-view` on (Owner + QA), a ticket change only marks the AI summary out of date. Opening the ticket schedules one refresh, at most once a minute, five seconds later. Stripe checkout marks that team's tickets out of date instead of generating summaries. Off keeps the scheduled runs.
- `empty-field-labels` With `htpr-7868-empty-field-labels` on (Everyone), an empty Due date shows No due date and an empty Task size shows No size, in the ticket side panel and the new task window. Off shows a dash.
- `new-subtask-button` With `htpr-8250-new-subtask-button` on (Everyone), the sub-task modal always starts with + Create new sub-task, or Create sub-task plus the typed name. Off shows create only when the search matches nothing.
- `agent-automatic-ai` With `htpr-8904-agent-automatic-ai` on (Owner + QA), an agent-authored ticket change skips the automatic ticket summary, comment summary, and smart labels. A person's edit on the same board still runs them. Off restores the agent calls.
- `ctrl-j-write-with-ai` With `htpr-8975-ctrl-j-write-with-ai` on (Owner + QA), Ctrl+J or Cmd+J in an editable ticket comment, comment edit, or description skips the compose palette and runs the editor's Write with AI toggle. The inline box uses the comment well, the comment-row mic, and a text Rewrite button instead of the purple arrow.
- `right-column` With `htpr-8991-right-column` on (Owner + QA), the ticket side panel keeps Status and Project, shows the other fields only when they have a value, and adds Add field. Add field opens the command list of the empty fields. Live, `htpr-8997-id-row` (EVERYONE) also puts the ticket ID in that panel under ID; without it the ID sits beside the title and copies on click.
- `sticky-title` With `htpr-8992-sticky-title` on (Owner + QA), the ticket title bar stays put and, once the page is scrolled, draws a 1px line under it. On a phone that line uses the border token that stays visible in dark themes. Off leaves the header as it is.
- `ai-box-outline` With `htpr-9025-ai-box-outline` on (Owner + QA), the Write with AI box in the description and comment editors gets a 1px outline in the editor border colour. Size and corners stay the same. Off removes that outline.
- `ticket-jump-to-top` With `htpr-8998-ticket-jump-to-top` on (Everyone), a long ticket shows a 32px jump-to-top button at the bottom right after the page scrolls down. A click, or G then G, returns to the top. Hover says Jump to top with G G. The button stays hidden on a phone. Off hides the button and G then G moves to the description again. Shift+G then G still focuses the new comment. The cheatsheet and Settings list the shortcut only while the flag is on. Ticket page: `src/app/detail`. Cheatsheet: `src/components/sidebars/keyboardShortcuts.tsx`. Settings: `src/components/Modals/Settings/ShortcutsSection.tsx`. Live check is `/settings/shortcuts`. Off proof: `tests/htpr-8998-ticket-jump-to-top.test.ts`.

## How to get to it (user POV)

`https://app.hypertask.ai/detail/project-<id>/<taskNumber>`, opened from a
board card, an Inbox notification, or a deep link.

Time reports are `https://app.hypertask.ai/time` for a signed-in account.
The page title is Time. Back returns to the previous screen.

The description, comments, title, side panel, sub-task modal, and Write with
AI box are on that ticket. Suggest descriptions from task titles is in
Settings, Task page. The new-task window uses the same empty Due date and
Task size labels.

## Driving it with agent-browser

`agent-browser`, headless, `?realtime=on`. Open the task, edit the
description, save, then leave and reopen the task (or reload) to confirm the
edit stuck. If the ticket involves AI-edited descriptions, trigger that flow
specifically rather than a manual edit.

**Hands-free drive:**
`node .claude/skills/verify-qa/scripts/task-drive-live.mjs <folder> --base http://127.0.0.1:3100 --state <storageState.json>`
Checks the title and saved description, including bold.
Prints PASS/FAIL per step and `task ok`. Loopback only.
`--break title` must print `negative control ok`.
Run hosted with `scripts/verify-qa <branch> hands-free-drives`.

Read each flag's live mode with `ht-verify flags show <key>` before calling a row
(Owner + QA). On 2026-11-20 these read EVERYONE while their rows here say
Owner + QA: `htpr-8991-right-column`, `htpr-8992-sticky-title`,
`htpr-9025-ai-box-outline`, `htpr-7315-unread-ticket-opens-top`,
`htpr-7627-ticket-first-screen`. For an EVERYONE flag the live off state is
unreachable and the test named in that row is the off proof, not a flag switch.
`htpr-6177-auto-task-descriptions` read OFF, so its on screen is the unreached
state.

### Time reports

Open `/time` signed in. Confirm the Time reports title, Team, Board, Date
range, and Group by. With no rows, Export CSV is disabled and the list says
No time entries. Pick one board, open + Add time entry, search a disposable
task, set hours, and save. That saved row has an end time, so it shows Edit
and Delete, not Pause or Stop. To check a running row, open that ticket and
press Start, then return to `/time`. The running row shows Pause or Resume,
and Stop. Press Stop before leaving. The duration opens the time log. The
task name links to that ticket.

Live empty state, 2026-11-20: `ht-verify open /time --wait body` gives the
heading Time reports, the SCOPE row Team / Board / User / Date range / Timers /
Group by, `Total 0:00:00`, the + Add time entry button and `No time entries.`
(period included). The URL carries team, from, to and group in the query.

### Local writing assistance and undo

In a disposable ticket description, with
`htpr-5908-local-writing-assistance` on, type a lowercase letter at the start
of an empty paragraph and after a period and a space. The editor capitalizes
it. With `htpr-6906-autocap-undo` also on, press Backspace once, or Ctrl+Z
or Cmd+Z, before typing more. The lowercase letter returns, and the capital
was underlined. Do not switch either flag Off. Off proof:
`tests/editor-writing-assistance.test.ts`.

### Suggest descriptions from task titles

With `htpr-6177-auto-task-descriptions` on, open Settings, Task page. The
toggle Suggest descriptions from task titles is present and defaults on.
Ctrl+K or Cmd+K lists Settings: Suggest descriptions from task titles. The
task-writer request kind auto-description is rejected with Automatic
description suggestions are turned off, so do not expect a draft to appear
under an empty description from that request. Do not switch
`htpr-6177-auto-task-descriptions` Off. The Settings toggle is a preference,
not the flag. Follow the Batch 3 proof rule for the flag's live mode.

### Where a ticket opens

With `htpr-7315-unread-ticket-opens-top` on, open three disposable tickets
that have no hash deep link: never read, already read with no new comments,
and one with a newer comment than last read. They land on the description,
the newest comment, and the first unread comment. A comment hash still wins.
From a board, a scroll setting other than Bottom stays at the top. From an
inbox item, scroll setting None stays at the top. Do not switch
`htpr-7315-unread-ticket-opens-top` Off. Off proof:
`tests/htpr-7315-initial-ticket-position.test.cjs`.

### Ticket chat reminder

With `htpr-7318-ticket-chat-reminder` on, chat about one disposable ticket
from the signed-in account, then reopen it. Above the comments, You chatted
about this ticket and Only you see this list at most three sessions. Another
account on the same ticket does not see them. Clicking a row opens the AI
sidebar on that session. Do not switch `htpr-7318-ticket-chat-reminder` Off.
Off proof: `tests/htpr-7318-ticket-chat-reminder.test.cjs`.

### Cached description, first screen, and summary on view

With `htpr-7395-cached-static-first` on, open a ticket that was already
loaded. The saved description is visible before the rich editor mounts.
Reload a ticket whose editor module is already warm and the editor mounts
without that wait. Do not switch `htpr-7395-cached-static-first` Off.
Off proof: `tests/htpr-7395-cached-static-first.test.cjs`.

With `htpr-7627-ticket-first-screen` on, load a ticket document as that
account, not as an RSC request, and with the board display cookie set. The
first HTML includes that account's flag values and display preferences.
Missing the cookie leaves the ticket unseeded. Do not switch
`htpr-7627-ticket-first-screen` Off. Follow the Batch 3 proof rule. No test
covers this flag off.

Record the live summary-on-view schedule and the Stripe checkout mark as
UNREACHABLE. Changing a ticket only marks the summary out of date. Opening
that ticket schedules a summary five seconds later and spends the AI
allowance, which this map does not spend merely to force a summary. A
finished Stripe checkout changes a live team's plan. Do not start a
checkout and do not change a plan. Do not switch
`htpr-7848-summary-on-view` Off. Closest proof is
`tests/htpr-7848-summary-on-view.test.cjs`, including the test
`a checkout marks in-scope tickets and asks for the backfill otherwise`.

### Empty field labels and the right column

With `htpr-7868-empty-field-labels` on, open a ticket and a new task with no
due date and no size. Both say No due date and No size. Set a date and a
size and the real values show. Do not switch `htpr-7868-empty-field-labels`
Off. Off proof: `tests/htpr-7868-empty-field-labels.test.cjs`.

With `htpr-8991-right-column` on, Status and Project stay. Empty assignee,
due date, priority, size, and tags are hidden. Add field opens the command
list of those empty fields. The ticket ID beside the title copies on click.
Do not switch `htpr-8991-right-column` Off. Follow the Batch 3 proof rule.
No test covers this flag off.

### Sub-task button

With `htpr-8250-new-subtask-button` on, open the sub-task modal on a
disposable ticket. The header is Link existing or create a new subtask. With
an empty search the first row is + Create new sub-task. Type a name and the
row becomes `Create sub-task "<name>"` (with quotes), while matching tasks stay in
the list. Do not switch `htpr-8250-new-subtask-button` Off. Off proof:
`tests/htpr-8250-new-subtask-button.test.cjs`.

### Agent images and agent automatic AI

With `htpr-7514-inline-agent-images` on, have an agent put an image in a
disposable description or comment without asking for attachment only or link
only. The image is inline. Repeat with an explicit attachment-only or
link-only instruction and the image stays a file or a link. Do not switch
`htpr-7514-inline-agent-images` Off. Off proof:
`tests/htpr-7514-inline-agent-images.test.cjs`.

With `htpr-8904-agent-automatic-ai` on, an agent-authored change on a
disposable ticket does not schedule a ticket summary, a comment summary, or
smart labels. A person editing the same ticket still does. Do not switch
`htpr-8904-agent-automatic-ai` Off. Off proof:
`tests/htpr-8904-agent-automatic-ai.test.cjs`.

### Sticky title and the Write with AI box

With `htpr-8992-sticky-title` on, scroll a long ticket. The title bar stays
and a 1px line appears under it. On a phone, check the line in a dark theme.
Do not switch `htpr-8992-sticky-title` Off. Off proof:
`tests/htpr-8992-sticky-title.test.cjs`.

With `htpr-8975-ctrl-j-write-with-ai` on, focus an editable description or
comment and press Ctrl+J or Cmd+J. The compose palette stays closed and the
editor's Write with AI toggle runs. The inline box uses the comment well,
the comment-row mic, and a text Rewrite button. Press Ctrl+J or Cmd+J again
inside the box and it closes. Do not switch `htpr-8975-ctrl-j-write-with-ai`
Off. Off proof: `tests/htpr-8975-ctrl-j-write-with-ai.test.cjs`.

With `htpr-9025-ai-box-outline` on, that same box has a 1px outline in the
editor border colour. The corners and the controls do not move. Do not
switch `htpr-9025-ai-box-outline` Off. Follow the Batch 3 proof rule. No
test covers this flag off.

### Jump to top

With `htpr-8998-ticket-jump-to-top` on (Everyone), open
`/settings/shortcuts` and read the Task View group. Its last row is
Jump to top with the keys G then G. Stay on `/settings/shortcuts` for the
whole check: the ticket button only mounts after the page scrolls, and the
runner cannot scroll or hover, so a ticket page in the same plan leaves the
URL expectation failing after the Settings visit. On a long ticket by hand,
scroll down, click the 32px button at the bottom right, and confirm the page
returns to the top; G then G does the same. Do not switch
`htpr-8998-ticket-jump-to-top` Off. The ticket page is `src/app/detail`, the
cheatsheet `src/components/sidebars/keyboardShortcuts.tsx`, and Settings
`src/components/Modals/Settings/ShortcutsSection.tsx`. Off proof:
`tests/htpr-8998-ticket-jump-to-top.test.ts`.


## Gotchas

- Open task not refreshing its description when a realtime update drops
  ([HTPR-6281](https://app.hypertask.ai/detail/project-15/6281), fixed then reverted then re-landed as `#746`, the kind of bug
  that needs the reload check below, not just a live-DOM look).
- AI-edited descriptions losing structure ([HTPR-6561](https://app.hypertask.ai/detail/project-15/6561)).
- Mobile Task Writer saving the wrong thing or locking direct save
  ([HTPR-6564](https://app.hypertask.ai/detail/project-15/6564)).
- The back and up/down buttons covering the first letters of the title when
  the ticket column is under 640px wide, e.g. a 900-1100px window with the AI
  panel open as a plain customer
  ([HTPR-7349](https://app.hypertask.ai/detail/project-15/7349)). Measure, do
  not eyeball: the buttons' right edge must stay left of the title's left
  edge at 900, 1024 and 1100px, and the title must not move at 1180px and
  wider or on a phone.

### What proof to collect

For a manual edit, screenshot the description before and after, then a
**reload check**: close and reopen the task (or full page reload) and
screenshot again.

Headless, the description editor does not open from a click: clicking
`#description-input` and pressing Enter left no
`#description-container .ProseMirror[contenteditable='true']` mounted and the
stored description empty (tried 2026-11-20 on production). Write the
description through the same route the editor posts, then prove the read
view after a reload:

```bash
ht-verify api PUT /api/tasks/single --data '{"newTask":{"id":<task>,"description":"<p>QA runner description edit.</p>"}}' --confirm --state "$QA_STATE"
ht-verify open /detail/project-7049/<index> --wait "#description-input"
ht-verify probe "#description-container" --text   # the saved text, read from the server
ht-verify shot --session --out description-after-reload.png
```

Right column on the same ticket (`htpr-8991-right-column` on):
`[data-task-property-label]` has 5 rows (ID, Status, Project, Time, Tags),
an empty due date and size are absent, and `Add field` opens the command
list of the empty fields. `[data-title-container="task-detail"]` had
`border-bottom-width: 0px` before scrolling; scroll the page and re-probe
to see the 1px line.

[HTPR-6281](https://app.hypertask.ai/detail/project-15/6281) needs the
opposite check: it's about the open task **not** picking up a change made
elsewhere while realtime is down. `agent-browser` never gets live push (see
INDEX.md's realtime caveat), so it already runs the polling fallback this bug
is about. Edit the task from a second context or the API while the first
tab has it open, wait for the poll interval, and screenshot the still-open
tab **without reloading**. A reload would fetch fresh from the server and
pass even with the bug present, hiding exactly what broke.

For desktop composer placement, open a ticket with several comments from both
Inbox and its board at 1920x1080 and 1440x900. Scroll to the last comment and
capture it above the Send box, with no overlap or estimated-height gap. Check
empty and one-comment threads, repeat with `htpr-6899-stable-layout` on and off in a disposable local build, and
confirm the separate fixed mobile composer at 390x844 is unchanged.

### Ctrl+O ticket link labels

Open a QA Sandbox task containing absolute and relative ticket links in its
saved description or comments. Wait for the composer, then press Ctrl+O.
Every readable ticket row shows its current ticket ID and title. Search by
title, select the row, and confirm the destination is unchanged. Missing or
unreadable tickets show a URL-derived `PROJECT-<board>-<number>` identifier,
never another board's private title or a raw ticket URL. External links and
attachments keep their labels and destinations. Check after reload and at
1440x900 and 390x844 across Porcelain, Graphite, AMOLED and Dia.

The `htpr-8096-ctrl-o-ticket-titles` bugfix flag defaults to Everyone. Off
preserves the old link labels; test Off only in an isolated route test.

With `htpr-8804-visible-links-first` on (Everyone by default), open Ctrl+O on a ticket
with visible and offscreen saved links, including in an embedded ticket panel.
Visible links come first; both groups retain their previous order. A draft
comment must not promote a matching offscreen saved link. With the flag Off,
all links retain their previous order. The flag defaults to Everyone.

### Background smart labels

Creating a task schedules `scheduleClassifyNewTaskAiLabels`; changing its title
or description schedules `scheduleClassifyTaskAiLabels`. Use only disposable
`[qa-runner]` tasks on QA 985's private QA runner board. Create, edit and reload;
verify saved text and existing labels survive. Save the create/update responses
and label readback. Never change funding, plans or keys to exhaust an allowance.

Smart-label backfills remember completed matching and nonmatching verdicts when
`htpr-7850-label-backfill-skip-unchanged` is on. A repeat skips unchanged inputs
only while label membership still matches the verdict. Changed content, prompt,
or membership remains eligible; unfinished batches are not cached. Off or an
unavailable flag store retains repeat inference. Batch results superseded by a
manual membership or prompt change do not overwrite it; content changes retain
the existing instant refresh.

Verify repeat, changed-input, flag-off, unavailable-store, and batch collection
behavior with `tests/htpr-7850-label-backfill.test.cjs`. For live verification,
use a disposable QA label and tasks; compare label readback and authorized
server-side AI usage records before and after repeated backfills. Do not assume
a public usage API exists. Record live coverage as UNREACHABLE if backfill
triggering or usage records are unavailable.

With `htpr-8099-smart-label-refusal` on, typed daily/monthly allowance refusals
skip classification without clearing labels or raising server-error alerts.
Real provider faults still report. Exercise direct and wrapped refusals, funding
lookup failure, success, Off and unavailable flag-store cases through the
scheduled dispatch in `tests/htpr-8099-smart-label-refusal.test.cjs`. Record live
refusal coverage as UNREACHABLE unless a QA team is already exhausted; local
fixtures do not replace live proof. Read production task-route logs after the
live create/edit to confirm their background jobs did not emit allowance errors.

### Batch 3 proof

Screenshot `/time` empty, then after one added entry, one running timer,
and one CSV export. Press Stop on that timer, then delete the manual entry
and the stopped entry from the time log before leaving.

Runners never switch a flag Off. Read the live mode and leave it.
Screenshot the on state on a disposable QA task only when that account
already has the flag. Reload the ticket after a description, summary, image,
or scroll check.

When the live mode is Owner + QA, screenshot the off state with a plain
account that is not an owner and not QA. When the live mode is Everyone,
live off is UNREACHABLE and the test named in that flag's drive step is the
off proof. When the live mode is already Off, that screen is the off proof
and the on state is unreached. A flag with no named test uses this same rule.

Do not start a Stripe checkout and do not change a live team's plan to
prove `htpr-7848-summary-on-view`. Do not open a stale ticket to force a
summary, and do not spend an AI allowance on a summary or a smart label.
Delete disposable tasks, drafts, chat sessions, and time entries in the
product UI. Stop any timer this run started before deleting it.

### Cleanup

If you created a test task, hard-delete it via the product UI. Never leave a
task you created (the smoke prefix is `QA_TASK_PREFIX` in
`e2e/smoke/lib/boardSetup.ts`) past the run.

### Description AI draft review

With `htpr-8173-description-inline-drafts` on, open a disposable task's
**Edit with AI** button. Also check Ctrl+J / Cmd+J from the focused description
and targeted description AI events. The existing inline writer opens without
requesting a draft automatically. Submit only when authorized, review multiple
versions, apply one, save, and reload to confirm the chosen description persists.
Check mobile and desktop, empty descriptions, and existing comments. Confirm
comment AI and New Task compose retain their own behavior. With the flag off,
confirm the previous sidebar routing in an isolated test. Delete disposable QA
tasks and drafts after verification. Never use Valentin's browser or login.
