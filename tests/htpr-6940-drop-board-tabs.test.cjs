const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createJiti } = require("jiti");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const load = createJiti(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true });
const definitionModule = load(path.join(root, "src/lib/flags/definitions/htpr-6940-drop-board-tabs.ts"));

const definition = definitionModule.default ?? definitionModule;
let flagMode = null;
const prismaPath = path.join(root, "src/lib/prisma.ts");
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { default: {
  featureFlag: { findUnique: async () => flagMode ? { mode: flagMode } : null },
  user: { findUnique: async ({ where }) => ({ email: where.id === 985 ? "valentin@hypertask.ai" : where.id === 6 ? "valentin.yeo@gmail.com" : "person@example.invalid" }) },
} } };
const flags = load(path.join(root, "src/lib/flags.ts"));

test("all four modes honor the owner, QA and ordinary user boundary", async () => {
  for (const [mode, expected] of [
    [null, [true, true, false]], ["OFF", [false, false, false]],
    ["OWNER_ONLY", [true, false, false]], ["OWNER_AND_QA", [true, true, false]], ["EVERYONE", [true, true, true]],
  ]) {
    flagMode = mode;
    assert.deepEqual(await Promise.all([6, 985, 7].map((id) => flags.isFeatureEnabled(definition.key, id, { ...require.cache[prismaPath].exports.default }))), expected, String(mode));
  }
  flagMode = null;
});

test("the layout change has one client-safe definition that ships to everyone", () => {
  assert.equal(definition.key, "htpr-6940-drop-board-tabs");
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
  const source = read("src/lib/flags/definitions/htpr-6940-drop-board-tabs.ts");
  assert.doesNotMatch(source, /prisma|process\.env|server-only/);
  const files = fs.readdirSync(path.join(root, "src/lib/flags/definitions")).filter((file) => file.includes("6940"));
  assert.deepEqual(files, ["htpr-6940-drop-board-tabs.ts"]);
});

test("On hides the board tab row on desktop and phone and shows every board section", () => {
  const view = read("src/app/my-tasks/MyTasks.tsx");
  assert.match(view, /useFlag\(HTPR_6940_DROP_BOARD_TABS_FLAG\)/);
  assert.match(view, /const splitIndex = boardTabsHidden \? 0 : activeSplit;/);
  assert.match(view, /if \(splitIndex === 0\) return filteredSections;/);
  assert.equal(view.match(/data-testid="my-tasks-splits-desktop"/g).length, 1);
  assert.equal(view.match(/data-testid="my-tasks-splits-phone"/g).length, 1);
  assert.match(view, /\{!boardTabsHidden && \(\s*<div data-testid="my-tasks-splits-desktop"/);
  assert.match(view, /\{!boardTabsHidden && \(\s*<div data-testid="my-tasks-splits-phone"/);
});

test("On stops board tab picking and the remembered board, Off restores both", () => {
  const view = read("src/app/my-tasks/MyTasks.tsx");
  assert.match(view, /const updateSplit = useCallback\(\s*\(index: number\) => \{\s*if \(boardTabsHidden\) return;/);
  assert.match(view, /boardTabsHidden \|\|\s*event\.key !== "Tab"/);
  assert.match(view, /const restoreBoard = !boardTabsHidden && entryParams\.current\.board === null/);
});
