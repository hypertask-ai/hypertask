const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (relativePath) =>
  fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");

const attachments = read("src/components/Common/AttachmentsUpload/index.tsx");
const jiti = require("jiti")(__filename, { interopDefault: true });
const { mobileMicPresentation } = jiti(
  path.join(
    __dirname,
    "../src/components/RTE/Components/mobileAudioButtonPresentation.ts",
  ),
);
const commentMicState = {
  isMobileCreateComment: true,
  isMobileTaskWriter: false,
  isMobileNewTask: false,
  isMobileAiChat: false,
  isProcessing: false,
};

test("empty mobile comment composer keeps the microphone as the inverted primary", () => {
  const presentation = mobileMicPresentation(commentMicState);
  assert.equal(presentation.prominent, true);
  assert.match(presentation.className, /h-11 w-12/);
  assert.match(presentation.className, /bg-white-black/);
  assert.match(presentation.className, /text-white-black-inverted/);
});

test("typed mobile comments hand the inverted primary slot to Send", () => {
  const presentation = mobileMicPresentation({
    ...commentMicState,
    hasText: true,
  });
  assert.equal(presentation.prominent, true);
  assert.match(presentation.className, /text-icon-dark-gray/);
  assert.doesNotMatch(presentation.className, /bg-hypertasks-ai-purple/);

  const commentBranch = attachments.slice(
    attachments.indexOf('{mode === "create-comment" ? ('),
    attachments.indexOf("// ========================================================== DESKTOP"),
  );
  assert.match(
    commentBranch,
    /<AudioButton[\s\S]*?id=\{mode \+ "-audio-button"\}[\s\S]*?globalRecording=\{isRecording\}[\s\S]*?hasText=\{hasText\}/,
  );

  const send = attachments.match(
    /aria-label="Send comment"[\s\S]{0,400}?className="([^"]+)"/,
  );
  assert.ok(send, "Send button must exist");
  assert.match(send[1], /bg-white-black/);
  assert.match(send[1], /text-white-black-inverted/);
  assert.doesNotMatch(send[1], /bg-hypertasks-ai-purple/);

  // And the mic renders before Send in the row rather than after it.
  assert.match(
    attachments,
    /<AudioButton[\s\S]*?id=\{mode \+ "-audio-button"\}[\s\S]*?<SaveButtonMobile/,
  );
});

test("mobile comment composer uses the inline draft AI float on all viewports", () => {
  const taskDetail = read("src/components/RTE/TipTapTaskDetail.tsx");
  assert.match(
    taskDetail,
    /shouldShowInlineDraftAi = Boolean\(\s*shouldShowAiTaskWriter && getDefaultMode\(\) === "WriteWithAI"/,
  );
  assert.doesNotMatch(
    taskDetail,
    /shouldShowInlineDraftAi[\s\S]{0,120}!isMbl/,
  );
});
