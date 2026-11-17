const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { load, source } = require("./helpers/flag-files.cjs");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const modal = read("src/components/Modals/CreateTaskGloballyModal/index.tsx");
const description = read(
  "src/components/Modals/CreateTaskGloballyModal/DescriptionCreateTaskModal.tsx",
);
const editor = read("src/components/RTE/TiptapCreateTaskModal.tsx");
const attachments = read("src/components/Common/AttachmentsUpload/index.tsx");
const controls = read("src/components/Common/AttachmentsUpload/AttachmentControls.tsx");
const globals = read("src/styles/globals.scss");
const { phoneNewTaskViewportOffsets } = load("src/lib/phoneNewTaskSheet.ts");

const sheetRule = (selector) => {
  const start = globals.indexOf(selector);
  assert.notEqual(start, -1, selector);
  return globals.slice(start, globals.indexOf("}", start) + 1);
};

test("phone new task layout is an owner and QA improvement flag", () => {
  const definition = load(
    "src/lib/flags/definitions/htpr-8029-phone-new-task-layout.ts",
  ).default;
  assert.equal(definition.key, "htpr-8029-phone-new-task-layout");
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.defaultMode, "OWNER_AND_QA");
  assert.match(
    source(),
    /HTPR_8029_PHONE_NEW_TASK_LAYOUT_FLAG\s*=\s*"htpr-8029-phone-new-task-layout"/,
  );
});

test("flag off leaves the phone sheet markers off, including on desktop", () => {
  assert.match(modal, /useFlag\(HTPR_8029_PHONE_NEW_TASK_LAYOUT_FLAG\)/);
  assert.match(
    modal,
    /data-phone-new-task-sheet=\{Boolean\(isMobile\) && phoneNewTaskLayout \? "on" : undefined\}/,
  );
  assert.doesNotMatch(modal, /["'`]phone-new-task-sheet["'`]/);
  assert.match(description, /useFlag\(HTPR_8029_PHONE_NEW_TASK_LAYOUT_FLAG\)/);
  assert.match(
    description,
    /data-phone-new-task-card=\{Boolean\(_mbl\) && phoneNewTaskLayout \? "on" : undefined\}/,
  );
});

test("the phone sheet pads below the status bar, with a floor when the inset is 0", () => {
  assert.match(
    globals,
    /#createTaskModal\[data-phone-new-task-sheet\] #body \{[^}]*padding-top:\s*max\(env\(safe-area-inset-top\),\s*28px\)/,
  );
  assert.match(modal, /useMobileVisualViewport\(Boolean\(isMobile\) && phoneNewTaskLayout\)/);
  assert.match(modal, /phoneNewTaskViewportOffsets\(viewport\)/);
});

test("the dictation row stays inside the text card and docks above the keyboard", () => {
  const cardStart = description.indexOf("descriptionContainerCreateTaskModal");
  const cardEnd = description.indexOf("</BaseCommentAndDescriptionContainer>", cardStart);
  assert.match(description.slice(cardStart, cardEnd), /<TiptapCreateTaskModal/);
  assert.match(editor, /<AttachmentsUpload[\s\S]*mode=\{"create-task-modal"\}/);
  const createTaskBranch = attachments.slice(
    attachments.indexOf('mode === "create-task-modal"'),
    attachments.indexOf("<DesktopAttachment"),
  );
  assert.match(createTaskBranch, /<MobileBottomBar/);
  assert.match(controls, /data-mobile-new-task-actions/);

  const dock = sheetRule(
    "#createTaskModal[data-phone-new-task-sheet] [data-phone-new-task-card] .attachment-upload-container",
  );
  assert.match(dock, /margin-top:\s*auto/);
  const dialog = sheetRule("#createTaskModal[data-phone-new-task-sheet] {");
  assert.match(dialog, /bottom:\s*var\(--phone-new-task-keyboard,\s*0px\)/);
  assert.match(
    modal,
    /data-phone-new-task-keyboard=\{Boolean\(isMobile\) && phoneNewTaskLayout && keyboardOpen \? "on" : undefined\}/,
  );
});

test("visual viewport offsets keep the sheet on the visible area", () => {
  assert.deepEqual(phoneNewTaskViewportOffsets(null), {
    top: "0px",
    keyboard: "0px",
    keyboardOpen: false,
  });
  assert.deepEqual(
    phoneNewTaskViewportOffsets({ layoutHeight: 800, visibleHeight: 800, bottomInset: 0 }),
    { top: "0px", keyboard: "0px", keyboardOpen: false },
  );
  assert.deepEqual(
    phoneNewTaskViewportOffsets({ layoutHeight: 800, visibleHeight: 450, bottomInset: 350 }),
    { top: "0px", keyboard: "350px", keyboardOpen: true },
  );
  assert.deepEqual(
    phoneNewTaskViewportOffsets({ layoutHeight: 800, visibleHeight: 500, bottomInset: 0 }),
    { top: "0px", keyboard: "0px", keyboardOpen: false },
  );
  assert.deepEqual(
    phoneNewTaskViewportOffsets({ layoutHeight: 800, visibleHeight: 400, bottomInset: 300 }),
    { top: "100px", keyboard: "300px", keyboardOpen: true },
  );
});
