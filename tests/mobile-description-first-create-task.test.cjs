const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const body = read(
  "src/components/Modals/CreateTaskGloballyModal/CreateTaskModalBody.tsx",
);
const properties = read(
  "src/components/Modals/CreateTaskGloballyModal/TaskInfoColumnGloballyCreate.tsx",
);
const attachments = read("src/components/Common/AttachmentsUpload/index.tsx");
const createTaskEditor = read("src/components/RTE/TiptapCreateTaskModal.tsx");
const audioButton = read("src/components/RTE/Components/AudioButton.tsx");
const flagKeys = read("src/lib/flags/keys.ts");
const flags = read("src/lib/flags.ts");

const mobileBarStart = attachments.indexOf("const MobileBottomBar");
const mobileBarEnd = attachments.indexOf(
  "// ====================================",
  mobileBarStart,
);
const mobileBar = attachments.slice(mobileBarStart, mobileBarEnd);

test("description-first mobile creation is owner and QA flagged", () => {
  assert.match(
    flagKeys,
    /HTPR_6556_MOBILE_DESCRIPTION_FIRST_FLAG\s*=\s*\n?\s*"htpr-6556-mobile-description-first"/,
  );
  assert.match(flags, /key: HTPR_6556_MOBILE_DESCRIPTION_FIRST_FLAG/);
  assert.match(body, /useFlag\(HTPR_6556_MOBILE_DESCRIPTION_FIRST_FLAG\)/);
  assert.match(attachments, /useFlag\(HTPR_6556_MOBILE_DESCRIPTION_FIRST_FLAG\)/);
});

test("mobile header keeps board visible and title plus properties collapsed", () => {
  assert.match(body, /data-mobile-description-first-header/);
  assert.match(
    body,
    /pt-\[calc\(max\(env\(safe-area-inset-top\),28px\)\+0\.75rem\)\]/,
    "the full-screen header must clear Android's status bar even when its WebView reports a zero safe-area inset",
  );
  assert.match(body, /onClick=\{toggleProjectsModal\}/);
  assert.match(body, />Board:<\/span>/);
  assert.match(body, /aria-expanded=\{expandedMobileSection === "title"\}/);
  assert.match(body, /aria-expanded=\{expandedMobileSection === "properties"\}/);
  assert.match(
    body,
    /descriptionFirstMobile && expandedMobileSection !== "title" \? "hidden" : "contents"/,
  );
  assert.match(
    body,
    /if \(nextSection === "title"\)[\s\S]*?setCurrentFocusedElement\("Title"\)[\s\S]*?else \{[\s\S]*?setCurrentFocusedElement\("Description"\)/,
  );
  assert.match(
    body,
    /if \(!descriptionFocusSet\.current\) \{\s*descriptionFocusSet\.current = true\s*if \(editMode === "Description-ai"\) return/,
  );
  assert.match(
    body,
    /setCurrentFocusedElement\("Description"\)[\s\S]*?return[\s\S]*?titleGenerationError \|\| currentFocusedElement === "Title"[\s\S]*?setExpandedMobileSection\("title"\)/,
  );
  assert.match(body, /mobileShowPills=\{expandedMobileSection === "properties"\}/);
  assert.match(body, /mobileRaisedPanel/);
  assert.match(properties, /raisedPanel = false/);
  assert.match(properties, /: "flex flex-wrap gap-2 px-2 pb-2"/);
  assert.match(properties, /showPills && \(/);
  assert.match(properties, /!hideBoard \|\| property\.label !== "Board"/);
});

test("description-first actions save with Task Writer without opening its sheet", () => {
  assert.match(mobileBar, /descriptionFirst && hasText/);
  assert.match(
    mobileBar,
    /label="Save"[\s\S]*?sendOnClick && sendOnClick\("Save"\)/,
  );
  assert.match(mobileBar, /isAiTaskWriterOpen \? "Saving\.\.\." : "Save with task writer"/);
  assert.match(attachments, /aria-disabled=\{disabled \|\| undefined\}/);
  assert.match(attachments, /aria-busy=\{busy \|\| undefined\}/);
  assert.match(
    mobileBar,
    /label=\{isAiTaskWriterOpen[\s\S]*?disabled=\{isAiTaskWriterOpen\}[\s\S]*?busy=\{isAiTaskWriterOpen\}/,
  );
  assert.match(
    createTaskEditor,
    /const saveWithTaskWriter = \(\) => \{[\s\S]*?setShouldShowAITaskWriter\(true\)/,
  );
  assert.match(
    createTaskEditor,
    /toggleAiTaskWriter=\{[\s\S]*?descriptionFirstEnabled[\s\S]*?saveWithTaskWriter/,
  );
  assert.match(createTaskEditor, /createTaskInBackground=\{isSavingWithTaskWriter\}/);
  assert.match(
    createTaskEditor,
    /isSavingWithTaskWriter[\s\S]*?"pointer-events-none h-0"/,
    "the background writer must not cover or intercept the visible task form",
  );
  assert.match(
    mobileBar,
    /data-mobile-primary-save[\s\S]*?bg-shadcn-primary[\s\S]*?text-primary-foreground/,
  );
});

test("mobile new-task dictation keeps the editor and keyboard active", () => {
  assert.match(
    createTaskEditor,
    /if \(isRecording && editor && !keepMobileEditorActiveDuringDictation\)/,
  );
  assert.match(
    audioButton,
    /isMobileNewTask[\s\S]*?onPointerDown=\{\(event\) => \{[\s\S]*?event\.preventDefault\(\)/,
  );
});

test("Task Writer result still creates the finished ticket directly", () => {
  assert.match(
    createTaskEditor,
    /applyCreateTaskResult[\s\S]*?CtrlEnterHandler\("Save", mergedFormValues\)/,
  );
  assert.match(
    createTaskEditor,
    /isMbl && descriptionFirstEnabled \? "min-h-\[42svh\]"/,
  );
});

test("Task Writer snapshots the current editor content when direct save starts", () => {
  assert.match(
    createTaskEditor,
    /const saveWithTaskWriter = \(\) => \{[\s\S]*?resolveTaskWriterDescription\(\s*editor\?\.getHTML\(\),\s*formValues\.description,?\s*\)[\s\S]*?taskWriterSubmittedDescriptionRef\.current/,
  );
});

test("Task Writer direct save blocks create-task keyboard shortcuts", () => {
  assert.match(
    createTaskEditor,
    /if \(cmdControl && e\.key === "Enter"\) \{\s*if \(isSavingWithTaskWriter\) return;/,
  );
});
