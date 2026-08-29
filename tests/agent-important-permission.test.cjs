const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(
  path.join(root, "tests/agent-important-permission.test.cjs"),
  { interopDefault: true, alias: { "@": path.join(root, "src") } },
);
const {
  agentIdsRequiringImportantPermission,
  directReplyStateForNotification,
  directReplyTypesByTask,
} = jiti(
  path.join(
    root,
    "src/utils/controllers/notifications/agentImportantPermission.ts",
  ),
);

test("postsToImportant=false removes only that agent's direct-reply bypass", () => {
  const result = directReplyTypesByTask(
    [
      { taskId: 10, type: "Mentioned", fromAgentId: "muted-agent" },
      { taskId: 11, type: "Mentioned", fromAgentId: "allowed-agent" },
    ],
    new Set(["muted-agent"]),
  );

  assert.deepEqual(result, { 11: ["Mentioned"] });
});

test("permission loading includes agents found only on direct-reply rows", () => {
  const result = agentIdsRequiringImportantPermission(
    [{ fromAgentId: "page-agent" }],
    [{ fromAgentId: "direct-reply-only-agent" }],
    [{ fromAgentId: null }],
  );

  assert.deepEqual(result, ["page-agent", "direct-reply-only-agent"]);
});

test("allowed direct replies remain deduplicated by task and type", () => {
  const result = directReplyTypesByTask(
    [
      { taskId: 11, type: "Mentioned", fromAgentId: "allowed-agent" },
      { taskId: 11, type: "Mentioned", fromAgentId: "allowed-agent" },
    ],
    new Set(),
  );

  assert.deepEqual(result, { 11: ["Mentioned"] });
});

test("the selected direct-reply row keeps its marker when no aggregate row is returned", () => {
  const result = directReplyStateForNotification(
    {
      taskId: 11,
      type: "Mentioned",
      fromAgentId: "allowed-agent",
      directReply: true,
    },
    {},
    new Set(),
  );

  assert.deepEqual(result, {
    directReply: true,
    directReplyTypes: ["Mentioned"],
  });
});

test("the selected direct-reply row respects postsToImportant=false", () => {
  const result = directReplyStateForNotification(
    {
      taskId: 11,
      type: "Mentioned",
      fromAgentId: "muted-agent",
      directReply: true,
    },
    {},
    new Set(["muted-agent"]),
  );

  assert.deepEqual(result, {
    directReply: false,
    directReplyTypes: [],
  });
});

test("a denied agent does not inherit an allowed agent's task marker", () => {
  const result = directReplyStateForNotification(
    {
      taskId: 11,
      type: "Mentioned",
      fromAgentId: "muted-agent",
      directReply: true,
    },
    { 11: ["Mentioned"] },
    new Set(["muted-agent"]),
  );

  assert.deepEqual(result, {
    directReply: false,
    directReplyTypes: [],
  });
});

test("a taskless direct reply keeps its Important marker", () => {
  const result = directReplyStateForNotification(
    {
      taskId: null,
      type: "Mentioned",
      fromAgentId: "allowed-agent",
      directReply: true,
    },
    {},
    new Set(),
  );

  assert.deepEqual(result, {
    directReply: true,
    directReplyTypes: ["Mentioned"],
  });
});

test("a taskless direct reply still respects postsToImportant=false", () => {
  const result = directReplyStateForNotification(
    {
      taskId: null,
      type: "Mentioned",
      fromAgentId: "muted-agent",
      directReply: true,
    },
    {},
    new Set(["muted-agent"]),
  );

  assert.deepEqual(result, {
    directReply: false,
    directReplyTypes: [],
  });
});
