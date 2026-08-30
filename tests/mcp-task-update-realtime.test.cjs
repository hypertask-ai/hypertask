const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { broadcastTaskUpdates } = jiti(
  path.join(root, "src/lib/mcp/tasks/broadcastTaskUpdates.ts"),
);

test("MCP task updates wait for board and task realtime delivery attempts", async () => {
  const calls = [];
  let releaseDelivery;
  const delivery = new Promise((resolve) => {
    releaseDelivery = resolve;
  });
  let settled = false;

  const pending = broadcastTaskUpdates(
    [
      { id: 101, projectId: 15 },
      { id: 102, projectId: 15 },
    ],
    6,
    {
      board: async (projectId, payload) => {
        calls.push(["board", projectId, payload]);
        await delivery;
      },
      task: async (taskId, payload) => {
        calls.push(["task", taskId, payload]);
        await delivery;
      },
    },
  ).then(() => {
    settled = true;
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.deepEqual(calls, [
    ["board", 15, { originUserId: 6 }],
    ["task", 101, { originUserId: 6 }],
    ["task", 102, { originUserId: 6 }],
  ]);

  releaseDelivery();
  await pending;
  assert.equal(settled, true);
});
