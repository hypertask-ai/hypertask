const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const taskDetail = fs.readFileSync(
  path.join(root, "src/app/detail/[...slug]/TaskDetailComp.tsx"),
  "utf8",
);
const tiptap = fs.readFileSync(
  path.join(root, "src/components/RTE/TipTapTaskDetail.tsx"),
  "utf8",
);
const taskState = fs.readFileSync(
  path.join(root, "src/hooks/Task Detail/useTaskDetailGlobalStates.ts"),
  "utf8",
);
const saveContent = fs.readFileSync(
  path.join(
    root,
    "src/hooks/Task Detail/CommentAndDescriptionHooks/useSaveContent.ts",
  ),
  "utf8",
);
const tutorialHook = fs.readFileSync(
  path.join(root, "src/hooks/General/useLearnTutorial.ts"),
  "utf8",
);
const dueDateModal = fs.readFileSync(
  path.join(root, "src/components/Modals/DueDate/index.tsx"),
  "utf8",
);
const universalMovement = fs.readFileSync(
  path.join(root, "src/hooks/useUniversalMovement.ts"),
  "utf8",
);
const moveTaskHandler = fs.readFileSync(
  path.join(root, "src/utils/api/global/apiHelpers/moveTaskHandler.ts"),
  "utf8",
);

test("Ctrl+D owns the browser shortcut and enters description edit mode", () => {
  const shortcutStart = taskDetail.indexOf("// [ctrl] + [d]");
  const shortcutEnd = taskDetail.indexOf("// [shift][m]", shortcutStart);
  const shortcut = taskDetail.slice(shortcutStart, shortcutEnd);

  assert.ok(shortcutStart >= 0 && shortcutEnd > shortcutStart);
  assert.match(shortcut, /e\.preventDefault\(\)/);
  assert.match(
    shortcut,
    /setEditMode\(taskDetailConfig\.editModes\.description\)/,
  );
  assert.match(shortcut, /requestDescriptionFocus\(currentTask\.id\)/);
  assert.match(shortcut, /focusOn\("description", false\)/);
});

test("Ctrl+D records a task-scoped focus request that survives editor loading", () => {
  assert.match(taskState, /descriptionFocusRequest/);
  assert.match(taskState, /requestDescriptionFocus/);
  assert.match(taskState, /taskId/);
  assert.match(taskState, /nonce/);
});

test("only a pending Ctrl+D request focuses the editable description", () => {
  assert.match(tiptap, /!descriptionFocusRequest/);
  assert.match(tiptap, /descriptionFocusRequest\.taskId !== currentTask\.id/);
  assert.match(
    tiptap,
    /handledDescriptionFocusNonceRef\.current === descriptionFocusRequest\.nonce/,
  );
  assert.match(tiptap, /!allowEdit/);
  assert.match(tiptap, /mode !== "read-edit-description"/);
  assert.match(tiptap, /!isSelected/);
  assert.match(tiptap, /!editor/);
  assert.match(tiptap, /editor\.isFocused/);
  assert.match(tiptap, /editor\.commands\.focus\("end"\)/);
  assert.match(
    tiptap,
    /handledDescriptionFocusNonceRef\.current = descriptionFocusRequest\.nonce/,
  );
});

test("Ctrl+J opens the AI writer after a mounted description changes mode", () => {
  const syncStart = tiptap.indexOf(
    "// Ctrl/Cmd+J changes the parent edit mode",
  );
  const syncEnd = tiptap.indexOf(
    "}, [mode, shouldTriggerAiTaskWriter]);",
    syncStart,
  );
  const writerSync = tiptap.slice(syncStart, syncEnd);

  assert.ok(syncStart >= 0 && syncEnd > syncStart);
  assert.match(
    writerSync,
    /setShouldShowAITaskWriter\(shouldTriggerAiTaskWriter\)/,
  );
  assert.doesNotMatch(writerSync, /mode === "create-comment"/);
});

test("Ctrl/Cmd+M opens comments on both platforms", () => {
  const shortcutStart = taskDetail.indexOf(
    "// [ctrl] + [m] [comment edit mode]",
  );
  const shortcutEnd = taskDetail.indexOf(
    "// moving task to next/previous column logic",
    shortcutStart,
  );
  const shortcut = taskDetail.slice(shortcutStart, shortcutEnd);

  assert.ok(shortcutStart >= 0 && shortcutEnd > shortcutStart);
  assert.match(shortcut, /e\.keyCode === KeyCodes\.M/);
  assert.match(shortcut, /cmdControl/);
  assert.match(shortcut, /e\.preventDefault\(\)/);
  assert.doesNotMatch(shortcut, /e\.ctrlKey/);
});

