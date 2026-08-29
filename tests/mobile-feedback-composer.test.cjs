const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("mobile feedback exposes accessible dictation in the existing editor", () => {
  const feedback = read("src/components/Modals/Feedback/FeedbackForm.tsx");
  const feedbackModal = read(
    "src/components/Modals/Feedback/FeedbackModal.tsx",
  );
  const feedbackSettings = read(
    "src/components/Modals/Settings/FeedbackSection.tsx",
  );
  const audioButton = read("src/components/RTE/Components/AudioButton.tsx");

  assert.match(feedback, /id="feedback-audio-button"/);
  assert.match(feedback, /idleLabel="Dictate"/);
  assert.match(feedback, /ariaLabel="Start dictation"/);
  assert.match(feedback, /editor\.commands\.insertContent\(text\)/);
  assert.match(audioButton, /isKeyboardAccessible/);
  assert.match(audioButton, /event\.key !== "Enter" && event\.key !== " "/);
  assert.match(feedback, /isSubmitting \|\| isDictating/);
  assert.match(feedbackModal, /draft\.isDictating/);
  assert.match(feedbackSettings, /draft\.isDictating/);
});

test("screenshot selection restores typing after choose, cancel, oversize, and remove", () => {
  const feedback = read("src/components/Modals/Feedback/FeedbackForm.tsx");

  assert.match(feedback, /shouldRestoreEditorFocus\.current = true/);
  assert.match(feedback, /window\.addEventListener\("focus", restoreAfterPicker\)/);
  assert.match(
    feedback,
    /document\.addEventListener\("visibilitychange", restoreAfterPicker\)/,
  );
  assert.match(feedback, /editor\?\.commands\.focus\("end"\)/);
  assert.match(feedback, /window\.requestAnimationFrame\(restoreEditorFocus\)/);
  assert.match(feedback, /className="min-h-11 px-2 text-text-light-gray/);
});
