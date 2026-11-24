const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const flagKey = "htpr-9071-inbox-zero-image";
const inbox = fs.readFileSync(path.join(root, "src/app/inbox/Inbox.tsx"), "utf8");
const { hidesInboxZeroSplitTabs } = loadModule("src/lib/inboxSplitTabs.ts");

const hidden = (overrides = {}) =>
  hidesInboxZeroSplitTabs({ enabled: true, isInboxZero: true, splitLengths: [0, 0], unsavedCommentDrafts: 0, ...overrides });

test("the flag is a bugfix that starts on for everyone", () => {
  const { default: flag, HTPR_9071_INBOX_ZERO_IMAGE_FLAG: exported } = loadModule(
    "src/lib/flags/definitions/htpr-9071-inbox-zero-image.ts",
  );
  assert.equal(exported, flagKey);
  assert.equal(flag.key, flagKey);
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.releaseRisk.risk, "small");
});

test("the inbox page gates the split tabs on the flag and the gate", () => {
  assert.match(inbox, /useFlag\(HTPR_9071_INBOX_ZERO_IMAGE_FLAG\)/);
  assert.match(inbox, /hidesInboxZeroSplitTabs\(\{ enabled: hideInboxZeroTabs, isInboxZero, splitLengths, unsavedCommentDrafts \}\)/);
  assert.equal((inbox.match(/<SplitTabsUnlessInboxZero/g) ?? []).length, 3);
  assert.equal((inbox.match(/<\/SplitTabsUnlessInboxZero>/g) ?? []).length, 3);
});

test("a fully empty inbox drops the split tabs", () => {
  assert.equal(hidden(), true);
  assert.equal(hidden({ splitLengths: [0] }), true);
  assert.equal(hidden({ splitLengths: [0, 0, 0, 0] }), true);
});

test("tabs stay when a split still has something, a draft remains, or the inbox is not empty", () => {
  assert.equal(hidden({ splitLengths: [0, 2] }), false);
  assert.equal(hidden({ unsavedCommentDrafts: 1 }), false);
  assert.equal(hidden({ isInboxZero: false }), false);
  assert.equal(hidden({ splitLengths: [4, 0] }), false);
});

test("tabs stay with the flag off, and stay before the split lengths are known", () => {
  assert.equal(hidden({ enabled: false }), false);
  assert.equal(hidden({ splitLengths: [] }), false);
});
