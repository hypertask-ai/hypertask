// The mobile comment composer has one right-bound primary slot. Dictation owns
// it while empty, then Send owns it as soon as text exists. The same mounted mic
// becomes a ghost immediately left of Send so recording state is never lost.
//
// The mic must MOVE BY `order`, never by conditional re-parenting: rendering it
// under a different parent unmounts it and throws away an in-flight
// MediaRecorder (#2666), so a dictation started before the first word would die
// as soon as transcription inserted text.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const composerPath = path.join(
  root,
  "src/components/Common/AttachmentsUpload/index.tsx",
);
const composer = fs.readFileSync(composerPath, "utf8");

const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const {
  mobileCommentMicWrapperClass,
  mobileEditorTriggerText,
} = jiti(
  path.join(root, "src/components/Common/AttachmentsUpload/mobileCommentComposer.ts"),
);
const { mobileMicPresentation } = jiti(
  path.join(
    root,
    "src/components/RTE/Components/mobileAudioButtonPresentation.ts",
  ),
);
const commentMicState = {
  isMobileCreateComment: true,
  isMobileTaskWriter: false,
  isMobileNewTask: false,
  isMobileAiChat: false,
  isProcessing: false,
};

test("the + menu inserts a mention prefix that always opens the picker", () => {
  assert.equal(mobileEditorTriggerText("@", ""), "@");
  assert.equal(mobileEditorTriggerText("@", " "), "@");
  assert.equal(mobileEditorTriggerText("@", "text"), " @");
  assert.equal(mobileEditorTriggerText("@", "\uFFFC"), " @");
  assert.equal(mobileEditorTriggerText("@", "\n"), "@");
  assert.equal(mobileEditorTriggerText("/", "text"), "/");
});

test("empty composer: the mic is the primary, pinned to the right", () => {
  const cls = mobileCommentMicWrapperClass({ hasText: false });
  assert.match(cls, /ml-auto/, "mic must be pushed to the primary slot");
  assert.equal(cls.includes("order-3"), false);
});

test("text present: the mic sits immediately left of Send", () => {
  const cls = mobileCommentMicWrapperClass({ hasText: true });
  assert.equal(cls, "order-5 ml-auto");
});

test("recording still takes the whole row for the waveform", () => {
  const cls = mobileCommentMicWrapperClass({ hasText: true, isRecording: true });
  assert.match(cls, /w-full/);
});

test("Send occupies the 48 by 44 inverted-theme primary slot", () => {
  const send = composer.match(
    /aria-label="Send comment"[\s\S]*?className="([^"]+)"/,
  );
  assert.ok(send, "the Send button must still be there");
  assert.match(send[1], /h-11/);
  assert.match(send[1], /w-12/);
  assert.match(send[1], /rounded-\[4px\]/);
  assert.match(send[1], /bg-white-black/);
  assert.match(send[1], /text-white-black-inverted/);
  assert.doesNotMatch(send[1], /bg-hypertasks-ai-purple/);

  const slot = composer.match(
    /<span\s+className=\{cn\([\s\S]*?"order-6 flex items-center"[\s\S]*?\)\}\s*>\s*<SaveButtonMobile/,
  );
  assert.ok(slot, "Send must be wrapped in an ordered slot");
  assert.match(
    slot[0],
    /\(!audioTiptapCallback \|\| hideComposerDictation\) && "ml-auto"/,
    "Send must own the spacer only when the mic is unavailable",
  );
});

test("the mic loses its fill as soon as there is text", () => {
  const presentation = mobileMicPresentation({
    ...commentMicState,
    hasText: true,
  });
  assert.equal(presentation.prominent, true);
  assert.match(presentation.className, /text-icon-dark-gray/);
  assert.doesNotMatch(presentation.className, /bg-hypertasks-ai-purple/);
});

test("the mic is never re-parented between states", () => {
  // Exactly one AudioButton in the create-comment branch. Two would mean the
  // element is conditionally rendered in two places, which is the remount bug.
  const commentBranch = composer.slice(
    composer.indexOf('{mode === "create-comment" ? ('),
    composer.indexOf("// ========================================================== DESKTOP"),
  );
  const mics = commentBranch.match(/<AudioButton/g) || [];
  assert.equal(mics.length, 1, "the comment composer must mount ONE mic");
});

test("transcribing keeps the mic in the primary slot", () => {
  // Streamed transcript populates the editor before onProcessingChange(false),
  // so hasText is true while the spinner is still up. Send is gated behind
  // !audioProcessing, so demoting the mic here would leave the primary slot
  // empty and slide the spinner into the middle of the row.
  const cls = mobileCommentMicWrapperClass({ hasText: true, isProcessing: true });
  assert.match(cls, /ml-auto/);
  assert.equal(cls.includes("order-3"), false);
});

