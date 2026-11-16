const assert = require("node:assert/strict");
const { test } = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

const {
  OLDER_CHAT_RAIL_SECTION,
  railCollapsedSections,
  nextCollapsedRailSections,
} = loadModule("src/lib/aiChat/railSectionFold.ts");

test("a fresh or saved-empty chat list folds only Older", () => {
  for (const stored of [[], null]) {
    const shown = railCollapsedSections(stored, true);
    assert.equal(shown.includes(OLDER_CHAT_RAIL_SECTION), true);
    assert.equal(shown.includes("Today"), false);
    assert.equal(shown.includes("Previous 7 days"), false);
  }
  assert.deepEqual(railCollapsedSections([], false), []);
});

test("opening Older stays open after reload, and folding it stays shut", () => {
  const opened = nextCollapsedRailSections([], OLDER_CHAT_RAIL_SECTION, true, true);
  assert.equal(railCollapsedSections(opened, true).includes(OLDER_CHAT_RAIL_SECTION), false);
  const shutAgain = nextCollapsedRailSections(opened, OLDER_CHAT_RAIL_SECTION, false, true);
  assert.equal(railCollapsedSections(shutAgain, true).includes(OLDER_CHAT_RAIL_SECTION), true);
  const reopened = nextCollapsedRailSections(shutAgain, OLDER_CHAT_RAIL_SECTION, true, true);
  assert.equal(railCollapsedSections(reopened, true).includes(OLDER_CHAT_RAIL_SECTION), false);
});

test("other saved folds stay, and the flag off path does not fold Older by itself", () => {
  const shown = railCollapsedSections(["Today"], true);
  assert.equal(shown.includes("Today"), true);
  assert.equal(shown.includes(OLDER_CHAT_RAIL_SECTION), true);
  assert.equal(shown.includes("Previous 7 days"), false);
  assert.deepEqual(railCollapsedSections(["Today"], false), ["Today"]);
  assert.deepEqual(railCollapsedSections(["Older"], false), ["Older"]);
});

test("HTPR-9079 ships to everyone and can be switched off", () => {
  const { default: flag } = loadModule("src/lib/flags/definitions/htpr-9079-older-rail-folded.ts");
  assert.equal(flag.key, "htpr-9079-older-rail-folded");
  assert.equal(flag.kind, "improvement");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.releaseRisk.risk, "small");
  assert.equal(flag.releaseRisk.highRisk, undefined);
});
