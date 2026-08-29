const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let entryId = 0;

const stubbedModulePaths = [
  "src/lib/auth/getSessionUser.ts",
  "src/lib/prisma.ts",
  "src/lib/realtime/server.ts",
  "src/utils/controllers/projects/views/viewsHelperAPIfunctions.ts",
];

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  delete require.cache[filename];
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

function response() {
  const result = { statusCode: 200, body: undefined };
  return {
    result,
    status(code) {
      result.statusCode = code;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
  };
}

function loadRoute({
  existingUnsavedViewId = "unsaved-1",
  transactionFailures = 0,
} = {}) {
  const operations = [];
  const tx = {
    project: {
      findFirst: async () => {
        operations.push(["authorize-project"]);
        return { id: 2495 };
      },
    },
    project_View: {
      upsert: async () => {
        operations.push(["upsert-project-view"]);
        return { id: "project-view-1", projectId: 2495 };
      },
    },
    user_Project_View: {
      upsert: async (args) => {
        operations.push(["upsert-user-view", args]);
        return { id: "user-view-1" };
      },
      update: async (args) => {
        operations.push(["update-user-view", args]);
      },
    },
    $queryRaw: async () => {
      operations.push(["lock-user-view"]);
      return [{ unsavedViewId: existingUnsavedViewId ?? null }];
    },
    view_Last_Used: {
      deleteMany: async (args) => {
        operations.push(["delete-last-used", args]);
      },
    },
    view: {
      deleteMany: async (args) => {
        operations.push(["delete-view", args]);
      },
    },
  };
  const prismaStub = {
    $transaction: async (operation, options) => {
      operations.push(["transaction-options", options]);
      if (transactionFailures > 0) {
        transactionFailures -= 1;
        throw Object.assign(new Error("serialization conflict"), {
          code: "P2034",
        });
      }
      return operation(tx);
    },
  };

  for (const relativePath of stubbedModulePaths) {
    delete require.cache[path.join(root, relativePath)];
  }
  stubModule("src/lib/auth/getSessionUser.ts", {
    getSessionUser: async () => ({ userId: 6, source: "better-auth" }),
  });
  stubModule("src/lib/prisma.ts", { default: prismaStub });
  stubModule("src/lib/realtime/server.ts", {
    broadcastBoardChange: () => operations.push(["broadcast"]),
  });
  stubModule(
    "src/utils/controllers/projects/views/viewsHelperAPIfunctions.ts",
    { default: async () => ({ id: "project-view-1" }) },
  );

  const jiti = require("jiti")(
    path.join(root, `tests/reset-view-jiti-${++entryId}.cjs`),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
      cache: false,
    },
  );
  const loaded = jiti(
    path.join(root, "src/pages/api/projects/views/reset-to-default.ts"),
  );
  return {
    handler: loaded.default ?? loaded,
    resetUserProjectViewState: loaded.resetUserProjectViewState,
    runSerializableViewReset: loaded.runSerializableViewReset,
    operations,
    prismaStub,
  };
}

test("reset detaches a transient view before deleting it", async () => {
  const { handler, operations } = loadRoute();
  const res = response();

  await handler(
    {
      method: "POST",
      headers: {},
      body: { projectId: 2495, mode: "ResetToDefault" },
    },
    res,
  );

  assert.equal(res.result.statusCode, 200);
  assert.deepEqual(
    operations.map(([name]) => name),
    [
      "transaction-options",
      "authorize-project",
      "upsert-project-view",
      "upsert-user-view",
      "lock-user-view",
      "update-user-view",
      "delete-last-used",
      "delete-view",
      "broadcast",
    ],
  );
  assert.deepEqual(operations[0][1], { isolationLevel: "Serializable" });
  assert.deepEqual(operations[5][1].data, {
    unsavedViewId: null,
    appliedViewId: null,
  });
  assert.deepEqual(operations[7][1].where, {
    id: "unsaved-1",
    userId: 6,
    project_view_id: "project-view-1",
  });
});

test("reset retries transient serializable conflicts", async () => {
  const { runSerializableViewReset, operations, prismaStub } = loadRoute({
    transactionFailures: 2,
  });

  await runSerializableViewReset(2495, 6, "ResetCurrent", prismaStub);

  assert.equal(
    operations.filter(([name]) => name === "transaction-options").length,
    3,
  );
});

test("reset creates missing per-user view state instead of returning 500", async () => {
  const { resetUserProjectViewState } = loadRoute();
  const operations = [];
  const tx = {
    user_Project_View: {
      upsert: async (args) => {
        operations.push(["upsert-user-view", args]);
      },
      update: async (args) => operations.push(["update-user-view", args]),
    },
    $queryRaw: async () => {
      operations.push(["lock-user-view"]);
      return [{ unsavedViewId: null }];
    },
    view_Last_Used: {
      deleteMany: async () => operations.push(["delete-last-used"]),
    },
    view: { deleteMany: async () => operations.push(["delete-view"]) },
  };

  await resetUserProjectViewState(tx, "project-view-1", 6, "ResetCurrent");

  assert.deepEqual(
    operations.map(([name]) => name),
    ["upsert-user-view", "lock-user-view", "update-user-view"],
  );
  assert.deepEqual(operations[0][1].create, {
    userId: 6,
    project_view_id: "project-view-1",
    appliedViewId: null,
    unsavedViewId: null,
  });
  assert.deepEqual(operations[0][1].update, {});
  assert.deepEqual(operations[2][1].data, { unsavedViewId: null });
});
