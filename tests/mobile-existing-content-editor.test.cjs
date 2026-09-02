const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const tiptap = read("src/components/RTE/TipTapTaskDetail.tsx");
const shell = read("src/components/RTE/Components/TiptapMainContainer.tsx");
const actions = read("src/components/Common/AttachmentsUpload/index.tsx");
const ai = read("src/components/RTE/Components/InlineDraftAiFloat.tsx");
const save = read(
  "src/hooks/Task Detail/CommentAndDescriptionHooks/useSaveContent.ts",
);
const upload = read(
  "src/components/PageComponents/TaskDetail/CommentAndDescription/UploadingDescription/index.tsx",
);
const commentService = read(
  "src/utils/controllers/comments/updateCommentService.ts",
);
const commentRoute = read("src/pages/api/comments/updateComment.ts");
const descriptionContainer = read(
  "src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/index.tsx",
);
const commentsContainer = read(
  "src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/CommentsContainer.tsx",
);
const commentText = read(
  "src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/CommentText.tsx",
);
const taskDetailState = read(
  "src/hooks/Task Detail/useTaskDetailGlobalStates.ts",
);

function sliceBetween(source, start, end) {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.ok(startAt >= 0, `missing start marker: ${start}`);
  assert.ok(endAt > startAt, `missing end marker: ${end}`);
  return source.slice(startAt, endAt);
}

