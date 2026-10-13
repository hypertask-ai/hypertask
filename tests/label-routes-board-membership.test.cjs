// HTPR-7177: a signed-in user who is not a member or owner of a board must
// not be able to add labels to it or change labels on its tasks.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let loadId = 0;

const OUTSIDER = 7;
const MEMBER = 8;
const BOARD = 15;

const stubModule = (relativePath, exports) => {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};

const loadRoute = (relativePath, writes, userId) => {
  delete require.cache[path.join(root, relativePath)];
  const tx = {
    $queryRaw: async (strings) => {
      const sql = strings.join("?");
      if (sql.includes('FROM "Task"')) return [{ id: 1, projectId: BOARD }];
      if (sql.includes('FROM "Label"')) return [{ projectId: BOARD }];
      return [];
    },
    label: {
      findFirst: async () => null,
      create: async ({ data }) => {
        writes.push("label.create");
        return { id: "new-label", value: data.value, projectId: data.projectId };
      },
    },
    taskLabel: {
      findMany: async () => [],
      findFirst: async () =>
        writes.includes("label.create")
          ? { id: "tl", taskId: 1, labelId: "new-label", label: { id: "new-label", value: "x" } }
          : null,
      create: async () => {
        writes.push("taskLabel.create");
        return { id: "tl", label: { id: "l", value: "x" } };
      },
      delete: async () => writes.push("taskLabel.delete"),
    },
  };
  const stubs = {
    "src/lib/prisma.ts": {
      default: {
        ...tx,
        user: { findUnique: async () => ({ id: userId, displayName: "U" }) },
        $transaction: async (operation) => operation(tx),
      },
    },
    "src/lib/auth/getSessionUser.ts": {
      getSessionUser: async () => ({ userId, source: "better-auth" }),
    },
    "src/lib/mcp/tasks/services.ts": {
      validateProjectMemberIds: async (projectId, userIds) => ({
        invalidIds: userIds.filter((id) => !(projectId === BOARD && id === MEMBER)),
        error: null,
      }),
    },
    "src/utils/controllers/activities/createLabelActivity.ts": {
      default: async () => writes.push("activity"),
    },
    "src/lib/realtime/server.ts": {
      broadcastBoardChange: async () => {},
      broadcastTaskChange: async () => {},
    },
    "src/lib/ai/labelClassifier.ts": { scheduleBackfillAiLabel: () => {} },
    "src/lib/agentWebhooks/outbox.ts": {
      persistAgentTaskUpdatedWebhook: async () => [],
      publishAgentWebhookDeliveries: async () => {},
    },
  };
  for (const [stubPath, exports] of Object.entries(stubs)) stubModule(stubPath, exports);
  const jiti = require("jiti")(
    path.join(root, `tests/label-routes-board-membership-${++loadId}.cjs`),
    { interopDefault: true, alias: { "@": path.join(root, "src") }, cache: false },
  );
  return jiti(path.join(root, relativePath)).default;
};

const call = async (route, userId, body) => {
  const writes = [];
  const handler = loadRoute(route, writes, userId);
  const result = { statusCode: null, body: null };
  await handler(
    { method: "POST", headers: {}, body },
    {
      status(code) { result.statusCode = code; return this; },
      setHeader() {},
      json(value) { result.body = value; return this; },
    },
  );
  return { ...result, writes };
};

const createRoute = "src/pages/api/labels/createLabel.ts";
const assignRoute = "src/pages/api/labels/assignLabel.ts";

test("createLabel refuses an outsider without ai_prompt (board only)", async () => {
  const r = await call(createRoute, OUTSIDER, { projectId: BOARD, value: "x", CreateLabelAndReturn: true });
  assert.equal(r.statusCode, 403);
  assert.deepEqual(r.writes, []);
});

test("createLabel refuses an outsider without ai_prompt (on a task)", async () => {
  const r = await call(createRoute, OUTSIDER, { projectId: BOARD, value: "x", taskId: 1 });
  assert.equal(r.statusCode, 403);
  assert.deepEqual(r.writes, []);
});

test("createLabel still works for a board member", async () => {
  const board = await call(createRoute, MEMBER, { projectId: BOARD, value: "x", CreateLabelAndReturn: true });
  assert.equal(board.statusCode, 200);
  assert.deepEqual(board.writes, ["label.create"]);
  const onTask = await call(createRoute, MEMBER, { projectId: BOARD, value: "x", taskId: 1 });
  assert.equal(onTask.statusCode, 200);
  assert.ok(onTask.writes.includes("label.create"));
});

test("assignLabel refuses an outsider on another board's task", async () => {
  const r = await call(assignRoute, OUTSIDER, { taskId: 1, labelId: "l" });
  assert.equal(r.statusCode, 403);
  assert.deepEqual(r.writes, []);
});

test("assignLabel still toggles a label for a board member", async () => {
  const r = await call(assignRoute, MEMBER, { taskId: 1, labelId: "l" });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.writes, ["taskLabel.create", "activity"]);
});
