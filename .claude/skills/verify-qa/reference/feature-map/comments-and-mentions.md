# Comments and mentions

## Sub-features

- `local-writing-corrections` Local writing corrections.
- `comment-dictation-shortcuts` Comment dictation shortcuts.
- `durable-agent-attribution` Durable agent attribution.
- `retired-image-generation` Retired image generation.
- `agent-writing-rules` Agent writing rules.
- `idle-comment-mic` With `htpr-6555-idle-comment-mic` on, the closed phone comment bar shows a microphone beside "Add a comment…". One tap starts dictation before the editor opens. The spoken text then opens the editor and is inserted. A tap on the placeholder while that recording runs does not open the editor. Desktop keeps "Tip: Hit CTRL+M to comment" and shows no idle microphone.
- `blocker-comment` With `htpr-7724-blocker-comment` on, the comment commands include "Mark as blocker", or "Unmark as blocker" when that comment is already the blocker. The marked comment gets a red outline. An activity row cannot be the blocker. The write sends `blockerCommentId` to `POST /api/tasks/waiting-on`, and the comment must be on that task. Off hides the command and answers that blocker comments are not enabled.
- `comment-summary-reuse` With `htpr-7858-comment-summary-reuse` on, a stored comment TL;DR is reused when the comment text still matches the hash saved with it, so the model is not called again. A changed comment is summarized again. An activity row, or a comment under 120 words, stores no TL;DR. Off summarizes again on every job.
- `agent-lane-collapse` With `htpr-8262-agent-lane-collapse` on, Shift+O collapses the agent lane together with the comments. A collapsed lane row is one line: icon, agent name when shown, text, and time. An open lane row uses the comment card. Enter or Space on a lane row toggles that row. Off leaves lane rows expanded. Shift+O still stacks comments, and one comment stays open.
- `mention-by-name` With `htpr-8268-mention-by-name` on, an agent can pass a name or a user id in `mentions` on `POST /api/mcp/comments`. The name is matched to members of that board. An unknown name is refused, and the reply includes close matches when it has any. A name that matches more than one member is refused the same way, and nothing is saved. Off still accepts `{ user_id, display_name }` and refuses a bare name.
- `comment-mic-pattern` With `htpr-8926-comment-mic-pattern` on, the desktop comment box and the description editor use a white microphone and hide the microphone picker. A comment ends in a plain text Send. While dictating, that microphone is replaced by a compact pill with a stop square and the elapsed time. Off restores the previous microphone, Send row, and recording controls.
- `one-send-inbox` With `htpr-8962-one-send-clears-inbox` on, the desktop comment box has one Send on the right. Ctrl+Enter sends (Cmd+Enter on Apple). When the task is in your inbox, the tooltip says "Send and remove from inbox", and Send archives your inbox entry. The task stays on the board. A draft's discard control is a trash icon on the far left. Off restores the extra Send actions, including Ctrl+Shift+Enter for an inbox task.
- `person-hover-card` With `htpr-8964-remove-person-hover` on, hovering a comment author, a description author, or a person or agent mention does not open the person card. Keyboard focus, and a tap that is not a mouse hover, can still open it. Escape still closes it. Off opens the card on mouse hover again.

## How to get to it (user POV)

The comment box at the bottom of a task detail view. `@` opens the mention
picker.

The idle microphone is on that closed bar on a phone. Mark as blocker is in
the comment command list. The TL;DR job runs for a comment of at least 120
words. Shift+O is on the ticket thread when no text field is focused. An
agent names a person from `POST /api/mcp/comments`. The white microphone,
the text Send, and the single Send are on the desktop comment box. The white
microphone is also on the description editor. The person card is on a
comment or description author, and on a mention in the thread.

## Driving it with agent-browser

**Production, QA 985 (verified 2026-11-20).** Create a throwaway task on board
7049, then drive the real composer:

```bash
H=.claude/skills/verify-hypertask/bin/ht-verify
S=~/.config/hypertask-videos/storageState-qa.json
$H api POST /api/tasks/create --state $S --confirm --data '{"title":"[qa-9515] comments probe","projectId":7049,"sectionId":19409,"userId":985}'
$H session start --base https://app.hypertask.ai --viewport 1440x900
$H open /detail/project-7049/<uniqueIndex>
$H click '#comment-input'
$H fill '#comment-input .ProseMirror[contenteditable="true"]' 'qa probe note'
```

