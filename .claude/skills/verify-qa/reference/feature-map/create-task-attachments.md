# Create task attachments

## Sub-features

- `mobile-dictated-task-writer-save` Mobile dictated Task Writer save.
- `new-task-keyboard-handoff` New Task keyboard handoff.
- `free-file-25mb` With `htpr-7924-free-file-25mb` on, and `htpr-7686-free-plan-limits` on, a Free scope may attach a file up to 25 MB. `POST /api/tasks/uploadFinalize` refuses a larger file with HTTP 402, code `PLAN_LIMIT_REACHED`, and `Files on the Free plan can be up to 25 MB. Upgrade to upload bigger files.` Off, that ceiling stays 10 MB. A file of 10 MB or smaller skips this check. A paid scope is not refused here. Plans copy says `Up to 25 MB each on tickets and comments` when the flag is on. Default mode is Owner + QA.
- `free-storage-2gb` With `htpr-7924-free-storage-2gb` on, and `htpr-7686-free-plan-limits` on, a Free scope that would pass 2 GB of stored attachments is refused by the same finalize call with HTTP 402, code `PLAN_LIMIT_REACHED`, and `Your team has used its 2 GB of free storage. Upgrade to Pro to upload more.` Off, this cap does not run. A paid scope is not refused. Plans copy adds `Up to 2 GB attachment storage per team` when the flag is on. Default mode is Owner + QA.

## How to get to it (user POV)

On a board, Ctrl+K then **Create task** (the row is `Create task` with chip
`C`; plain `c` on a full board opens nothing useful). The window is
`TiptapCreateTaskModal.tsx`. The paperclip
(`#create-task-modal-attachmentUpload`) or a file drop attaches files. The
visible `Save` control is the primary button; `Save & close` and `Save & new`
are options under it (they render as `span` rows, not buttons). Saving waits for
pending uploads before creating, then each file is linked to the new task.

## Driving it with agent-browser

Verified on production 2026-11-20 with QA 985 and a 600 KB file:

1. `ht-verify session start --base https://app.hypertask.ai --viewport 1440x900`
   then `ht-verify open /project?id=7049&surface=board --full`.
2. Ctrl+K, then `ht-verify fill '#htc-search' 'create task'`, then click the row
   whose text starts `Create task` (not `Create subtask`).
3. Fill `#title-input-modal` with `[qa-9515] attach probe <ts>`.
4. `page.setInputFiles('#create-task-modal-attachmentUpload', '<file>')`. The
   hidden input works directly; a `filechooser` wait is not needed.
5. Click the visible `span` with exact text `Save`. For Save & close / Save &
   new, click those spans instead; there is no standalone button with that name.
6. Require this request chain, all 200: `POST /api/tasks/uploadUrl` with purpose
   `task-attachment-link`, `POST /api/tasks/uploadFinalize`,
   `POST /api/tasks/createGlobally`, then `POST /api/tasks/uploadFinalize` with
   action `link-task-attachment`.
7. The toast reads `Task saved. 1 file uploading`; the detail page opens and the
   file shows in the description. Reload and require the file still there.
8. Clean up with `node .claude/skills/verify-qa/scripts/fixture-cleanup <state>
   <taskId>` and zero the probe title on the board.
9. Plan limits (Free scope, QA 985): the 25 MB / 2 GB refusals arrive on
   `link-task-attachment` (or on create-time link verification), not on the
   plain finalize call. A finalize-only 402 expectation is wrong; watch the
   link request and require 402 `PLAN_LIMIT_REACHED` with the 25 MB or 2 GB
   sentence. `uploadFinalize` returns 413 only above the 500 MB direct-upload
   ceiling.

## Gotchas

- The link call refused (403/402) or never sent, so the task saves without its file.
- A pending upload lost when the window closes or Save & new resets it.
- Late callbacks from the previous ticket attaching to the next one after Save & new.
- Both Free attachment flags do nothing until `htpr-7686-free-plan-limits` is on. A file of 10 MB or less never consults `htpr-7924-free-file-25mb`. The storage flag off means no 2 GB cap, not a lower cap. A refused finalize deletes the staged object.
- A 402 on the link call is swallowed by `runLink`; no 25 MB sentence reaches the user on that path. Prove the refusal from the response, not the toast.
- The toast counts registered upload jobs; it says `1 file uploading` even after a small file finished, so the string is not a speed signal.

### What proof to collect

Checklist written before QA; screenshots after attaching, of the toast, and of the task after reload (desktop 1440x900 and phone 390x844); the request list with statuses; a short video. Record account ids, never credentials.

### Cleanup

Archive the QA task created for the run.

### Mobile dictated Task Writer save

For https://app.hypertask.ai/detail/project-15/8028, use the mobile add button
or `/new?board=<QA board>`. Put a completed speech transcript into the real
description editor, then press **Save with task writer**. The ticket flag
`htpr-8028-mobile-writer-save` keeps the existing phone writer and its source
form together; the empty command-center writer must not replace the draft.
Require a saved task containing the transcript after reload. Repeat with a
503, blocked writer, and empty writer response: the guarded raw Save must
keep the original description, attachments, board and form properties.
A persistence failure must leave the draft available, without retry loops
or duplicate tasks. Test iPhone and Android sizes with a reduced visual
viewport, all four themes, desktop unchanged, and flag-off behavior. A
transcript injected at the speech-output boundary does not prove microphone
hardware or speech-service accuracy; name that limitation. Archive only the
QA tasks created by the run.

Also submit fresh dictation inside the phone writer, including literal angle
brackets and line breaks. A failed or empty manual response must retain those
new words in the saved description, or in the draft if persistence fails.
Hold a form attachment upload until after fallback starts; release it and
require the saved task to contain the completed file after reload.

### New Task keyboard handoff

On `/new?board=<QA board>`, enter a title and description without AI
mentions, then press Ctrl+J (Cmd+J on Mac). Require exactly one task save,
the saved task detail URL, and its AI sidebar. Reload and confirm the same
title and description. Repeat on phone and with the board's C modal; the
modal must close without leaving a temporary Back entry. Do not send an AI
message for this navigation check. The ticket switch
`htpr-8172-new-task-ai-navigation` preserves this handoff on the standalone
New Task page; switch-off retains the previous board redirect there.
