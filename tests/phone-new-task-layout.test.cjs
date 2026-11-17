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
const { phoneNewTaskShortSheet, phoneNewTaskViewportOffsets } = load(
  "src/lib/phoneNewTaskSheet.ts",
);

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

test("a 500px tall viewport scrolls the sheet and keeps the description card", () => {
  assert.equal(
    phoneNewTaskShortSheet({ layoutHeight: 844, visibleHeight: 500, bottomInset: 344 }),
    true,
  );
  assert.equal(
    phoneNewTaskShortSheet({ layoutHeight: 500, visibleHeight: 500, bottomInset: 0 }),
    true,
  );
  assert.equal(
    phoneNewTaskShortSheet({ layoutHeight: 844, visibleHeight: 844, bottomInset: 0 }),
    false,
  );
  assert.match(
    modal,
    /data-phone-new-task-short=\{phoneLayout && shortSheet \? "on" : undefined\}/,
  );

  const body = sheetRule(
    "#createTaskModal[data-phone-new-task-sheet][data-phone-new-task-short] #body {",
  );
  assert.match(body, /overflow-y:\s*auto/);

  const properties = sheetRule(
    "#createTaskModal[data-phone-new-task-sheet][data-phone-new-task-short] [data-task-properties-rail]",
  );
  assert.match(properties, /min-height:\s*0/);
  assert.match(properties, /overflow-y:\s*auto/);

  const card = sheetRule(
    "#createTaskModal[data-phone-new-task-sheet][data-phone-new-task-short] [data-phone-new-task-card] {",
  );
  assert.match(card, /min-height:\s*120px/);
  assert.match(card, /flex:\s*1\s+0\s+auto/);
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


test("short sheet sizing overrides shared inline flex and layered important padding", () => {
  const thread = sheetRule(
    '#createTaskModal[data-phone-new-task-sheet][data-phone-new-task-short] [data-testid="ticket-thread"] {',
  );
  assert.match(thread, /flex:\s*0 0 auto !important/);
  assert.match(globals, /@layer utilities\s*\{\s*#createTaskModal\[data-phone-new-task-sheet\]\[data-phone-new-task-short\] \[data-testid="ticket-thread"\]\s*\{\s*padding-bottom:\s*0 !important/);
});

const { chromium } = require("@playwright/test");
test("short sheets reserve the card's intrinsic height despite shared inline flex and important padding", {
  skip: !fs.existsSync(chromium.executablePath()),
}, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 500 } });
    const phoneStyles = globals.slice(
      globals.indexOf("#createTaskModal[data-phone-new-task-sheet] {"),
      globals.indexOf("\n.item {"),
    );
    await page.setContent(`
      <style>
        @layer utilities {
          .shared-thread { padding-bottom: 50px !important; }
        }
        * { box-sizing: border-box; }
        body { margin: 0; }
        .properties { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
        .properties > div { height: 240px; }
        .editor { flex: 1 0 72px; }
        .attachment-upload-container { height: 60px; }
        [data-phone-new-task-card] { padding: 10px; }
        ${phoneStyles}
      </style>
      <div id="createTaskModal" data-phone-new-task-sheet="on" data-phone-new-task-short="on">
        <div class="modal-content"><div id="body">
          <header style="flex:0 0 105px"></header>
          <div id="taskInfo_comments_description_container" style="flex:1">
            <div class="properties"><div></div></div>
            <div data-testid="ticket-thread" class="shared-thread" style="flex:1">
              <div data-phone-new-task-card="on">
                <div class="editor"></div><div class="attachment-upload-container"></div>
              </div>
            </div>
          </div>
        </div></div>
      </div>
    `);
    for (const viewport of [
      { layoutHeight: 500, visibleHeight: 500, bottomInset: 0 },
      { layoutHeight: 844, visibleHeight: 500, bottomInset: 344 },
      { layoutHeight: 844, visibleHeight: 400, bottomInset: 344 },
      { layoutHeight: 844, visibleHeight: 844, bottomInset: 0 },
    ]) {
      await page.setViewportSize({ width: 390, height: viewport.layoutHeight });
      const offsets = phoneNewTaskViewportOffsets(viewport);
      await page.locator("#createTaskModal").evaluate((sheet, { offsets, short }) => {
        sheet.style.setProperty("--phone-new-task-viewport-top", offsets.top);
        sheet.style.setProperty("--phone-new-task-keyboard", offsets.keyboard);
        sheet.toggleAttribute("data-phone-new-task-short", short);
      }, { offsets, short: phoneNewTaskShortSheet(viewport) });
      const rects = await page.locator("#createTaskModal").evaluate((sheet) => {
        const rect = (selector) => sheet.querySelector(selector).getBoundingClientRect().toJSON();
        return { sheet: sheet.getBoundingClientRect().toJSON(), card: rect("[data-phone-new-task-card]"), row: rect(".attachment-upload-container") };
      });
      assert.equal(rects.sheet.height, viewport.visibleHeight);
      assert.ok(rects.card.height >= 120, JSON.stringify(rects));
      assert.ok(rects.row.bottom <= rects.sheet.bottom, JSON.stringify(rects));
      assert.ok(rects.row.bottom <= rects.card.bottom, JSON.stringify(rects));
      assert.ok(rects.card.bottom - rects.row.bottom <= 24, JSON.stringify(rects));
    }
  } finally {
    await browser.close();
  }
});
