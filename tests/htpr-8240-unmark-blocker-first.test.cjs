const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

const commandMode = new Proxy({}, {
  get: (_target, name) => (typeof name === "string" ? name : undefined),
});

const { getCommentCommands } = loadModule(
  "src/components/Modals/commands/HTC/taskCommands.ts",
  {
    "@/models/enums": { CommandMode: commandMode },
    "@/models/model": {},
    "./HTCTypes": {},
    "@/lib/shortcuts/shareTaskShortcuts": { shareTaskShortcutKeys: () => [] },
  }
);

const commentOptions = ({
  isBlocker = false,
  blockerCommentEnabled = true,
  isCurrentUserCreator = true,
} = {}) => ({
  isApple: false,
  isCurrentUserCreator,
  isPinned: false,
  isStarred: false,
  blockerCommentEnabled,
  isBlocker,
});

function commentCommands(options) {
  return getCommentCommands({ commentOptions: options }).commandLists;
}

test("a blocker comment puts Unmark as blocker first in the comment actions", () => {
  const commands = commentCommands(commentOptions({ isBlocker: true }));
  assert.equal(commands[0].name, "Unmark as blocker");
  assert.equal(commands[0].commandMode, "BlockerComment");
  assert.equal(
    commands.filter((command) => command.key === "blockerComment").length,
    1
  );
});

test("an unmarked comment keeps the blocker action after Pin and still offers Mark as blocker", () => {
  const commands = commentCommands(commentOptions({ isBlocker: false }));
  const keys = commands.map((command) => command.key);
  assert.notEqual(keys[0], "blockerComment");
  assert.equal(keys.indexOf("blockerComment"), keys.indexOf("pinComment") + 1);
  assert.equal(
    commands.find((command) => command.key === "blockerComment").name,
    "Mark as blocker"
  );
});

test("flag off leaves the comment actions exactly as they were", () => {
  const commands = commentCommands(
    commentOptions({ isBlocker: true, blockerCommentEnabled: false })
  );
  assert.deepEqual(
    commands.map((command) => command.key),
    [
      "editcomment",
      "summarizeComment",
      "fastLikeComment",
      "replyToComment",
      "reactToComment",
      "pinComment",
      "copyCommentContent",
      "copyCommentLink",
      "starComment",
      "createTaskFromComment",
      "branchInNewChat",
      "copyCommentToAiChat",
      "deletemessage",
    ]
  );
});
