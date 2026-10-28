# AI chat

## How a customer reaches it

The AI chat panel on a board or task (native chat, `src/app/api/ai/`), and
the mobile Agent Chat surface. Non-demo chat uses `/api/ai/chat/stream`
without a native-chat flag; demo chat uses `/api/demo/chat/stream`.

## How to drive it

Use `agent-browser` headless for the request/reply check. On production,
webdriver or a HeadlessChrome/PhantomJS user agent disables realtime before
`?realtime=on` is considered. That override works earlier only on localhost
or 127.0.0.1; an agent marker still disables it. Verify production realtime
separately in a non-automated QA browser session. Send a message, wait for a reply,
and check which model actually answered if the ticket names one (the model
picker sends a stable `modelOptionId`; see
`src/lib/aiModelOptions.ts` for the current option list).

Ctrl+J new ticket ([HTPR-7317](https://app.hypertask.ai/detail/project-15/7317)):
press Ctrl+J on a board, type a note, create. The ticket opens with the
sidebar intro "I created X from your note. Want me to refine it?" and, under
"Questions and ideas for this ticket", suggestions from
`POST /api/ai/task-questions` with `kind: "new-ticket"`
(`[data-compose-question]`). The usual prompt asks for 2 to 4 chips. With
`htpr-7534-writing-questions` enabled, suggestions address writing and format
only and may validly be fewer or absent when no specific improvement is justified.
Record the effective flag and response. If chips are returned, wait for them
(about 10 s), click one and check it is sent and answered in the same chat.

## Ticket-first creation

With `htpr-7758-progressive-chat-create`, request one ticket on QA Sandbox.
The saved title-only ticket link appears before its description finishes.
Open that link while writing continues. The completed writer title, body,
priority and size must arrive without reloading. Reload both chat and ticket;
the link and completed content must remain. Ordinary chat must not navigate.
If writing fails, keep the saved ticket and show the unfinished-body notice;
never retry by creating another ticket. Saved title or description edits,
archive and cross-board moves must prevent the background replacement.
Record desktop and phone send-to-visible-link timings separately from
body completion, with sample counts and errors. Keep Task Writer inputs,
models, prompts and output unchanged; prepare context before publishing so
the new ticket cannot become its own duplicate-search result.

## Floating chat outline

Open chat from a task, use the overflow menu's **Toggle Floating View**, then
navigate to Inbox and reopen chat if navigation closed it. In AMOLED the
floating window has a quiet 1px outline and 5px corners, including the outer
phone sheet. Capture 1440x900 and 390x844 over the inbox. Compare the window
size with the outline disabled; it must not change. Porcelain, Graphite and
Dia keep their existing outlines and corners. The rollback flag is
`htpr-8042-amoled-chat-border`.

## Unsent message drafts

In both the docked sidebar and `/chat`, type while a reply streams.
Finish, fail or stop that reply: the unsent text must remain.
Queue a follow-up, then type another unsent message; draining the queue
must not clear it. Retry an older message without sending the new draft.
Switch from chat A to B, write different text, then return to A and reload:
each chat restores its own rich-text draft in the same browser tab.
Sending or explicitly clearing a draft must not restore it on reload.
Opening a different account must not expose the previous account's draft.
Capture the typed text before and after, alongside queued-message delivery.

## Retiring a model version

A saved pick, a team feature override or a stored agent pin keeps an old
model id after that version leaves the catalogue, so the retirement is proven
from the saved value, not from a fresh pick.

1. As QA 985, save the old id:
   `POST /api/users/preferences` with `{"aiModelPreferences":{"aiChat":"<old id>"}}`.
   `success: true` means the retired id stayed readable.
2. `POST /api/app-shell/bootstrap` still returns that saved string, so the
   migration happens on read, not by rewriting stored data.
3. Open the AI chat on the account's board: the picker shows the replacement
   model only, and the old label is gone. Settings > AI default models and the
   Android composer (`POST /api/android/ai/composer`) list the same set.
4. Send a message and record the `modelOptionId` in the `POST
   /api/ai/chat/stream` body: it must be the replacement id, and the reply must
   arrive from that model, not a fallback.
5. Put the account's saved pick back to the replacement id.

The Haiku 4.5 retirement ([HTPR-7940](https://app.hypertask.ai/detail/project-15/7940))
was proven this way: a saved `claude-haiku-4.5` chat pick loaded Haiku 5.5 and
the chat request carried `claude-haiku-5-5`.

## On-demand tool discovery

With `htpr-7862-chat-deferred-tools` enabled, common ticket and inbox
operations stay immediately available. Ask for a read-only saved-view lookup
on QA 985's own private board. Record the existing view tool's stream
status and compare the answer's view identifiers with the board's saved views.
Follow with a common task lookup and verify its result against the board.
The stream does not expose discovery calls separately. Use
`tests/ai-chat-deferred-tools.test.cjs` for provider-request evidence that
`hypertask_search_tools` finds `hypertask_list_views`, describing it activates
its schema, and the following step executes the original tool. Those tests
also verify per-conversation isolation and the full original flag-off catalog.
Do not request writes, token minting or revocation for this check.

## What usually breaks

- Provider/gateway slug drift breaking a specific model entirely: Grok chat
  moved between the `xai` and `spacexai` gateway slugs three times in one
  week ([HTPR-6349](https://app.hypertask.ai/detail/project-15/6349), [HTPR-6414](https://app.hypertask.ai/detail/project-15/6414), [HTPR-6415](https://app.hypertask.ai/detail/project-15/6415)), then Grok was pulled from
  chat until needed ([HTPR-6349](https://app.hypertask.ai/detail/project-15/6349) again).
- Token usage blowing up ([HTPR-6507](https://app.hypertask.ai/detail/project-15/6507), "reduce AI chat token usage").
- Chat replies not attaching to the right message after a webhook round-trip
  ([HTPR-6553](https://app.hypertask.ai/detail/project-15/6553), two rounds).
- Failed webhook chats not falling back to polling ([HTPR-6566](https://app.hypertask.ai/detail/project-15/6566), reverted
  once, watch for a recurrence).
- Mobile Agent Chat chrome showing on the wrong path, or the wrong composer
  rendering ([HTPR-6476](https://app.hypertask.ai/detail/project-15/6476), two rounds).
- Ctrl+J chips vanishing once the intro reloads from the server under a new
  id ([HTPR-7317](https://app.hypertask.ai/detail/project-15/7317)): wait a
  few seconds after they appear and check they are still there.

## What proof to collect

For code readability (https://app.hypertask.ai/detail/project-15/7782), request
shell, JSON and SQL fenced blocks plus inline code and a long unbroken line.
Check readable text, monospace, horizontal block scrolling and Copy response
in the docked sidebar, `/chat`, and phone view at 390x844. Capture Porcelain,
Graphite, AMOLED and Dia, plus Follow system with light and dark device modes.

Screenshot the sent message and the received reply together, with the model
name visible if the UI shows it. If the ticket is about a specific
model/provider, don't accept a reply from a silently-substituted fallback
model as a pass.

## Cleanup

Use only the QA account's own private board and record created ticket ids and the
baseline of any ticket the chat may edit. Delete this run's Ctrl+J tickets
and any other tickets it created, and restore edits to pre-existing QA fixtures.
Chat edits can send notifications, which cleanup cannot undo.
Deleting a chat session removes its chat data and attachments, not created
tickets or ticket edits. Delete only the test conversation/thread if cleanup
is needed, never the account's entire chat history.

## Independent parallel chats

With `htpr-7765-parallel-chats` enabled, open a long reply in chat A,
queue two follow-ups there, then switch to chats B and C and send in each.
B and C must start before A finishes. Return to each chat: its own Stop
and queue remain intact. A's follow-ups drain in order even while B or C
is selected, using A's prior replies as history. Stop A while B runs;
B must retain its Stop control and finish normally. Repeat with one failed
reply. A late reply acceptance must not clear a new attachment in B.
Capture overlapping request times, session/message IDs, final replies,
and a reload proving each reply stayed in its own transcript. Flag off
retains the prior shared reply guard. Per-user request limits still apply.

## Opening while chat starts

With `htpr-8038-chat-opener-ready` enabled, delay application JavaScript
and inspect the existing desktop Open and phone AI buttons. They must be
disabled and busy before their handlers attach, without moving. Release
JavaScript; the first accepted click must open chat and its scope picker.
A known Off flag preserves the legacy server button. Unknown flag state
uses the safe loading state until the handler attaches.
If startup adds `view=default` to the same board URL after Open, chat must
stay open, including when automatic board opening is off. A different board
or a genuinely different view retains its existing automatic-opening policy.

With `htpr-8030-chat-open-race` enabled, load a board with chat closed,
wait for `[data-ai-chat-ready="true"]`, then select **Open AI chat** once.
Server-rendered buttons exist before their client handlers attach; board
columns and `data-board-tasks-hydrated` alone do not prove interaction readiness.
The sidebar and its board-scope picker must stay visible even when the chat runtime is still publishing state.
Opening again must not close a chat already requested open. The existing
**Close AI chat** button must still close it. Capture the first opening
and use the unchanged `[data-ai-chat-scope]:visible > button` scope control.

## Remembered sidebar width

With `htpr-8013-sidebar-width` enabled, use QA 985's existing sidebar resize
handle on a desktop board. Drag to a new width, close and reopen, then reload
and open a ticket or another board. Each opening must retain the dragged width.
Shrink the window until the sidebar hits its existing 85% viewport limit, then
expand it again: the original dragged width must return. Temporary viewport
clamping must not replace the preference. A second account starts at 420px and
keeps its own drags. Phone chat remains full-width. The flag-off path retains
the previous shared width and viewport clamping behavior.

## Automatic heartbeat step budget

Native agent heartbeat turns enter through `/api/cron/native-agent-heartbeat`,
which reserves an execution and calls `/api/ai/chat/stream` with authenticated
heartbeat headers. With `htpr-7857-heartbeat-step-cap` enabled, the shared
model-reply dispatch permits four completed AI steps in total, including an
empty-response retry. User-requested agent chats and flag-off heartbeat turns
retain 32 steps. Tools and permissions are unchanged.

Run the real-SDK dispatch cases in `tests/ai-chat-deferred-tools.test.cjs`:
four heartbeat steps, 32 user-requested steps, 32 flag-off steps, and one empty
stream step plus three retry steps. Preserve the heartbeat durability tests.
After deploy, check the flag mode and exercise a normal QA chat. Never invoke
the global cron merely for testing: it wakes other owners' agents. If no
isolated heartbeat trigger and execution-step telemetry are available through
approved product surfaces, record the live four-step case as UNREACHABLE;
do not substitute mocked SDK results for a live heartbeat.
