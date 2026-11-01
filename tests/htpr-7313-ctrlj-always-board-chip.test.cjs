const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { fsCache: false });
const { resolveComposeBoardTarget } = jiti(path.join(root, "src/components/Modals/commands/HTC/composeBoardTarget.ts"));
const definition = jiti(path.join(root, "src/lib/flags/definitions/htpr-7313-ctrlj-always-board-chip.ts")).default;

function targetFor(url, extra = {}) {
  return resolveComposeBoardTarget({ url, lastUsedBoardId: 7, ...extra });
}

test("flag ships on for Everyone", () => {
  assert.equal(definition.key, "htpr-7313-ctrlj-always-board-chip");
  assert.equal(definition.defaultMode, "EVERYONE");
});

test("board and ticket pages resolve their own board, and hide the chip until the flag widens it", () => {
  for (const url of ["/project?id=8", "/project/8", "/detail/project-8/12"]) {
    assert.deepEqual(targetFor(url), { boardId: 8, showChip: false });
  }
});

test("inbox, search and my-tasks keep the last used board and show the chip", () => {
  for (const url of ["/inbox", "/search", "/my-tasks"]) {
    assert.deepEqual(targetFor(url), { boardId: 7, showChip: true });
  }
});

test("an explicit destination board wins over the contextual board", () => {
  assert.deepEqual(targetFor("/project?id=8", { destinationBoardId: 9 }), { boardId: 9, showChip: true });
  assert.deepEqual(targetFor("/detail/project-8/12", { focusedTicketBoardId: 11 }), { boardId: 8, showChip: false });
  assert.deepEqual(targetFor("/inbox", { focusedTicketBoardId: 11 }), { boardId: 11, showChip: true });
});
