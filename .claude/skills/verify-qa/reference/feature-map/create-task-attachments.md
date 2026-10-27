# Create task attachments

## How a customer reaches it

On a board, Ctrl+K then **Create task** (or `C`) opens the create window (`src/components/RTE/TiptapCreateTaskModal.tsx`). The paperclip (`#create-task-modal-attachmentUpload`) or a file drop attaches files. Save, Save & close or Save & new creates the task at once while files keep uploading in the background (HTPR-5993, flag removed in HTPR-7359), then each file is linked to the new task.

## How to drive it

1. Open a board, Ctrl+K, type `create task`, pick **Create task**, fill the title.
2. Attach a file of a few MB with the paperclip (Playwright: wait for `filechooser`, then click the paperclip; `setInputFiles` on the first `input[type=file]` hits another uploader).
3. Press **Save & close**. Expect the toast `Task saved. 1 file uploading` (a small file can finish first and show `Successfully created the task`).
4. Watch the requests: `POST /api/tasks/uploadUrl` with purpose `task-attachment-link`, `POST /api/tasks/uploadFinalize`, `POST /api/tasks/createGlobally`, then `POST /api/tasks/uploadFinalize` with action `link-task-attachment`. All must be 200.
5. Open the new task and reload: the file shows on the task.

## What usually breaks

- The link call refused (403) or never sent, so the task saves without its file.
- A pending upload lost when the window closes or Save & new resets it.
- Late callbacks from the previous ticket attaching to the next one after Save & new.

## What proof to collect

Checklist written before QA; screenshots after attaching, of the toast, and of the task after reload (desktop 1440x900 and phone 390x844); the request list with statuses; a short video. Record account ids, never credentials.

## Cleanup

Archive the QA task created for the run.

## Mobile dictated Task Writer save

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