test("the comment AI action uses the purple PencilSparkles icon", () => {
  const branch = composer.slice(
    composer.indexOf('{mode === "create-comment" ? ('),
    composer.indexOf("// ========================================================== DESKTOP"),
  );
  assert.match(
    branch,
    /id=\{mode \+ "-ai-writer-button"\}[\s\S]*?text-hypertasks-ai-purple[\s\S]*?<PencilSparkles/,
  );
  assert.doesNotMatch(branch, />\s*ai\s*</);
  assert.doesNotMatch(branch, /<MobileCommentImproveButton/);
});

test("every child of the flattened row carries an order", () => {
  // A flat flex row sorts unordered children as order 0, ahead of everything.
  // Description and existing-comment editing share this row, so their Save
  // button needs the trailing slot explicitly.
  const row = composer.slice(
    composer.indexOf('<div className="attachment-button p-0 flex flex-row'),
    composer.indexOf('_mbl && mode === "create-task-modal"'),
  );
  const commentSave = row.match(
    /<span\s+className=\{cn\([\s\S]*?"order-6 flex items-center"[\s\S]*?\)\}\s*>\s*<SaveButtonMobile/,
  );
  const editSave = row.match(
    /<span className="([^"]*order-6[^"]*)">\s*<SaveButtonMobile/,
  );
  assert.ok(commentSave, "comment Send must have the trailing slot");
  assert.match(
    commentSave[0],
    /\(!audioTiptapCallback \|\| hideComposerDictation\) && "ml-auto"/,
  );
  assert.ok(editSave, "shared edit Save must have the trailing slot");
  assert.match(editSave[1], /ml-auto/, "shared edit Save stays pinned right");
  assert.equal(
    (row.match(/<SaveButtonMobile/g) || []).length,
    2,
    "no bare, unordered SaveButtonMobile may remain in the row",
  );
});

test("DOM order is Plus, AI, mic, Send", () => {
  const branch = composer.slice(
    composer.indexOf('{mode === "create-comment" ? ('),
    composer.indexOf("// ========================================================== DESKTOP"),
  );
  const plusAt = branch.indexOf('aria-label="More comment actions"');
  const aiAt = branch.indexOf('id={mode + "-ai-writer-button"}');
  const micAt = branch.indexOf("<AudioButton");
  const sendAt = branch.indexOf("<SaveButtonMobile");
  assert.ok(plusAt > -1);
  assert.ok(plusAt < aiAt && aiAt < micAt && micAt < sendAt);
});

test("Plus menu exposes the five specified actions through existing handlers", () => {
  const branch = composer.slice(
    composer.indexOf('{mode === "create-comment" ? ('),
    composer.indexOf("// ========================================================== DESKTOP"),
  );
  for (const label of [
    "Attach image",
    "Attach file",
    "Mention someone",
    "Commands",
    "Discard draft",
  ]) {
    assert.match(branch, new RegExp(label));
  }
  assert.match(branch, /openAttachmentPicker\("image\/\*"\)/);
  assert.match(branch, /openAttachmentPicker\(\);[\s\S]*?Attach file/);
  assert.match(branch, /insertEditorTrigger\("@"\)/);
  assert.match(branch, /insertEditorTrigger\("\/"\)/);
  assert.match(branch, /showDeleteComment === true[\s\S]*?handleDiscardDrafts\(\)/);
  assert.match(branch, /text-destructive/);
  assert.doesNotMatch(branch, /aria-label="Attach files"/);
});

test("Plus menu closes on outside press, Escape, and dictation", () => {
  assert.match(
    composer,
    /const closeOnOutsidePress[\s\S]*?mobileCommentActionsRef\.current\.contains[\s\S]*?closeMobileCommentActions\(\);/,
  );
  assert.match(
    composer,
    /const closeOnEscape[\s\S]*?event\.key !== "Escape"[\s\S]*?closeMobileCommentActions\(\);[\s\S]*?mobileCommentActionsTriggerRef\.current\?\.focus\(\)/,
  );
  assert.match(
    composer,
    /useEffect\(\(\) => \{\s*if \(isRecording \|\| audioProcessing\) closeMobileCommentActions\(\)/,
  );
});

test("ai stays hidden while recording or transcribing", () => {
  const branch = composer.slice(
    composer.indexOf('{mode === "create-comment" ? ('),
    composer.indexOf("// ========================================================== DESKTOP"),
  );
  assert.match(
    branch,
    /!isRecording && !audioProcessing && toggleAiTaskWriter/,
  );
});
