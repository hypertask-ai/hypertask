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

const mobileBarStart = attachmentSource.indexOf("const MobileBottomBar");
const mobileBarEnd = attachmentSource.indexOf(
  "// ====================================",
  mobileBarStart,
);
const mobileBar =
  mobileBarStart >= 0 && mobileBarEnd >= 0
    ? attachmentSource.slice(mobileBarStart, mobileBarEnd)
    : undefined;
const mobileBottomBarStart = attachmentSource.indexOf("<MobileBottomBar");
const mobileBottomBarEnd = attachmentSource.indexOf("/>", mobileBottomBarStart);
const mobileBottomBarUsage =
  mobileBottomBarStart >= 0 && mobileBottomBarEnd >= 0
    ? attachmentSource.slice(mobileBottomBarStart, mobileBottomBarEnd + 2)
    : undefined;

test("Task Writer and Save stay fixed after attachment actions", () => {
  assert.ok(mobileBar, "MobileBottomBar source should be present");
  assert.match(mobileBar, /data-mobile-new-task-actions/);
  assert.doesNotMatch(mobileBar, /overflow-x-auto/);

  const attachIndex = mobileBar.indexOf('aria-label="Attach files"');
  const aiIndex = mobileBar.indexOf('id="create-task-modal-ai-writer-button"');
  const saveIndex = mobileBar.indexOf('label="Save"');

  assert.ok(attachIndex >= 0 && attachIndex < aiIndex, "attach opens the row");
  assert.ok(aiIndex >= 0 && aiIndex < saveIndex, "Save stays last, under the thumb");
});

test("mobile exposes one Save action and no overflow menu", () => {
  assert.doesNotMatch(mobileBar, /aria-label="More task actions"/);
  assert.doesNotMatch(mobileBar, /<details/);
  assert.doesNotMatch(mobileBar, /Save and close/);
  assert.doesNotMatch(mobileBar, /Save and create new task/);
  assert.equal((mobileBar.match(/label="Save"/g) || []).length, 1);
  assert.match(mobileBar, /Attach files/);
  assert.match(mobileBar, /MOBILE_TARGET/);
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

test("description dictation is a white button until Save becomes primary", () => {
  assert.match(mobileBar, /mobilePresentation="prominent"/);
  assert.match(mobileBar, /ariaLabel="Dictate description"/);
  assert.match(
    audioButtonSource,
    /mobilePresentation,[\s\S]*?mobileMicPresentation\(\{[\s\S]*?mobilePresentation,/,
  );

  const base = {
    isMobileCreateComment: false,
    isMobileTaskWriter: false,
    isMobileNewTask: true,
    isMobileAiChat: false,
    isProcessing: false,
    mobilePresentation: "prominent",
  };
  const empty = mobileMicPresentation(base);
  const typed = mobileMicPresentation({ ...base, hasText: true });

  assert.equal(empty.prominent, true);
  assert.match(empty.className, /bg-white-black/);
  assert.match(empty.className, /text-white-black-inverted/);
  assert.equal(typed.prominent, true);
  assert.doesNotMatch(typed.className, /bg-white-black/);
  assert.match(typed.className, /text-icon-dark-gray/);
});

test("transcription keeps the mobile action row in its recording layout", () => {
  assert.ok(mobileBottomBarUsage, "MobileBottomBar usage should be present");
  assert.match(mobileBottomBarUsage, /isProcessing=\{audioProcessing\}/);
  assert.match(mobileBottomBarUsage, /onProcessingChange=\{setAudioProcessing\}/);
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
    3,
    "attach, AI, and Save stay hidden through transcription",
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
    /<TaskInfoColumnContainer\s+heightVariant="fit"\s+className="shrink-0"\s*>/,
    "the mobile properties card must keep its natural height while the modal scrolls",
  );
});
