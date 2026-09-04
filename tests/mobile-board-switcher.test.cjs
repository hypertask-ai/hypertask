const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const sheet = fs.readFileSync(
  path.join(root, "src/components/Global/MobileTitleSheet.tsx"),
  "utf8",
);
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
  moduleCache: false,
});
const {
  filterBoardsForSwitcher,
  getMobileBoardSwitcherOptions,
  getMobileBoardOptionId,
  getNextMobileBoardSelection,
} = jiti(path.join(root, "src/lib/mobileBoardSwitcher.ts"));

const board = (id, title) => ({ id, title, name: title });

test("mobile board search keeps activity order and filters by board name", () => {
  const boards = [board(1, "Alpha"), board(2, "Beta"), board(3, "Gamma")];
  const filtered = filterBoardsForSwitcher(
    boards,
    {
      1: "2026-01-01T00:00:00.000Z",
      2: "2026-08-18T00:00:00.000Z",
      3: "2026-04-01T00:00:00.000Z",
    },
    1,
    "  gaM  ",
  );

  assert.deepEqual(
    filtered.map((item) => item.id),
    [3],
  );
});

test("mobile board search returns an empty result for no matches", () => {
  assert.deepEqual(
    filterBoardsForSwitcher(
      [board(1, "Alpha"), board(2, "Beta")],
      {},
      undefined,
      "missing",
    ),
    [],
  );
});

test("mobile switcher waits for activity before exposing its first board order", () => {
  const boards = [board(1, "Alpha"), board(2, "Beta"), board(3, "Gamma")];
  const lastActivity = {
    1: "2026-01-01T00:00:00.000Z",
    2: "2026-08-18T00:00:00.000Z",
    3: "2026-04-01T00:00:00.000Z",
  };

  assert.deepEqual(
    getMobileBoardSwitcherOptions({
      projects: boards,
      lastActivity: null,
      currentProjectId: undefined,
      keyword: "",
    }),
    [],
    "the fallback alphabetical order must never be visible while activity loads",
  );
  assert.deepEqual(
    getMobileBoardSwitcherOptions({
      projects: boards,
      lastActivity,
      currentProjectId: undefined,
      keyword: "",
    }).map((item) => item.id),
    [2, 3, 1],
  );
});

test("mobile board keyboard selection stays within the filtered list", () => {
  assert.equal(getNextMobileBoardSelection(0, 3, "ArrowUp"), 0);
  assert.equal(getNextMobileBoardSelection(0, 3, "ArrowDown"), 1);
  assert.equal(getNextMobileBoardSelection(2, 3, "ArrowDown"), 2);
  assert.equal(getNextMobileBoardSelection(2, 3, "ArrowUp"), 1);
  assert.equal(getNextMobileBoardSelection(0, 0, "ArrowDown"), 0);
});

test("mobile switcher wires focus, filtering, selection, and Enter navigation", () => {
  assert.match(sheet, /<ModalInput[\s\S]*autoFocus/);
  assert.match(sheet, /keyboardAware/);
  assert.match(sheet, /getMobileBoardSwitcherOptions\(/);
  assert.match(sheet, /getNextMobileBoardSelection\(/);
  assert.match(sheet, /event\.key === "Enter"/);
  assert.match(sheet, /goToProjectShortcut\(board\.id, true\)/);
  assert.match(sheet, /role="option"/);
  assert.match(sheet, /aria-selected=\{index === selectedIndex\}/);
});

test("mobile board rows have stable ids for keyboard scrolling", () => {
  assert.equal(getMobileBoardOptionId(42), "mobile-board-option-42");
  assert.match(sheet, /getMobileBoardOptionId\(board\.id\)/);
});