test("description and owned-comment double taps retain their existing entry points", () => {
  assert.match(descriptionContainer, /useDoubleTap\(handleDoubleTap, 200/);
  assert.match(descriptionContainer, /setEditMode\("description"\)/);
  assert.match(commentsContainer, /useDoubleTap\(handleDoubleTap, 200/);
  assert.match(commentsContainer, /editCommentHandler\(i\)/);
  assert.match(commentsContainer, /comment\.attachments && editState !== i/);
  assert.match(commentText, /carouselAttachments=\{comment\.attachments\}[\s\S]*?attachments=\{isMobile && isEditing \? comment\.attachments : undefined\}/);
  assert.match(
    taskDetailState,
    /comments\[currentIndex\]\?\.creatorId === currentUser\.id[\s\S]*?setEditState\(currentIndex\)/,
  );
});

test("mobile existing content opens in a body portal with the approved shell", () => {
  assert.match(tiptap, /mobileExistingEditOpen = Boolean\(isMbl && isReadEditMode && allowEdit\)/);
  assert.match(tiptap, /createPortal\([\s\S]*?data-mobile-existing-content-editor[\s\S]*?document\.body/);
  assert.match(tiptap, /mobileEditViewport\.visibleHeight/);
  assert.match(shell, /"Edit description" : "Edit comment"/);
  assert.match(shell, /"rounded-\[5px\] bg-comment-description"/);
  assert.match(shell, /"rounded-\[8px\] bg-newcomment-well"/);
});

test("the shared bottom row exposes one plus menu and the approved actions", () => {
  const mobileEdit = sliceBetween(
    actions,
    "if (_mbl && mobileExistingEdit)",
    "return (\n    <div",
  );
  assert.match(mobileEdit, /shouldUpload=\{true\}/);
  assert.match(mobileEdit, /callbackAttachments=\{async \([\s\S]*?uploadedAttachments/);
  for (const label of [
    "Attach image",
    "Attach file",
    "Mention someone",
    "Commands",
    "Discard changes",
    "Write with AI",
    "Start dictation",
    "Done editing",
  ]) {
    assert.match(mobileEdit, new RegExp(label));
  }
  assert.match(mobileEdit, /<Plus size=\{20\}/);
  assert.match(mobileEdit, /<PencilSparkles size=\{20\}/);
  assert.match(mobileEdit, /DONE[\s\S]*?<Check size=\{18\}/);
  assert.match(mobileEdit, /bg-white-black/);
  assert.match(mobileEdit, /text-white-black-inverted/);
  assert.doesNotMatch(mobileEdit, />\s*@\s*</);
  assert.doesNotMatch(mobileEdit, />\s*\/\s*</);
});

test("mentions and commands insert into the existing editor", () => {
  assert.match(actions, /insertEditorTrigger\("@"\)/);
  assert.match(actions, /insertEditorTrigger\("\/"\)/);
  assert.match(actions, /editor\?\.chain\(\)\.focus\(\)\.insertContent\(trigger\)\.run\(\)/);
});

test("the pen reveals inline edit AI inside the same well", () => {
  assert.match(shell, /aiOpen \? "Write with AI" : title/);
  assert.match(shell, /presentation="edit-inline"/);
  assert.match(ai, /presentation\?: "inline" \| "composer" \| "refine-fullscreen" \| "edit-inline"/);
  assert.match(ai, /data-mobile-edit-ai/);
  assert.match(ai, /\{inlineEditChips\}[\s\S]*?\{promptRow\}/);
  assert.match(ai, /else if \(isEditInline\) mobileDictationPresentation = "compact"/);
  assert.match(ai, /mobilePresentation=\{mobileDictationPresentation\}/);
});

test("cancel restores the opening text and files without autosaving", () => {
  const cancel = sliceBetween(
    tiptap,
    "const cancelMobileExistingEdit = () =>",
    "function handleCommentEscape",
  );
  assert.match(cancel, /mobileEditSavingRef\.current\) return/);
  assert.match(cancel, /setContent\(snapshot\.html, \{ emitUpdate: false \}\)/);
  assert.match(cancel, /setNewCommentAttachments\(snapshot\.attachments\)/);
  assert.match(cancel, /setEditState\(null\)/);
  assert.match(cancel, /setEditMode\(null\)/);
  assert.match(
    tiptap,
    /if \(!editor \|\| isReadOnlyContent \|\| mobileExistingEditOpen\) return;/,
  );
});

test("DONE is single-flight and only clears local state after a successful save", () => {
  const callback = sliceBetween(
    tiptap,
    "const handleCallback = async",
    "const sendComment = () =>",
  );
  assert.match(callback, /mobileEditSavingRef\.current\) return/);
  assert.match(callback, /mobileEditSavingRef\.current = true/);
  assert.match(callback, /const result = await handleSave/);
  assert.match(callback, /const saved = result !== false;[\s\S]*?if \(!saved\) return false/);
  assert.ok(
    callback.indexOf("if (!saved) return false") <
      callback.indexOf("setNewCommentAttachments([])"),
    "failed saves must retain files and editor content",
  );
  assert.match(callback, /finally \{[\s\S]*?mobileEditSavingRef\.current = false/);
});

test("X, Escape, app Back, and phone Back share silent cancel", () => {
  assert.match(shell, /disabled=\{mobileEditSaving\}[\s\S]*?onClick=\{onCancelMobileEdit\}/);
  assert.match(tiptap, /const handleEscape = \(\) => \{[\s\S]*?cancelMobileExistingEdit\(\)/);
  assert.match(tiptap, /'Escape': handleEscape/);
  assert.match(tiptap, /window\.__htHandleBack = \(\) => \{[\s\S]*?cancelMobileExistingEditRef\.current\(\)/);
  assert.match(tiptap, /armBackDismiss\(window,[\s\S]*?shouldRearm: \(\) => mobileEditSavingRef\.current/);
});

test("late dictation, AI, and upload completion cannot mutate a closed edit", () => {
  assert.match(tiptap, /!mobileEditSessionActiveRef\.current\) return/);
  assert.match(tiptap, /cancelAnimationFrame\(focusFrame\)/);
  assert.match(tiptap, /mobileEditSessionActiveRef\.current && !editor\.isDestroyed/);
  assert.match(tiptap, /setShouldShowAITaskWriter\(false\)[\s\S]*?await handleSave/);
  assert.match(ai, /requestIdRef\.current \+= 1/);
  assert.match(actions, /audioTiptapCallback && toggleRecording && !hideComposerDictation/);
  assert.match(actions, /if \(result === false\)[\s\S]*?toast\.error/);
  assert.match(actions, /catch \(error\)[\s\S]*?Could not add attachment/);
  assert.match(actions, /onClick=\{async \(event\)[\s\S]*?Could not save editor content/);
  assert.match(upload, /const hasCompleted = useRef\(false\)/);
  assert.match(upload, /if \(hasCompleted\.current\) return/);
  assert.match(upload, /catch \(error\) \{[\s\S]*?complete\(false\)/);
  assert.match(upload, /onUploadFailed=\{\(\) => \{[\s\S]*?complete\(false\)/);
});

test("description and comment failures leave edit mode open", () => {
  assert.match(save, /if \(saved\) setEditMode\(null\)/);
  assert.match(save, /setEditState\(null\);[\s\S]*?setEditMode\(null\);[\s\S]*?return true/);
  assert.match(save, /return false;[\s\S]*?\};[\s\S]*?\/\/ ---------------------- CREATE COMMENT/);
});

test("comment updates authorize against stored ownership and sync attachments atomically", () => {
  assert.match(tiptap, /mode === "read-edit-comments" && attachments === undefined/);
  assert.match(tiptap, /currentAttachmentFiles\.length === 0[\s\S]*?\? undefined/);
  assert.match(tiptap, /carouselAttachments \?\? \[\]/);
  assert.match(tiptap, /attachments_: attachmentFilesForSave/);
  assert.match(save, /updateCommentHandler\(content, id, attachments_\)/);
  assert.match(save, /const shouldSyncAttachments = attachments !== undefined/);
  assert.match(save, /replaceAttachments: shouldSyncAttachments/);
  assert.match(commentService, /if \(attachments && replaceAttachments\)/);
  assert.match(commentRoute, /replaceAttachments === true && attachments === undefined/);
  assert.match(commentService, /findFirst\(\{[\s\S]*?where: \{ id: commentId, creatorId: userId \}/);
  assert.match(commentService, /if \(!comment\)[\s\S]*?Comment not found or not owned by user/);
  assert.match(commentService, /prisma\.\$transaction\(async \(transaction\)/);
  assert.match(commentService, /attachmentIdsToDelete[\s\S]*?transaction\.attachment\.deleteMany/);
  assert.match(commentService, /new Map\([\s\S]*?attachment\.fileSource/);
  assert.match(commentService, /attachmentsToCreate[\s\S]*?transaction\.attachment\.createMany/);
  assert.match(commentService, /transaction\.comment\.update/);
  assert.match(commentRoute, /creatorId !== userObj\.id/);
  assert.match(commentRoute, /typeof attachment\.fileSize !== "string"/);
  assert.match(commentRoute, /updateCommentService\(\{[\s\S]*?attachments,/);
});
