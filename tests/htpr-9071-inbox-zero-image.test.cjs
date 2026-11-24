const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const flagKey = "htpr-9071-inbox-zero-image";
const gateFile = "src/lib/inboxSplitTabs.ts";

function load(file) {
  assert.ok(fs.existsSync(path.join(root, file)), `${file} is missing on this commit`);
  return loadModule(file);
}

function gate(overrides) {
  const { hidesInboxZeroSplitTabs } = load(gateFile);
  return hidesInboxZeroSplitTabs({
    enabled: true,
    isInboxZero: true,
    splitLengths: [0, 0],
    unsavedCommentDrafts: 0,
    ...overrides,
  });
}

test("the flag is a bugfix that starts on for everyone", () => {
  const { default: flag, HTPR_9071_INBOX_ZERO_IMAGE_FLAG: exported } = load(
    "src/lib/flags/definitions/htpr-9071-inbox-zero-image.ts",
  );
  assert.equal(exported, flagKey);
  assert.equal(flag.key, flagKey);
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.releaseRisk.risk, "small");
});

test("the inbox page wraps the top bar, the footer tabs and the phone dock in the gate", () => {
  const inbox = fs.readFileSync(path.join(root, "src/app/inbox/Inbox.tsx"), "utf8");
  assert.match(inbox, /useFlag\(HTPR_9071_INBOX_ZERO_IMAGE_FLAG\)/);
  assert.match(inbox, /hidesInboxZeroSplitTabs\(\{ enabled: hideInboxZeroTabs, isInboxZero, splitLengths, unsavedCommentDrafts \}\)/);
  assert.equal((inbox.match(/<SplitTabsUnlessInboxZero/g) ?? []).length, 3);
  assert.equal((inbox.match(/<\/SplitTabsUnlessInboxZero>/g) ?? []).length, 3);
});

test("a fully empty inbox drops the split tabs", () => {
  assert.equal(gate({}), true);
  assert.equal(gate({ splitLengths: [0] }), true);
  assert.equal(gate({ splitLengths: [0, 0, 0, 0] }), true);
});

test("tabs stay when a split still has something, a draft remains, or the inbox is not empty", () => {
  assert.equal(gate({ splitLengths: [0, 2] }), false);
  assert.equal(gate({ unsavedCommentDrafts: 1 }), false);
  assert.equal(gate({ isInboxZero: false }), false);
  assert.equal(gate({ splitLengths: [4, 0] }), false);
});

test("tabs stay with the flag off, and stay before the split lengths are known", () => {
  assert.equal(gate({ enabled: false }), false);
  assert.equal(gate({ splitLengths: [] }), false);
});
