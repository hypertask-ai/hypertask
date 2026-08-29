const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const jitiModule = require("jiti");

const root = path.resolve(__dirname, "..");
const jitiOptions = {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
};
const jiti = jitiModule.createJiti
  ? jitiModule.createJiti(__filename, jitiOptions)
  : jitiModule(__filename, jitiOptions);
const { orderBoardsForSwitcher } = jiti(
  path.join(root, "src/lib/boardSwitcherOrder.ts"),
);

const board = (id, title) => ({ id, title, name: title });

// WHY: the switcher is a keyboard surface — you open it and press Enter on the
// first or second row. Creation order (HTPR-5476) put a board you last touched
// two years ago above the one you were in this morning, which makes the
// shortcut slower than clicking. Ordering is the whole feature.
test("the current board stays pinned at the top", () => {
  const boards = [board(1, "Alpha"), board(2, "Beta"), board(3, "Gamma")];
  const ordered = orderBoardsForSwitcher(
    boards,
    { 1: "2020-01-01T00:00:00.000Z", 3: "2026-08-18T00:00:00.000Z" },
    1,
  );
  assert.deepEqual(
    ordered.map((b) => b.id),
    [1, 3, 2],
  );
});

test("boards are ordered by most recent task activity", () => {
  const boards = [board(1, "Alpha"), board(2, "Beta"), board(3, "Gamma")];
  const ordered = orderBoardsForSwitcher(boards, {
    1: "2026-01-01T00:00:00.000Z",
    2: "2026-08-18T00:00:00.000Z",
    3: "2026-04-01T00:00:00.000Z",
  });
  assert.deepEqual(
    ordered.map((b) => b.id),
    [2, 3, 1],
  );
});

test("boards with no activity sort last, alphabetically", () => {
  const boards = [board(1, "Zulu"), board(2, "Alpha"), board(3, "Live")];
  const ordered = orderBoardsForSwitcher(boards, {
    3: "2026-08-18T00:00:00.000Z",
    1: null,
  });
  assert.deepEqual(
    ordered.map((b) => b.id),
    [3, 2, 1],
  );
});

test("an unparseable timestamp is treated as no activity, not as newest", () => {
  const boards = [board(1, "Alpha"), board(2, "Beta")];
  const ordered = orderBoardsForSwitcher(boards, {
    1: "not-a-date",
    2: "2026-08-18T00:00:00.000Z",
  });
  assert.deepEqual(
    ordered.map((b) => b.id),
    [2, 1],
  );
});
