const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(
    __dirname,
    "../src/components/Common/AttachmentsUpload/index.tsx",
  ),
  "utf8",
);

// HTPR-5684 retired IOSend: Send is now the filled primary and uses the shared
// SendArrow. The behaviour this test guards is unchanged — Send must fire on a
// completed click, never on onTouchEnd, which posted before the tap finished.
const saveButtonStart = source.indexOf("const SaveButtonMobile");
const sendIconStart = source.indexOf("<SendArrow", saveButtonStart);
const saveButtonSource = source.slice(saveButtonStart);
const mobileCommentSend = saveButtonSource.match(
  /mode === "create-comment" \? \([\s\S]*?<SendArrow[\s\S]*?<\/button>/,
)?.[0];

test("mobile comment Send waits for click before posting", () => {
  assert.notEqual(saveButtonStart, -1, "SaveButtonMobile was not found");
  assert.notEqual(sendIconStart, -1, "SendArrow was not found in SaveButtonMobile");
  assert.ok(mobileCommentSend, "mobile comment Send button was not found");
  assert.match(mobileCommentSend, /<button/);
  assert.match(mobileCommentSend, /type="button"/);
  assert.match(mobileCommentSend, /onClick=/);
  assert.match(mobileCommentSend, /e\.stopPropagation\(\)/);
  assert.doesNotMatch(mobileCommentSend, /onTouchEnd=/);
});
