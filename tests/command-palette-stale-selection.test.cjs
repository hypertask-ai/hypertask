const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
});
const { findCommandPosition } = jiti(
  path.join(
    root,
    "src/components/Modals/commands/HTC/commandSelection.ts",
  ),
);

const command = (key, name = key) => ({ key, name, commandMode: 1 });

test("command selection follows the hovered command when filtered groups collapse", () => {
  const hovered = command("reply", "Reply to comment");
  const filteredGroups = [{
    group: "Results",
    commandLists: [command("archive"), hovered],
  }];

  assert.deepEqual(findCommandPosition(filteredGroups, hovered, 4), {
    command: hovered,
    groupIndex: 0,
    commandIndex: 1,
  });
});

test("command selection rejects commands removed by filtering", () => {
  const filteredGroups = [{
    group: "Results",
    commandLists: [command("archive")],
  }];

  assert.equal(
    findCommandPosition(filteredGroups, command("reply", "Reply to comment"), 4),
    null,
  );
});

test("command selection preserves the preferred duplicate group", () => {
  const duplicate = command("archive", "Archive task");
  const groups = [
    { group: "Frequently used", commandLists: [duplicate] },
    { group: "Task", commandLists: [duplicate] },
  ];

  assert.deepEqual(findCommandPosition(groups, duplicate, 1), {
    command: duplicate,
    groupIndex: 1,
    commandIndex: 0,
  });
});

test("command selection safely rejects missing data and changed dynamic labels", () => {
  const groups = [{
    group: "Comment",
    commandLists: [command("reply", "Reply to comment")],
  }];

  assert.equal(findCommandPosition(groups, null, Number.NaN), null);
  assert.equal(findCommandPosition(null, command("reply"), -1), null);
  assert.equal(
    findCommandPosition(groups, command("reply", "Edit comment"), 0),
    null,
  );
});
