const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const definition = read("src/lib/flags/definitions/htpr-8274-remove-shortcut-tip.ts");
const providers = read("src/components/ProviderGlobal/GloablProviders.tsx");

function mountLine() {
  return providers.split("\n").filter((line) => line.includes("<ShortcutArchiveNudge"));
}

test("the shortcut tip removal is one ticket flag, on for everyone", () => {
  assert.match(definition, /key: HTPR_8274_REMOVE_SHORTCUT_TIP_FLAG/);
  assert.match(definition, /"htpr-8274-remove-shortcut-tip"/);
  assert.match(definition, /defaultMode: "EVERYONE"/);
});

test("the tip is mounted only while the removal flag is off", () => {
  const lines = mountLine();
  assert.equal(lines.length, 1, `expected one tip mount, found ${lines.length}`);
  assert.match(lines[0], /\{!shortcutTipRemoved && <ShortcutArchiveNudge \/>\}/);
  assert.match(providers, /const shortcutTipRemoved = useFlag\(HTPR_8274_REMOVE_SHORTCUT_TIP_FLAG\);/);
});

test("archiving and the bottom quick-tips bar do not depend on the removal flag", () => {
  const inbox = read("src/components/notifications/inboxSplit/index.tsx");
  assert.ok(inbox.includes("markAsDone("));
  assert.equal(inbox.includes("HTPR_8274_REMOVE_SHORTCUT_TIP"), false);
  const bar = read("src/components/Global/BottomSettings_QuickTips.tsx");
  assert.ok(bar.includes("showQuickTipsAtom"));
  assert.equal(bar.includes("HTPR_8274_REMOVE_SHORTCUT_TIP"), false);
});
