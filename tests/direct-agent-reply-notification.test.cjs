const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { directReplyStateForNotification } = jiti(
  path.join(
    root,
    "src/utils/controllers/notifications/agentImportantPermission.ts",
  ),
);

test("direct replies create a durable Important notification", () => {
  assert.deepEqual(
    directReplyStateForNotification(
      {
        taskId: 27744,
        type: "Mentioned",
        fromAgentId: "agent-1",
        directReply: false,
      },
      { 27744: ["Mentioned"] },
      new Set(),
    ),
    { directReply: true, directReplyTypes: ["Mentioned"] },
  );
});
