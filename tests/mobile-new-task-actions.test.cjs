const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const attachmentSource = read(
  "src/components/Common/AttachmentsUpload/index.tsx",
);
const createTaskSource = read("src/components/RTE/TiptapCreateTaskModal.tsx");
const createTaskBodySource = read(
  "src/components/Modals/CreateTaskGloballyModal/CreateTaskModalBody.tsx",
);
const audioButtonSource = read(
  "src/components/RTE/Components/AudioButton.tsx",
);
const jiti = require("jiti")(__filename, { interopDefault: true });
const { mobileMicPresentation } = jiti(
  path.join(
    root,
    "src/components/RTE/Components/mobileAudioButtonPresentation.ts",
  ),
);

const mobileBar = attachmentSource.match(
  /const MobileBottomBar:[\s\S]*?\/\/ ====================================/,
)?.[0];

test("Task Writer and Save stay fixed ahead of secondary actions", () => {
  assert.ok(mobileBar, "MobileBottomBar source should be present");
  assert.match(mobileBar, /data-mobile-new-task-actions/);
  assert.doesNotMatch(mobileBar, /overflow-x-auto/);

  const attachIndex = mobileBar.indexOf('aria-label="Attach files"');
  const aiIndex = mobileBar.indexOf('id="create-task-modal-ai-writer-button"');
  const moreIndex = mobileBar.indexOf("<details");
  const saveIndex = mobileBar.indexOf('label="Save"');

  // Order supersedes the earlier ai < save < more (HTPR-5517): the one filled
  // control ends the row, under the thumb, and attach opens it. A primary
  // sitting before the overflow menu is the layout that made Save hard to find.
  assert.ok(attachIndex >= 0 && attachIndex < aiIndex, "attach opens the row");
  assert.ok(aiIndex >= 0 && aiIndex < moreIndex, "named action before overflow");
  assert.ok(moreIndex >= 0 && moreIndex < saveIndex, "Save is last, under the thumb");
});

test("secondary save and attachment actions remain accessible", () => {
  assert.match(mobileBar, /aria-label="More task actions"/);
  assert.match(mobileBar, /role="group"/);
  assert.match(mobileBar, /Save and close/);
  assert.match(mobileBar, /Save and create new task/);
  assert.match(mobileBar, /Attach files/);
  assert.match(mobileBar, /min-h-\[44px\]/);
});

test("recent mobile waveform, dictation, and touch-target fixes remain", () => {
  assert.doesNotMatch(
    mobileBar,
    /if \(isRecording && toggleRecording && audioTiptapCallback\)/,
    "recording must not swap in a fresh AudioButton after the first tap",
  );
  assert.equal(
    (mobileBar.match(/id="create-task-modal-audio-button"/g) || []).length,
    1,
    "one stable recorder instance must own idle and recording states",
  );
  assert.match(mobileBar, /key="new-task-dictation"/);
  assert.match(mobileBar, /visualizerClassName="!mb-0 w-full"/);
  assert.match(mobileBar, /id="create-task-modal-audio-button"/);
  // Idle dictation must keep its 44px target. It now also carries ml-auto to
  // open the gap after attach, so match the guarantee rather than the literal.
  assert.match(
    mobileBar,
    /className=\{isDictating \? undefined : MOBILE_TARGET\}/,
    "the idle recorder keeps MOBILE_TARGET",
  );
  // Wireframe row (HTPR-5517): the mic is the filled primary while the composer
  // is empty and joins the bare-glyph group once text exists. Flex order moves
  // the one mounted instance instead of conditional JSX, so it never remounts.
  // The order MUST ride on wrapperClassName: only the .audio-recorder root is a
  // direct flex child, order on the inner className div is silently ignored.
  assert.match(
    mobileBar,
    /let recorderWrapperClassName = hasText \? "order-2" : "order-4";/,
  );
  assert.match(
    mobileBar,
    /if \(isDictating\) recorderWrapperClassName = "flex min-h-\[62px\] w-full items-center";/,
    "recording and transcription keep the same action-row height",
  );
  assert.match(mobileBar, /wrapperClassName=\{recorderWrapperClassName\}/);
  assert.match(mobileBar, /wasDictating\.current && !isDictating/);
  assert.match(mobileBar, /saveRef\.current\?\.scrollIntoView/);
  assert.match(createTaskSource, /isRecording=\{isRecording\}/);
  assert.doesNotMatch(createTaskSource, /isRecording=\{false\}/);
  assert.match(
    createTaskSource,
    /const CtrlEnterHandler[\s\S]*?if \(isRecording\) return;/,
  );
});

