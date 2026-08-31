const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (relativePath) =>
  fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");

const attachments = read("src/components/Common/AttachmentsUpload/index.tsx");
const audioButton = read("src/components/RTE/Components/AudioButton.tsx");

// HTPR-5684 reverses what this test used to assert. It required the mic to
// stay the filled purple primary after typing, with Send as a neutral arrow
// beside it. Valentin's call: Send takes the right-hand slot the moment there
// is text. HTPR-5659: that slot swap must not recolour Send purple — it keeps
// the same neutral colour as the demoted mic. The empty-composer half of the
// old rule survives unchanged and is still checked here.
test("empty mobile comment composer keeps the microphone as the filled primary", () => {
  assert.match(
    audioButton,
    /isMobileCreateComment[\s\S]*?h-11 w-11[\s\S]*?bg-hypertasks-ai-purple/,
  );
});

test("typed mobile comments hand the primary slot to Send without a colour change", () => {
  // hasText has to be tested BEFORE the create-comment carve-out, or the
  // comment composer keeps a filled mic and the two primaries compete again.
  const branch = audioButton.match(
    /let prominentClassName =[\s\S]*?return \(/,
  );
  assert.ok(branch, "prominent styling branch must exist");
  assert.ok(
    branch[0].indexOf("hasText") < branch[0].indexOf("isMobileCreateComment"),
    "hasText must outrank the create-comment carve-out",
  );

  // HTPR-5659: Send takes the right-hand slot but keeps the demoted-mic colour.
  const send = attachments.match(
    /aria-label="Send comment"[\s\S]{0,400}?className="([^"]+)"/,
  );
  assert.ok(send, "Send button must exist");
  assert.match(send[1], /text-icon-dark-gray/);
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
