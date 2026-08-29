const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const container = read(
  "src/components/PageComponents/TaskDetail/AI Task Writer/AITaskWriterContainer.tsx"
);
const options = read(
  "src/components/PageComponents/TaskDetail/AI Task Writer/AI_OPTIONS.tsx"
);

test("mobile result actions keep Accept and an editable-prompt Resend equally reachable", () => {
  assert.match(
    container,
    /onResend=\{isMobile \? handleMobileResend : undefined\}/,
    "mobile result state must pass its direct resend action"
  );
  assert.match(options, /aria-label="Resend with current prompt"/);
  assert.match(options, /\bResend\b/);
  assert.match(
    options,
    /min-h-\[44px\][\s\S]*?flex-1[\s\S]*?primaryActionLabel/,
    "Accept remains a 44px, equal-width mobile action"
  );
  assert.match(
    options,
    /min-h-\[44px\][\s\S]*?flex-1[\s\S]*?Resend/,
    "Resend remains a 44px, equal-width mobile action"
  );
});

test("resend cannot send an in-flight, empty, blocked, or uploading request", () => {
  assert.match(
    container,
    /if \(isLoading \|\| isByokBlocked \|\| isUploadingAttachments \|\| !userPrompt\.trim\(\)\) return;/
  );
  assert.match(
    container,
    /isResendDisabled=\{[\s\S]*?isLoading \|\| isByokBlocked \|\| isUploadingAttachments \|\| !userPrompt\.trim\(\)[\s\S]*?\}/
  );
});
