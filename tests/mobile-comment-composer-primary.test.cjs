// HTPR-5684: on the mobile comment composer the mic stayed the filled purple
// primary even after you typed, with Send sitting beside it as a small bare
// arrow. Two competing primaries, and the one under your thumb was the one you
// did NOT want next.
//
// The rule now: the filled slot belongs to whatever you would do next. Mic on
// an empty composer, Send the instant there is text, with the mic stepping back
// to a bare glyph next to the attach icon.
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
const audioButton = fs.readFileSync(
  path.join(root, "src/components/RTE/Components/AudioButton.tsx"),
  "utf8",
);

const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const {
  mobileCommentMicWrapperClass,
} = jiti(
  path.join(root, "src/components/Common/AttachmentsUpload/mobileCommentComposer.ts"),
);

test("empty composer: the mic is the primary, pinned to the right", () => {
  const cls = mobileCommentMicWrapperClass({ hasText: false });
  assert.match(cls, /ml-auto/, "mic must be pushed to the primary slot");
  assert.equal(cls.includes("order-3"), false);
});

test("text present: the mic steps back beside the attach icon", () => {
  const cls = mobileCommentMicWrapperClass({ hasText: true });
  assert.equal(cls, "order-4");
  assert.equal(
    cls.includes("ml-auto"),
    false,
    "mic must give up the right-hand primary slot to Send",
  );
});

test("recording still takes the whole row for the waveform", () => {
  const cls = mobileCommentMicWrapperClass({ hasText: true, isRecording: true });
  assert.match(cls, /w-full/);
});

test("Send occupies the primary slot once there is text, same colour as the demoted mic", () => {
  const send = composer.match(
    /aria-label="Send comment"[\s\S]*?className="([^"]+)"/,
  );
  assert.ok(send, "the Send button must still be there");
  // HTPR-5659: layout swap only — no purple fill on Send. Match the demoted mic.
  assert.match(send[1], /text-icon-dark-gray/);
  assert.doesNotMatch(send[1], /bg-hypertasks-ai-purple/);
  assert.doesNotMatch(send[1], /(?:^|\s)text-white(?:\s|$)/);

  const slot = composer.match(/<span className="([^"]*)">\s*<SaveButtonMobile/);
  assert.ok(slot, "Send must be wrapped in an ordered slot");
  assert.match(slot[1], /ml-auto/, "Send must sit in the right-hand slot");
});

test("the mic loses its fill as soon as there is text", () => {
  // hasText is checked BEFORE the create-comment carve-out, otherwise the
  // comment composer keeps a filled mic and the old bug returns.
  const branch = audioButton.match(
    /const prominentClassName = isProcessing[\s\S]*?;\n/,
  );
  assert.ok(branch, "prominent styling branch must exist");
  assert.ok(
    branch[0].indexOf("hasText") < branch[0].indexOf("isMobileCreateComment"),
    "hasText must outrank the create-comment carve-out",
  );
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

test("typed comments keep the purple ai trigger mounted when tapping it blurs the editor", () => {
  const branch = composer.slice(
    composer.indexOf('{mode === "create-comment" ? ('),
    composer.indexOf("// ========================================================== DESKTOP"),
  );
  assert.match(
    branch,
    /id=\{mode \+ "-ai-writer-button"\}[\s\S]*?text-hypertasks-ai-purple/,
  );
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
  const saves = [...row.matchAll(/<span className="([^"]*)">\s*<SaveButtonMobile/g)];
  assert.equal(saves.length, 2, "both Save/Send slots must be wrapped");
  for (const [, cls] of saves) {
    assert.match(cls, /order-6/, "Save/Send must take the trailing slot");
    assert.match(cls, /ml-auto/);
  }
  assert.equal(
    /\n\s*<SaveButtonMobile/.test(row.replace(/<span className="[^"]*">\s*<SaveButtonMobile/g, "")),
    false,
    "no bare, unordered SaveButtonMobile may remain in the row",
  );
});

test("DOM order matches the order values for the comment row", () => {
  const branch = composer.slice(
    composer.indexOf('{mode === "create-comment" ? ('),
    composer.indexOf("// ========================================================== DESKTOP"),
  );
  const aiAt = branch.indexOf('id={mode + "-ai-writer-button"}');
  const micAt = branch.indexOf("<AudioButton");
  assert.ok(aiAt > -1, "the comment ai trigger must live in this branch");
  assert.ok(
    aiAt < micAt,
    "ai (order-3) must precede mic (order-4) in the DOM so tab order matches",
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