Send with Ctrl+Enter (Cmd+Enter on Apple). Require `POST /api/comments/create`
200, the text visible outside the composer, and
`[data-testid="ticket-comment"]` count increased. Reload and require the same
comment, same formatting. For a mention type `@` and require `.mention_container`
to open with a People and an Agents group; a saved mention renders
`a[data-type="mention"]` or `span[data-type="mention"]`.

Clean up through the product APIs and
`.claude/skills/verify-qa/scripts/fixture-cleanup <state> <taskId>`:

```bash
$H api GET '/api/comments/getByTask?taskId=<id>' --state $S
$H api POST /api/comments/deleteCommentById --state $S --confirm --data '{"id":<commentId>}'
$H api GET '/api/comments/getByTask?taskId=<id>' --state $S   # marker absent
```

**Hands-free drive (loopback only):**
`node .claude/skills/verify-qa/scripts/comments-drive-live.mjs <folder> --base http://127.0.0.1:3100 --state <storageState.json>`
Posts, reloads and deletes a comment, using `#comment-input`,
`#comment-input .ProseMirror[contenteditable='true']`,
`[data-testid="ticket-comment"]`, `POST /api/comments/create` and
`POST /api/comments/deleteCommentById`. Prints PASS/FAIL per step and
`comments ok`. `--break post` must print `negative control ok`. Run hosted with
`scripts/verify-qa <branch> hands-free-drives`.

With `htpr-6555-idle-comment-mic` on, tap the microphone on the
closed comment bar and confirm dictation starts before the editor is open.
On desktop, confirm that bar has no microphone. The phone idle mic and the
desktop composer mic share the id `create-comment-audio-button`, so prove
absence with the phone placeholder (`_mbl`) or by viewport, never by id alone.

With `htpr-7724-blocker-comment` on, mark one real comment, reload, and
confirm the red outline. Unmark it. An activity row has no blocker command.

With `htpr-7858-comment-summary-reuse` on, run the summary job twice on an
unchanged comment of at least 120 words. The second run returns the stored
TL;DR. Edit the comment and confirm the next run does not return the old one.

With `htpr-8262-agent-lane-collapse` on, press Shift+O with no field focused.
Collapsed lane rows are one line. Shift+O again opens them as comment cards.
Enter or Space on one row toggles that row only.

With `htpr-8268-mention-by-name` on, post a mention that names one board
member, then one unknown name, then one ambiguous name. Only the unique
member is saved. Off, a bare name is refused and `{ user_id, display_name }`
still works.

With `htpr-8926-comment-mic-pattern` on, confirm the white microphone and
text Send on the desktop comment box, and the white microphone on the
description. Start dictation and confirm the compact pill. With
`htpr-8962-one-send-clears-inbox` on, confirm one Send. On an inbox task,
Send archives that inbox entry and leaves the task on the board. A blank
comment is refused.

With `htpr-8964-remove-person-hover` on, hover a comment author and a
mention. The person card stays closed. Focus the name, or tap it without a
mouse hover, and the card can open. Escape closes it.


## Gotchas

