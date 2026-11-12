const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function railSectionShut(enabled, title, collapsed, searching) {
  return enabled && !searching && collapsed.includes(title);
}

test("a shut rail section stays shut, search opens it, and the flag off path stays open", () => {
  assert.equal(railSectionShut(true, "Today", ["Today"], false), true);
  assert.equal(railSectionShut(true, "Today", ["Today"], true), false);
  assert.equal(railSectionShut(true, "Older", ["Today"], false), false);
  assert.equal(railSectionShut(false, "Today", ["Today"], false), false);
  const chat = read("src/app/chat/Chat.tsx");
  assert.match(
    chat,
    /const shut = sectionsEnabled && searchQuery\.trim\(\)\.length === 0 && collapsedRailSections\.includes\(group\.title\);/,
  );
});

test("HTPR-9079 Older starts shut while Today and Previous 7 days stay open", () => {
  const store = read("src/store/index.ts");
  const collapsedAtom = store.match(
    /export const aiChatCollapsedRailSectionsAtom = atom<string\[\]>\(\{([\s\S]*?)\}\);/,
  );
  assert.ok(collapsedAtom, "the collapsed rail sections atom is missing");
  const defaultMatch = collapsedAtom[1].match(/default: \[([^\]]*)\]/);
  assert.ok(defaultMatch, "the collapsed rail sections atom has no list default");
  const defaults = defaultMatch[1]
    .split(",")
    .map((entry) => entry.trim().replace(/^["']|["']$/g, ""))
    .filter((entry) => entry.length > 0);
  assert.deepEqual(defaults, ["Older"]);
  assert.equal(railSectionShut(true, "Older", defaults, false), true);
  assert.equal(railSectionShut(true, "Today", defaults, false), false);
  assert.equal(railSectionShut(true, "Previous 7 days", defaults, false), false);
  assert.match(collapsedAtom[1], /effects_UNSTABLE: \[persistAtom\]/);
});

test("HTPR-8963 sidebar sections ship to Owner + QA", () => {
  const { default: flag } = loadModule("src/lib/flags/definitions/htpr-8963-sidebar-sections.ts");
  assert.equal(flag.key, "htpr-8963-sidebar-sections");
  assert.equal(flag.kind, "feature");
  assert.equal(flag.defaultMode, "OWNER_AND_QA");
  assert.equal(flag.releaseRisk.risk, "new");
  assert.equal(flag.releaseRisk.highRisk, undefined);
});

test("the chat rail toggles sections behind the flag and pins survive reload", () => {
  const chat = read("src/app/chat/Chat.tsx");
  assert.match(chat, /useFlag\(HTPR_8963_SIDEBAR_SECTIONS_FLAG\)/);
  assert.match(chat, /aria-expanded=\{!shut\}/);
  assert.match(chat, /sectionsEnabled \? \(/);
  assert.match(chat, /<h2 className=/);
  assert.match(chat, /sectionsEnabled && isPinned && \(/);
  assert.match(chat, /aria-label=\{isPinned \? "Unpin chat" : "Pin chat"\}/);
  assert.match(chat, /if \(!paged \|\| holdRailPaging \|\| !hasMoreSessions/);
  const store = read("src/store/index.ts");
  assert.match(
    store,
    /export const aiChatPinnedSessionIdsAtom = atom<string\[\]>\(\{[\s\S]*?effects_UNSTABLE: \[persistAtom\],/,
  );
  assert.match(
    store,
    /export const aiChatCollapsedRailSectionsAtom = atom<string\[\]>\(\{[\s\S]*?effects_UNSTABLE: \[persistAtom\],/,
  );
});
