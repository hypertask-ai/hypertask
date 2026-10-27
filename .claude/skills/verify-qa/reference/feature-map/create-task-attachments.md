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