test("description dictation uses an explicit compact mobile presentation", () => {
  assert.match(mobileBar, /mobilePresentation="compact"/);
  assert.match(mobileBar, /ariaLabel="Dictate description"/);
  assert.match(
    audioButtonSource,
    /mobilePresentation,[\s\S]*?mobileMicPresentation\(\{[\s\S]*?mobilePresentation,/,
  );

  const presentation = mobileMicPresentation({
    isMobileCreateComment: false,
    isMobileTaskWriter: false,
    isMobileNewTask: true,
    isMobileAiChat: false,
    isProcessing: false,
    mobilePresentation: "compact",
  });
  assert.equal(presentation.prominent, false);
  assert.doesNotMatch(presentation.className, /bg-shadcn-primary/);
});

test("transcription keeps the mobile action row in its recording layout", () => {
  assert.match(
    attachmentSource,
    /<MobileBottomBar[\s\S]*?isProcessing=\{audioProcessing\}[\s\S]*?onProcessingChange=\{setAudioProcessing\}/,
  );
  assert.match(
    mobileBar,
    /const isDictating = Boolean\(isRecording \|\| isProcessing\);/,
  );
  assert.match(mobileBar, /onProcessingChange=\{onProcessingChange\}/);
  assert.match(
    mobileBar,
    /className=\{isDictating \? undefined : MOBILE_TARGET\}/,
  );
  assert.equal(
    (mobileBar.match(/!isDictating &&/g) || []).length,
    4,
    "attach, AI, overflow, and Save stay hidden through transcription",
  );
  assert.doesNotMatch(mobileBar, /!isRecording &&/);
});

test("Task Writer return restores the safe-area-aware action bar", () => {
  assert.match(
    createTaskSource,
    /isAiTaskWriterOpen=\{shouldShowAiTaskWriter\}/,
  );
  assert.match(
    mobileBar,
    /wasAiTaskWriterOpen\.current && !isAiTaskWriterOpen/,
  );
  assert.match(mobileBar, /barRef\.current\?\.scrollIntoView/);
  assert.match(
    mobileBar,
    /scroll-mb-\[calc\(env\(safe-area-inset-bottom\)_\+_0\.5rem\)\]/,
  );
  assert.match(mobileBar, /bottom-\[calc\(100%_\+_0\.5rem\)\]/);
  assert.match(mobileBar, /pb-\[env\(safe-area-inset-bottom\)\]/);
  assert.doesNotMatch(mobileBar, /calc\([^\]]*[^_]\+[^_][^\]]*\)/);
});

test("mobile new-task flow keeps the Back pill removed", () => {
  const backButton = createTaskBodySource.match(
    /const BackButton = \(\) => \{[\s\S]*$/,
  )?.[0];
  assert.ok(backButton);
  assert.match(backButton, /fixed xs:hidden sm:flex/);
  assert.match(backButton, /The mobile Back pill is gone/);
  assert.doesNotMatch(backButton, /xs:flex[\s\S]*?closeHandler\(false\)/);
});

test("mobile new-task fields follow writing order without remounting a second tree", () => {
  assert.equal(
    (createTaskBodySource.match(/<TaskTitleModal \/>/g) || []).length,
    1,
  );
  assert.equal(
    (createTaskBodySource.match(/<DescriptionCreateTaskModal \/>/g) || []).length,
    1,
  );
  assert.equal(
    (createTaskBodySource.match(/<TaskInfoColumnContainer(?:\s|>)/g) || []).length,
    2,
  );
  assert.match(
    createTaskBodySource,
    /<TaskTitleModal \/>[\s\S]*?<TaskInfoColumnContainer[\s\S]*?<DescriptionCreateTaskModal \/>/,
  );
  assert.match(createTaskBodySource, /_mbl \?[\s\S]*?"flex-col gap-2/);
  assert.doesNotMatch(createTaskBodySource, /flex-col-reverse/);
});

test("mobile new-task properties do not collapse beneath a long description", () => {
  assert.match(
    createTaskBodySource,
    /<TaskInfoColumnContainer[\s\S]*?heightVariant="fit"[\s\S]*?className="shrink-0"/,
    "the mobile properties card must keep its natural height while the modal scrolls",
  );
});
