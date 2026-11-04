const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadModule, root } = require("./helpers/loadModule.cjs");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const flagKey = "htpr-6940-drop-board-tabs";

test("the layout change has one client-safe definition that ships to everyone", () => {
  const definition = loadModule("src/lib/flags/definitions/htpr-6940-drop-board-tabs.ts").default;
  assert.equal(definition.key, flagKey);
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

test("each board section keeps its count and gains the overdue number", () => {
  const view = read("src/app/my-tasks/MyTasks.tsx");
  assert.match(view, /visibleSections\.map\(\(section\) => countMyTasksOverdue\(section\.items, new Date\(\)\)\)/);
  assert.match(view, /myTasksSectionOverdueCounts=\{sectionOverdueCounts\}/);
  const table = read("src/components/PageComponents/Kanban/TableView/TableView.tsx");
  assert.match(table, /length: rawItems\.length, hasUnseen: false, overdueCount: myTasksSectionOverdueCounts\?\.\[sectionIndex\] \?\? 0/);
});
