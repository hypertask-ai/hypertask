const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
});
const { CommandMode } = jiti(path.join(root, "src/models/enums.ts"));
const { getAllCommands } = jiti(
  path.join(root, "src/components/Modals/commands/HTC/AllCommands.ts")
);

test("comment commands already list Edit comment first", () => {
  const groups = getAllCommands({
    context: "Task",
    commentOptions: {
      isApple: false,
      isCurrentUserCreator: true,
      isPinned: false,
      isStarred: false,
    },
  });
  assert.equal(groups[0].group, "Comment");
  assert.equal(groups[0].commandLists[0].key, "editcomment");
  assert.equal(groups[0].commandLists[0].commandMode, CommandMode.EditComment);
});
