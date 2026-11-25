const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const {
  OLDER_CHAT_RAIL_SECTION,
  railCollapsedSections,
  nextCollapsedRailSections,
} = loadModule("src/lib/aiChat/railSectionFold.ts");

const folded = (stored, foldOlderByDefault = true) =>
  railCollapsedSections({ stored, foldOlderByDefault }).includes(
    OLDER_CHAT_RAIL_SECTION,
  );

const toggle = (stored, title, wasShut, foldOlderByDefault = true) =>
  nextCollapsedRailSections({ stored, title, wasShut, foldOlderByDefault });

test("a fresh or saved-empty chat list folds only Older", () => {
  for (const stored of [[], null]) {
    assert.equal(folded(stored), true);
    const shown = railCollapsedSections({ stored, foldOlderByDefault: true });
    assert.equal(shown.includes("Today"), false);
    assert.equal(shown.includes("Previous 7 days"), false);
  }
});

test("with the flag off every fresh group stays open", () => {
  for (const stored of [[], null]) {
    assert.deepEqual(
      railCollapsedSections({ stored, foldOlderByDefault: false }),
      [],
    );
  }
  assert.deepEqual(
    railCollapsedSections({ stored: ["Today"], foldOlderByDefault: false }),
    ["Today"],
  );
});

test("opening Older stays open after reload, and folding it stays shut", () => {
  const opened = toggle([], OLDER_CHAT_RAIL_SECTION, true);
  assert.equal(folded(opened), false);
  const shutAgain = toggle(opened, OLDER_CHAT_RAIL_SECTION, false);
  assert.equal(folded(shutAgain), true);
  const reopened = toggle(shutAgain, OLDER_CHAT_RAIL_SECTION, true);
  assert.equal(folded(reopened), false);
});

test("other saved folds stay, and a fold already saved before the flag stays", () => {
  const shown = railCollapsedSections({
    stored: ["Today"],
    foldOlderByDefault: true,
  });
  assert.equal(shown.includes("Today"), true);
  assert.equal(shown.includes(OLDER_CHAT_RAIL_SECTION), true);
  assert.equal(shown.includes("Previous 7 days"), false);
  assert.deepEqual(
    railCollapsedSections({ stored: ["Older"], foldOlderByDefault: false }),
    ["Older"],
  );
  assert.equal(
    toggle(["Today"], "Today", true, false).includes("Today"),
    false,
  );
});

test("the full screen rail applies the flag to the saved fold list", () => {
  const chat = read("src/app/chat/Chat.tsx");
  assert.match(chat, /useFlag\(HTPR_9079_OLDER_RAIL_FOLDED_FLAG\)/);
  assert.match(chat, /const collapsedRailSections = railCollapsedSections\(\{/);
  assert.match(chat, /foldOlderByDefault: olderStartsShut/);
  assert.match(chat, /nextCollapsedRailSections\(\{/);
});

test("HTPR-9079 ships to everyone and can be switched off", () => {
  const { default: flag } = loadModule("src/lib/flags/definitions/htpr-9079-older-rail-folded.ts");
  assert.equal(flag.key, "htpr-9079-older-rail-folded");
  assert.equal(flag.kind, "improvement");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.releaseRisk.risk, "small");
  assert.equal(flag.releaseRisk.highRisk, undefined);
});
