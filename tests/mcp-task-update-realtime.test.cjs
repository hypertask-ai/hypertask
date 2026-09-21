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

test("realtime delivery failures do not fail a persisted MCP task update", async () => {
  const deliveryFailure = new Error("board delivery failed");
  const warnings = [];
  const originalWarn = console.warn;
  let releaseTaskDelivery;
  const taskDelivery = new Promise((resolve) => {
    releaseTaskDelivery = resolve;
  });
  let settled = false;

  console.warn = (...args) => warnings.push(args);
  try {
    const pending = broadcastTaskUpdates(
      [{ id: 101, projectId: 15 }],
      6,
      {
        board: async () => {
          throw deliveryFailure;
        },
        task: async () => {
          await taskDelivery;
        },
      },
    ).then(() => {
      settled = true;
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    releaseTaskDelivery();
    await pending;

    assert.equal(settled, true);
    assert.deepEqual(warnings, [
      ["[MCP Update Task] Realtime delivery failed:", deliveryFailure],
    ]);
  } finally {
    console.warn = originalWarn;
  }
});