test("a successful comment publishes the tutorial completion signal", () => {
  assert.match(saveContent, /LEARN_TUTORIAL_COMMENT_SAVED_EVENT/);
  assert.match(
    saveContent,
    /new CustomEvent\(LEARN_TUTORIAL_COMMENT_SAVED_EVENT/,
  );
  assert.match(saveContent, /composedForTaskId \?\? currentTask\.id/);
});

test("the tutorial comment does not consume its seeded inbox notification", () => {
  const sendCommentStart = tiptap.indexOf("const sendComment =");
  const sendCommentEnd = tiptap.indexOf("const toggleAiTaskWriter", sendCommentStart);
  assert.ok(sendCommentStart >= 0 && sendCommentEnd > sendCommentStart);
  const sendComment = tiptap.slice(sendCommentStart, sendCommentEnd);

  assert.match(sendComment, /shouldPreserveLearnTutorialInboxOnComment/);
  assert.match(sendComment, /!preserveTutorialInbox && inInbox/);
  assert.match(
    sendComment,
    /!preserveTutorialInbox &&\s*\(alwaysAdvance \|\| \(isInboxFlow && inInbox && advanceOnSend\)\)/,
  );
});

test("comment shortcuts use the gated save-then-move path", () => {
  assert.match(
    tiptap,
    /useFlag\(\s*"htpr-5913-consistent-comment-shortcuts",?\s*\)/,
  );

  const shortcutStart = tiptap.indexOf("// Enter key combinations");
  const shortcutEnd = tiptap.indexOf(
    "if (e.altKey && e.keyCode === 86",
    shortcutStart,
  );
  const shortcut = tiptap.slice(shortcutStart, shortcutEnd);

  assert.ok(shortcutStart >= 0 && shortcutEnd > shortcutStart);
  assert.match(shortcut, /resolveCommentEnterShortcutAction\([\s\S]*?consistentCommentShortcuts/);
  assert.match(
    shortcut,
    /if \(enterAction === "ignore"\) return;[\s\S]*?e\.preventDefault\(\)/,
  );
  assert.match(shortcut, /enterAction === "send-and-move"[\s\S]*?sendComment\(true\)/);
  assert.match(
    shortcut,
    /enterAction === "send-and-stay"[\s\S]*?handleCallback\(\)/,
  );
  assert.doesNotMatch(shortcut, /handleCallback\("moveToNext"/);

  const sendCommentStart = tiptap.indexOf("const sendComment =");
  const sendCommentEnd = tiptap.indexOf("const toggleAiTaskWriter", sendCommentStart);
  assert.ok(sendCommentStart >= 0 && sendCommentEnd > sendCommentStart);
  const sendComment = tiptap.slice(sendCommentStart, sendCommentEnd);
  assert.match(sendComment, /alwaysAdvance/);
  assert.match(sendComment, /!preserveTutorialInbox/);
  assert.match(sendComment, /\? "moveToNext"/);
});

test("due-date completion is published only after the save resolves", () => {
  assert.match(dueDateModal, /setDueDateApiHandler[\s\S]*?\.then/);
  assert.match(dueDateModal, /result === undefined/);
  assert.match(dueDateModal, /LEARN_TUTORIAL_DUE_DATE_SAVED_EVENT/);
  assert.match(tutorialHook, /savedTaskId !== tutorialState\.lastTaskId/);
});

test("the tutorial accepts only its task's comment-save signal", () => {
  assert.match(tutorialHook, /savedTaskId !== tutorialState\.lastTaskId/);
});

test("the comment tutorial surface requires focus inside the real editor", () => {
  assert.match(
    tutorialHook,
    /document\.activeElement\?\.closest\("#comment-input"\)/,
  );
  assert.match(
    tutorialHook,
    /addEventListener\("focusin", updateOpenSurfaces\)/,
  );
  const shortcutStart = tutorialHook.indexOf(
    'tutorialState.scene === "comment"',
  );
  const shortcutEnd = tutorialHook.indexOf("return;", shortcutStart);
  assert.match(
    tutorialHook.slice(shortcutStart, shortcutEnd),
    /event\.preventDefault\(\)/,
  );
});

test("tutorial Escape owns editor dismissal and uses the real back control", () => {
  const escapeStart = tutorialHook.indexOf(
    'tutorialState.scene === "escape" && event.key === "Escape"',
  );
  const escapeEnd = tutorialHook.indexOf("return;", escapeStart);
  const escapeHandler = tutorialHook.slice(escapeStart, escapeEnd);

  assert.ok(escapeStart >= 0 && escapeEnd > escapeStart);
  assert.match(escapeHandler, /event\.preventDefault\(\)/);
  assert.match(escapeHandler, /event\.stopImmediatePropagation\(\)/);
  assert.match(escapeHandler, /document\.activeElement/);
  assert.match(escapeHandler, /task-detail-page-back-button/);
  assert.match(escapeHandler, /\.click\(\)/);
});

test("Command Center advances only after focus settles outside the editor", () => {
  assert.match(tutorialHook, /commandHandoffGeneration/);
  assert.match(tutorialHook, /document\.getElementById\("comment"\)/);
  assert.match(tutorialHook, /document\.activeElement === anchor/);
  assert.match(tutorialHook, /new MutationObserver\(focusAndVerify\)/);
  assert.doesNotMatch(tutorialHook, /attempts < 5(?!\d)/);
  assert.match(
    tutorialHook,
    /holdPendingSurface\(\);[\s\S]*?resetShowCommands/,
  );
  assert.match(
    tutorialHook,
    /observeLearnTutorialSurface\([\s\S]*?"command-center"/,
  );
});

test("cancelled tutorial reveals cannot dismiss a later matching surface", () => {
  assert.match(tutorialHook, /pendingSurfaceGeneration\.current \+= 1/);
  assert.match(
    tutorialHook,
    /pendingSurfaceGeneration\.current === expectationGeneration/,
  );
  assert.match(
    tutorialHook,
    /pendingSurfaceGeneration\.current === commandHandoffGeneration/,
  );
});

test("tutorial task pickers close through explicit component state", () => {
  assert.match(tutorialHook, /LEARN_TUTORIAL_DISMISS_TASK_MODAL_EVENT/);
  assert.match(taskDetail, /LEARN_TUTORIAL_DISMISS_TASK_MODAL_EVENT/);
  assert.match(taskDetail, /setShowAssignModal\(false\)/);
  assert.match(taskDetail, /setShowPriorityModal\(false\)/);
});

test("Act 3 movement signals follow successful persistence", () => {
  const horizontalSave = universalMovement.indexOf(
    "await globalAPIHandlers.moveTaskHandler",
  );
  const horizontalSignal = universalMovement.indexOf(
    "publishLearnTutorialTaskMove",
    horizontalSave,
  );
  const horizontalGuard = universalMovement.indexOf(
    "if (persisted)",
    horizontalSave,
  );
  const verticalSave = universalMovement.indexOf(
    "const responses = await Promise.all",
  );
  const verticalGuard = universalMovement.indexOf(
    "responses.every((response) => response.ok)",
    verticalSave,
  );
  const verticalSignal = universalMovement.indexOf(
    "publishLearnTutorialTaskMove",
    verticalGuard,
  );

  assert.ok(horizontalSave >= 0 && horizontalGuard > horizontalSave);
  assert.ok(horizontalSignal > horizontalGuard);
  assert.match(moveTaskHandler, /response\.status >= 200/);
  assert.match(moveTaskHandler, /response\.status < 300/);
  assert.ok(verticalSave >= 0 && verticalGuard > verticalSave);
  assert.ok(verticalSignal > verticalGuard);
});

test("Act 3 accepts only the tutorial task in its rendered destination", () => {
  assert.match(tutorialHook, /getRenderedBoardPosition/);
  assert.match(tutorialHook, /move\.taskId !== tutorialState\.lastTaskId/);
  assert.match(
    tutorialHook,
    /renderedPosition\?\.sectionId === move\.toSectionId/,
  );
  assert.match(tutorialHook, /const expectedVerticalIndex/);
  assert.match(
    tutorialHook,
    /renderedPosition\.index === expectedVerticalIndex/,
  );
  assert.match(tutorialHook, /attempts < 200/);
  assert.match(
    tutorialHook,
    /else \{\s*clearPendingBoardMove\(\);\s*document\.getElementById/,
  );
  assert.match(tutorialHook, /from: pending\.from/);
  assert.match(tutorialHook, /to: renderedPosition/);
  assert.match(tutorialHook, /observeLearnTutorialBoardMove/);
  assert.match(tutorialHook, /!expectedBoardMove\.keys\.includes\(key\)/);
  assert.match(tutorialHook, /pendingBoardMove\.current !== null/);
  assert.doesNotMatch(universalMovement, /const destinationIndex/);
  assert.match(tutorialHook, /const tutorialTaskFocused/);
  assert.match(
    tutorialHook,
    /document\.activeElement\?\.id === `task-\$\{tutorialState\.lastTaskId\}`/,
  );
  assert.match(
    tutorialHook,
    /document\.activeElement !== task\) task\.focus\(\);\s*timer = setTimeout\(focusTutorialTask, 100\)/,
  );
  assert.match(tutorialHook, /arrowright: "l"/);
  assert.match(tutorialHook, /current === releasedHint/);
});
