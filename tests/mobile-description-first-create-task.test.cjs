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

test("description-first actions offer raw save and primary Task Writer save", () => {
  assert.match(mobileBar, /descriptionFirst && hasText/);
  assert.match(
    mobileBar,
    /label="Save"[\s\S]*?sendOnClick && sendOnClick\("Save"\)/,
  );
  assert.match(mobileBar, /label="Save with task writer"/);
  assert.match(
    mobileBar,
    /label="Save with task writer"[\s\S]*?onClick=\{toggleAiTaskWriter\}/,
  );
  assert.match(
    mobileBar,
    /data-mobile-primary-save[\s\S]*?bg-shadcn-primary[\s\S]*?text-primary-foreground/,
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
