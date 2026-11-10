const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const flagKey = "htpr-8927-board-card-overflow";

test("overflow clamp ships as an Everyone bugfix with rollback", () => {
  const {
    default: definition,
    HTPR_8927_BOARD_CARD_OVERFLOW_FLAG,
  } = load("src/lib/flags/definitions/htpr-8927-board-card-overflow.ts", {});
  assert.equal(HTPR_8927_BOARD_CARD_OVERFLOW_FLAG, flagKey);
  assert.equal(definition.key, flagKey);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
});

test("kanban card and column code gates overflow classes on the ticket flag", () => {
  const sources = [
    read("src/components/PageComponents/Kanban/KanbanSectionComponents/section.tsx"),
    read("src/components/PageComponents/Kanban/KanbanTaskComponents/TaskDraggableContainer.tsx"),
    read("src/components/PageComponents/Kanban/KanbanTaskComponents/KanbanTaskCard.tsx"),
    read("src/components/PageComponents/Kanban/KanbanTaskComponents/TaskTagsRow.tsx"),
    read("src/components/PageComponents/Kanban/KanbanTaskComponents/BlockerChip.tsx"),
  ].join("\n");

  assert.match(sources, new RegExp(`useFlag\\(HTPR_8927_BOARD_CARD_OVERFLOW_FLAG\\)`));
  assert.match(sources, /cardOverflowClamp/);
  assert.match(
    read("src/components/PageComponents/Kanban/KanbanTaskComponents/TaskTagsRow.tsx"),
    /overflow-x-hidden/,
  );
});
