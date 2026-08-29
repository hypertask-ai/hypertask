const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/comment-stack-state-entry.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const {
  ensureAtLeastOneCommentIsOpen,
  processComments,
} = jiti(path.join(root, "src/utils/helperFunctions/TaskDetail/index.ts"));

const comment = (id, options = {}) => ({
  id,
  seen: [6],
  activity: null,
  ...options,
});

test("the newest actual comment remains open after a trailing activity row", () => {
  const comments = [
    comment(1),
    comment(2),
    comment(3, { activity: { type: "task-updated" } }),
  ];

  assert.deepEqual(processComments(comments, 6, true, ""), {
    0: true,
    1: false,
    2: true,
  });
});

test("collapsing every comment reopens the newest actual comment", () => {
  const comments = [comment(1), comment(2), comment(3)];

  assert.deepEqual(
    ensureAtLeastOneCommentIsOpen(comments, { 0: true, 1: true, 2: true }),
    { 0: true, 1: true, 2: false }
  );
});

test("deleting the open newest comment reopens the remaining newest comment", () => {
  const remainingComments = [comment(1), comment(2)];

  assert.deepEqual(
    ensureAtLeastOneCommentIsOpen(remainingComments, { 0: true, 1: true, 2: false }),
    { 0: true, 1: false, 2: false }
  );
});