- Edit control ordering on your own comment ([HTPR-6514](https://app.hypertask.ai/detail/project-15/6514), "keep Edit first on
  your own comment").
- Attachment styling regressions: border mismatch against the comment card
  ([HTPR-6474](https://app.hypertask.ai/detail/project-15/6474), two rounds, `#684` and `#675`), selected-attachment background
  ([HTPR-6552](https://app.hypertask.ai/detail/project-15/6552)), light-theme comment separation ([HTPR-6554](https://app.hypertask.ai/detail/project-15/6554)).
- Direct task closing after posting a comment when it should stay open
  ([HTPR-6559](https://app.hypertask.ai/detail/project-15/6559)).

### What proof to collect

Screenshot the comment thread after posting, showing the new comment and any
attachment rendered correctly (border, background, light and dark theme if
the ticket is theme-related). Reload the task and confirm the comment
persisted with the same formatting.

### Automated evidence

`node --test tests/comment-attachment-background.test.cjs` checks comment attachment surface, border and theme-token source rules; screenshots still prove the rendered appearance.
`node --test tests/linkable-mention.test.cjs` round-trips task and page mentions as links and person mentions as spans in the rich-text extension; it does not drive the picker or save a comment.

### Cleanup

`comments-drive-live.mjs` deletes the comment it posted, then deletes the
sandbox task. A comment you posted outside that script still needs deleting
on the account's own board.

`htpr-8262-agent-lane-collapse` and `htpr-8964-remove-person-hover` are on
for Owner + QA unless the flag record says otherwise. Confirm the account
before expecting the new behavior. Do not switch a production flag. A
learn-tutorial task can keep its inbox row when Send would otherwise archive
it. Screenshot the idle microphone, the red blocker outline, the white
microphone, the single Send, and the closed hover card. For the TL;DR and
the name mention, save the response body and do not call a paid model beyond
the one summary the check needs. Delete only comments this check posted.
Unmark the blocker. Undo the inbox archive. Leave other comments, mentions,
and inbox rows alone.

### Local writing corrections

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

### Comment dictation shortcuts

On a long QA Sandbox ticket, scroll to the top and blur any text field.
Press Ctrl+Shift+D (Cmd+Shift+D on macOS): the existing comment box and
recording Cancel/Send controls must enter the viewport. Cancel with Escape;
the draft must remain unchanged. Repeat with Ctrl+Shift+F for dictation with
improvement. Starting from another focused text field must not move the page
or start the comment recorder. Repeat after reload. Mobile keeps its existing
fixed comment composer and microphone behavior.

For `htpr-8139-comment-dictation-scroll` Off, starting the recorder keeps the
previous scroll position. Do not switch a production flag to test this;
exercise flag Off with the component test instead.

Targeted regression: `npm run test:file -- tests/htpr-8139-comment-dictation-scroll.test.cjs`.

### Durable agent attribution

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

### Retired image generation

With `htpr-7859-remove-image-generation` enabled, Settings > Team > Default
models and AI features have no Image generation row. Ctrl+K has no image
feature shortcut, and image model names no longer appear in ticket mention
search. Ordinary people, agents and language-model mentions remain available.
An authenticated POST to `/api/ai/generate-image` returns HTTP 404 before
provider access or attachment/comment writes, including for stale saved image
mentions. Existing uploaded images still render after reloading a ticket.

Use QA 985 and an existing QA Sandbox image attachment. Capture the settings
rows and attachment on desktop and phone in Porcelain, Graphite, AMOLED and
Dia. Never generate an image or run a paid provider solely for verification.
Do not switch production flags for the rollback check: hosted route-entry
tests prove flag Off restores creation and its attachment/comment writes,
while the removal path performs none. Record absent attachment fixtures as
UNREACHABLE rather than claiming rendering proof.

### Agent writing rules

Agent comments need `kind: question`, `qa` or `done` to appear in the
people thread. An agent POST without `kind` answers 2xx with
`routedTo: "log"`, `visibleToPeople: false` and a notice saying it went to
the agent log, so automatic agent notes are never refused and never lost.
The text is stored as an activity on a runtime agent run, the same store
`hypertask activity add` writes, including mentions and replies. A note the
log cannot take is never published silently: a post with no text the log can
hold answers 400, an agent outside the board answers 403 naming board access,
and only a log that fails while opening answers 503 with a retry. File
uploads require an explicit kind before writing, so a rejected note cannot
lose its files. Human writes remain unrestricted.

Use an authorized agent's `POST /api/mcp/comments` with `dry_run: true`
on a readable fixture. A long typed sentence, status line or file path must
return 400 naming `text`; a short typed summary must remain valid. Untyped
technical text must report `would.routedTo: log`, including a person mention
or reply target. Read the real comment list after posting a hidden note and
confirm its unique marker is absent. Reload the thread and confirm the
short typed summary remains. A people comment edit is refused when any line
breaks a rule, including a line that was already stored. An agent run reply
on the ticket is checked the same way. Agent task create/update must also
reject long new titles and descriptions before any mutation. A task
description edit may still keep lines that were already there, while new
lines are checked. Repeat with a human QA credential: the same long text
must remain valid. Delete only the temporary QA fixtures.

Targeted regression: `npm run test:file -- tests/yper4-910-agent-writing.test.cjs tests/htpr-8889-comment-writing.test.cjs tests/mcp-comments-agent-chatter-routing.test.cjs tests/htpr-7512-comment-attachments-routing.test.cjs`.
