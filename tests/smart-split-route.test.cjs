const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let loadId = 0;

const stubbedPaths = [
  "src/pages/api/projects/views/smart-split.ts",
  "src/lib/prisma.ts",
  "src/lib/ai/labelClassifier.ts",
  "src/lib/auth/getSessionUser.ts",
  "src/lib/realtime/server.ts",
  "src/utils/controllers/projects/getAllIncludes.ts",
  "src/utils/controllers/projects/views/boardFilterWriteLock.ts",
];

const stubModule = (relativePath, exports) => {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
};

const loadHandler = ({
  tx,
  scheduleBackfillAiLabel = () => undefined,
  sessionUser = { userId: 6, source: "legacy", needsBridge: true },
  transactionFailures = [],
  onTransaction = () => undefined,
  onBoardFilterLock = () => undefined,
}) => {
  for (const relativePath of stubbedPaths) {
    delete require.cache[path.join(root, relativePath)];
  }

  let transactionCommitted = false;
  const prisma = {
    project: { findFirst: async () => ({ id: 15 }) },
    $transaction: async (callback, options) => {
      onTransaction(options);
      const failure = transactionFailures.shift();
      if (failure) throw failure;
      const result = await callback(tx);
      transactionCommitted = true;
      return result;
    },
  };
  stubModule("src/lib/prisma.ts", { default: prisma });
  stubModule("src/lib/ai/labelClassifier.ts", {
    scheduleBackfillAiLabel: (labelId) =>
      scheduleBackfillAiLabel(labelId, transactionCommitted),
  });
  stubModule("src/lib/auth/getSessionUser.ts", {
    getSessionUser: async () => sessionUser,
  });
  stubModule("src/lib/realtime/server.ts", {
    broadcastBoardChange: () => undefined,
  });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", {
    taskWriteAccessWhere: () => ({}),
  });
  stubModule("src/utils/controllers/projects/views/boardFilterWriteLock.ts", {
    acquireBoardFilterWriteLock: async (_tx, projectId) => onBoardFilterLock(projectId),
  });

  const jiti = require("jiti")(
    path.join(root, `tests/smart-split-route-${++loadId}.cjs`),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
      cache: false,
    },
  );
  return jiti(
    path.join(root, "src/pages/api/projects/views/smart-split.ts"),
  ).default;
};

const response = () => {
  const result = { statusCode: null, body: null };
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
};

const request = (method, body) => ({
  method,
  body,
  headers: {},
  cookies: { nookies_user: JSON.stringify({ id: 6 }) },
});

test("create commits a public view and smart tag before scheduling backfill", async () => {
  let createdViewData;
  let createdLabelData;
  let scheduled;
  let transactionOptions;
  const tx = {
    project_View: {
      findUnique: async () => ({
        id: "project-view-15",
        default_view: {
          board_sorting_mode: "Manual",
          board_sorting_order: "Descending",
          board_sorting_stack: [],
          board_columns_view: [],
          board_subtask_setting: "None",
          board_empty_sections: "Show",
          board_staleness: null,
          table_sort_column: null,
          table_sort_direction: null,
        },
      }),
    },
    label: {
      findFirst: async () => null,
      create: async ({ data }) => {
        createdLabelData = data;
        return data;
      },
    },
    view: {
      findFirst: async () => null,
      create: async ({ data }) => {
        createdViewData = data;
        return { id: "view-1", ...data };
      },
    },
  };
  const handler = loadHandler({
    tx,
    scheduleBackfillAiLabel: (labelId, committed) => {
      scheduled = { labelId, committed };
    },
    onTransaction: (options) => { transactionOptions = options; },
  });
  const res = response();

  await handler(
    request("POST", {
      projectId: 15,
      name: "Needs design",
      prompt: "Tasks needing design",
    }),
    res,
  );

  assert.equal(res.result.statusCode, 201);
  assert.equal(createdViewData.visibility, "Public");
  assert.equal(createdViewData.title, "Needs design");
  assert.equal(createdViewData.id, createdLabelData.id);
  assert.deepEqual(createdViewData.board_filters.addedFilters, [
    {
      type: "Labels",
      match: "ANY",
      searchPayload: [{ id: createdLabelData.id, value: "Needs design" }],
    },
  ]);
  assert.deepEqual(scheduled, { labelId: createdLabelData.id, committed: true });
  assert.deepEqual(transactionOptions, { isolationLevel: "Serializable" });
});

test("duplicate names are rejected before either half is created", async () => {
  let labelCreateCalls = 0;
  const tx = {
    project_View: {
      findUnique: async () => ({ id: "project-view-15", default_view: {} }),
    },
    view: { findFirst: async () => ({ id: "existing-view" }) },
    label: {
      findFirst: async () => null,
      create: async () => {
        labelCreateCalls += 1;
      },
    },
  };
  const handler = loadHandler({ tx });
  const res = response();

  await handler(
    request("POST", {
      projectId: 15,
      name: "Duplicate",
      prompt: "Some tasks",
    }),
    res,
  );

  assert.equal(res.result.statusCode, 409);
  assert.equal(labelCreateCalls, 0);
});

test("edit rejects a view with repeated smart-label references", async () => {
  let updateCalls = 0;
  const tx = {
    view: {
      findFirst: async () => ({
        id: "view-1",
        project_view_id: "project-view-15",
        board_filters: {
          matchFilters: "ALL",
          addedFilters: [
            {
              type: "Labels",
              searchPayload: [{ id: "label-1" }, { id: "label-1" }],
            },
          ],
        },
      }),
      update: async () => { updateCalls += 1; },
    },
    label: {
      findMany: async () => [
        { id: "label-1", value: "Smart", ai_prompt: "Some tasks", projectId: 15 },
      ],
      update: async () => { updateCalls += 1; },
    },
  };
  const handler = loadHandler({ tx });
  const res = response();

  await handler(
    request("PATCH", {
      projectId: 15,
      viewId: "view-1",
      name: "Smart",
      prompt: "Some tasks",
    }),
    res,
  );

  assert.equal(res.result.statusCode, 409);
  assert.equal(updateCalls, 0);
});

test("prompts over 1,000 characters are rejected before the transaction", async () => {
  let transactionCalls = 0;
  const handler = loadHandler({
    tx: {},
  });
  // Replace the transaction after loading; the route keeps the same stub object.
  const prismaModule = require.cache[path.join(root, "src/lib/prisma.ts")].exports.default;
  prismaModule.$transaction = async () => { transactionCalls += 1; };
  const res = response();

  await handler(
    request("POST", {
      projectId: 15,
      name: "Long prompt",
      prompt: "x".repeat(1001),
    }),
    res,
  );

  assert.equal(res.result.statusCode, 400);
  assert.equal(transactionCalls, 0);
});

test("missing and non-string prompts return 400 before the transaction", async () => {
  for (const prompt of [undefined, null, 42, { text: "Some tasks" }]) {
    let transactionCalls = 0;
    const handler = loadHandler({ tx: {} });
    const prismaModule = require.cache[path.join(root, "src/lib/prisma.ts")].exports.default;
    prismaModule.$transaction = async () => { transactionCalls += 1; };
    const res = response();

    await handler(request("POST", { projectId: 15, name: "Invalid", prompt }), res);

    assert.equal(res.result.statusCode, 400);
    assert.equal(res.result.body.message, "Smart split prompt is required");
    assert.equal(transactionCalls, 0);
  }
});

test("create retries transaction and slug uniqueness conflicts with Serializable isolation", async () => {
  let attempts = 0;
  const tx = {
    project_View: {
      findUnique: async () => ({ id: "project-view-15", default_view: {} }),
    },
    label: {
      findFirst: async () => null,
      create: async ({ data }) => data,
    },
    view: {
      findFirst: async () => null,
      create: async ({ data }) => data,
    },
  };
  const handler = loadHandler({
    tx,
    transactionFailures: [{ code: "P2034" }, { code: "P2002" }],
    onTransaction: (options) => {
      attempts += 1;
      assert.deepEqual(options, { isolationLevel: "Serializable" });
    },
  });
  const res = response();

  await handler(
    request("POST", { projectId: 15, name: "Concurrent", prompt: "Some tasks" }),
    res,
  );

  assert.equal(res.result.statusCode, 201);
  assert.equal(attempts, 3);
});

test("create stops after three P2034 conflicts with a retryable 409", async () => {
  let attempts = 0;
  const handler = loadHandler({
    tx: {},
    transactionFailures: [{ code: "P2034" }, { code: "P2034" }, { code: "P2034" }],
    onTransaction: () => { attempts += 1; },
  });
  const res = response();

  await handler(
    request("POST", { projectId: 15, name: "Concurrent", prompt: "Some tasks" }),
    res,
  );

  assert.equal(res.result.statusCode, 409);
  assert.match(res.result.body.message, /same time/i);
  assert.equal(attempts, 3);
});

test("PATCH scopes private smart splits to their owner", async () => {
  let receivedWhere;
  let labelUpdates = 0;
  let transactionOptions;
  const tx = {
    view: {
      findFirst: async ({ where }) => {
        receivedWhere = where;
        return null;
      },
    },
    label: {
      update: async () => { labelUpdates += 1; },
    },
  };
  const handler = loadHandler({
    tx,
    sessionUser: { userId: 23 },
    onTransaction: (options) => { transactionOptions = options; },
  });
  const res = response();

  await handler(
    request("PATCH", {
      projectId: 15,
      viewId: "private-view",
      name: "Private",
      prompt: "Some tasks",
    }),
    res,
  );

  assert.equal(res.result.statusCode, 404);
  assert.deepEqual(receivedWhere.OR, [
    { visibility: "Public" },
    { visibility: "Private", userId: 23 },
  ]);
  assert.deepEqual(transactionOptions, { isolationLevel: "Serializable" });
  assert.equal(labelUpdates, 0);
});

test("paired smart split stays manageable when ordinary views use its label", async () => {
  const pairedView = {
    id: "pair-1",
    slug: "smart",
    project_view_id: "project-view-15",
    board_filters: {
      addedFilters: [{ type: "Labels", searchPayload: [{ id: "pair-1", value: "Smart" }] }],
    },
  };
  let ownershipScanCalls = 0;
  let dependentViewWhere;
  let updatedView;
  const tx = {
    view: {
      findFirst: async ({ where }) => {
        if (where.id === "pair-1") return pairedView;
        return null;
      },
      findMany: async ({ where }) => {
        ownershipScanCalls += 1;
        if (where.userId?.not) return [];
        dependentViewWhere = where;
        return [{
          id: "ordinary-view",
          board_filters: {
            addedFilters: [{ type: "Labels", searchPayload: [{ id: "pair-1" }] }],
          },
        }];
      },
      update: async ({ where, data }) => {
        if (where.id === "pair-1") updatedView = data;
        return { slug: data.slug ?? "renamed" };
      },
    },
    label: {
      findMany: async () => [
        { id: "pair-1", value: "Smart", ai_prompt: "Some tasks", projectId: 15 },
      ],
      findFirst: async () => null,
      update: async () => undefined,
    },
  };
  const handler = loadHandler({ tx });
  const res = response();

  await handler(
    request("PATCH", {
      projectId: 15,
      viewId: "pair-1",
      name: "Renamed",
      prompt: "Some tasks",
    }),
    res,
  );

  assert.equal(res.result.statusCode, 200);
  assert.equal(updatedView.title, "Renamed");
  assert.deepEqual(dependentViewWhere.OR, [
    { visibility: "Public", unsaved_User_Project_View: { none: {} } },
    { userId: 6 },
  ]);
  // One scan protects other members' private state; the second updates only
  // public saved views and the requester's own views.
  assert.equal(ownershipScanCalls, 2);
});

test("rename refuses to leave another member's private view stale", async () => {
  let updateCalls = 0;
  const pairedView = {
    id: "pair-1",
    project_view_id: "project-view-15",
    board_filters: {
      addedFilters: [{ type: "Labels", searchPayload: [{ id: "pair-1" }] }],
    },
  };
  const tx = {
    view: {
      findFirst: async ({ where }) => where.id === "pair-1" ? pairedView : null,
      findMany: async ({ where }) => where.userId?.not
        ? [{ board_filters: pairedView.board_filters }]
        : [],
      update: async () => { updateCalls += 1; },
    },
    label: {
      findMany: async () => [
        { id: "pair-1", value: "Smart", ai_prompt: "Some tasks", projectId: 15 },
      ],
      findFirst: async () => null,
      update: async () => { updateCalls += 1; },
    },
  };
  const handler = loadHandler({ tx });
  const res = response();

  await handler(
    request("PATCH", {
      projectId: 15,
      viewId: "pair-1",
      name: "Renamed",
      prompt: "Some tasks",
    }),
    res,
  );

  assert.equal(res.result.statusCode, 409);
  assert.match(res.result.body.message, /another member's private view/i);
  // The transaction rolls back the earlier label/view writes in production.
  // The mock records them, but no dependent private View row is ever updated.
  assert.equal(updateCalls, 2);
});

test("prompt-only edits do not touch or depend on another member's private view", async () => {
  let findManyCalls = 0;
  let updateCalls = 0;
  let scheduled;
  const pairedView = {
    id: "pair-1",
    slug: "smart",
    project_view_id: "project-view-15",
    board_filters: {
      addedFilters: [{ type: "Labels", searchPayload: [{ id: "pair-1" }] }],
    },
  };
  const tx = {
    view: {
      findFirst: async ({ where }) => {
        if (where.id === "pair-1") return pairedView;
        if (where.title) return { id: "legacy-case-insensitive-conflict" };
        return null;
      },
      findMany: async () => {
        findManyCalls += 1;
        return [{ board_filters: pairedView.board_filters }];
      },
      update: async ({ data }) => {
        updateCalls += 1;
        return { slug: data.slug ?? "smart" };
      },
    },
    label: {
      findMany: async () => [
        { id: "pair-1", value: "Smart", ai_prompt: "Old prompt", projectId: 15 },
      ],
      findFirst: async () => ({ id: "legacy-label-name-conflict" }),
      update: async () => { updateCalls += 1; },
    },
  };
  const handler = loadHandler({
    tx,
    scheduleBackfillAiLabel: (labelId, committed) => {
      scheduled = { labelId, committed };
    },
  });
  const res = response();

  await handler(
    request("PATCH", {
      projectId: 15,
      viewId: "pair-1",
      name: "Smart",
      prompt: "New prompt",
    }),
    res,
  );

  assert.equal(res.result.statusCode, 200);
  assert.equal(findManyCalls, 0);
  assert.equal(updateCalls, 1);
  assert.equal(res.result.body.slug, "smart");
  assert.deepEqual(scheduled, { labelId: "pair-1", committed: true });
});

test("legacy smart split is manageable only while it is the sole saved-view reference", async () => {
  const legacyView = {
    id: "legacy-view",
    project_view_id: "project-view-15",
    board_filters: {
      addedFilters: [{ type: "Labels", searchPayload: [{ id: "legacy-label" }] }],
    },
  };
  for (const linkedViews of [
    [legacyView],
    [legacyView, { id: "ordinary-view", board_filters: legacyView.board_filters }],
  ]) {
    let findManyCalls = 0;
    const tx = {
      view: {
        findFirst: async ({ where }) => {
          if (where.id === "legacy-view") return legacyView;
          return null;
        },
        findMany: async ({ where }) => {
          findManyCalls += 1;
          if (where.userId?.not || where.OR) return [];
          return linkedViews;
        },
        update: async ({ data }) => ({ slug: data.slug ?? "legacy" }),
      },
      label: {
        findMany: async () => [
          { id: "legacy-label", value: "Legacy", ai_prompt: "Some tasks", projectId: 15 },
        ],
        findFirst: async () => null,
        update: async () => undefined,
      },
    };
    const handler = loadHandler({ tx });
    const res = response();

    await handler(
      request("PATCH", {
        projectId: 15,
        viewId: "legacy-view",
        name: "Legacy",
        prompt: "Some tasks",
      }),
      res,
    );

    assert.equal(res.result.statusCode, linkedViews.length === 1 ? 200 : 409);
    assert.ok(findManyCalls >= 1);
  }
});

test("DELETE scopes private views and performs paired cleanup", async () => {
  const calls = [];
  let transactionOptions;
  let lockedProjectId;
  let receivedWhere;
  let dependentViewWhere;
  const view = {
    id: "pair-1",
    project_view_id: "project-view-15",
    board_filters: {
      addedFilters: [{ type: "Labels", searchPayload: [{ id: "pair-1" }] }],
    },
    project_view: {
      default_view_id: "another-view",
      default_view_order: ["another-view", "pair-1"],
    },
  };
  const tx = {
    view: {
      findFirst: async ({ where }) => {
        receivedWhere = where;
        return view;
      },
      findMany: async ({ where }) => {
        if (where.userId?.not) return [];
        dependentViewWhere = where;
        return [{ id: "ordinary", board_filters: view.board_filters }];
      },
      update: async ({ where }) => { calls.push(`view-filter:${where.id}`); },
      delete: async ({ where }) => { calls.push(`view:${where.id}`); },
    },
    label: {
      findMany: async () => [
        { id: "pair-1", value: "Smart", ai_prompt: "Some tasks", projectId: 15 },
      ],
      delete: async ({ where }) => { calls.push(`label:${where.id}`); },
    },
    user_Project_View: {
      updateMany: async ({ where }) => { calls.push(`user-link:${Object.keys(where)[0]}`); },
      findMany: async () => [{ id: "user-view", view_order: ["pair-1", "another-view"] }],
      update: async ({ where }) => { calls.push(`user-order:${where.id}`); },
    },
    project_View: {
      update: async ({ where }) => { calls.push(`project-order:${where.id}`); },
    },
    view_Last_Used: {
      deleteMany: async () => { calls.push("last-used"); },
    },
    taskLabel: {
      deleteMany: async () => { calls.push("task-labels"); },
    },
  };
  const handler = loadHandler({
    tx,
    sessionUser: { userId: 23 },
    onTransaction: (options) => { transactionOptions = options; },
    onBoardFilterLock: (projectId) => { lockedProjectId = projectId; },
  });
  const res = response();

  await handler(request("DELETE", { projectId: 15, viewId: "pair-1" }), res);

  assert.equal(res.result.statusCode, 200);
  assert.deepEqual(transactionOptions, { isolationLevel: "Serializable" });
  assert.equal(lockedProjectId, 15);
  assert.deepEqual(receivedWhere.OR, [
    { visibility: "Public" },
    { visibility: "Private", userId: 23 },
  ]);
  assert.deepEqual(dependentViewWhere.OR, [
    { visibility: "Public", unsaved_User_Project_View: { none: {} } },
    { userId: 23 },
  ]);
  assert.ok(calls.includes("view:pair-1"));
  assert.ok(calls.includes("view-filter:ordinary"));
  assert.ok(calls.includes("label:pair-1"));
  assert.ok(calls.includes("task-labels"));
  assert.ok(calls.includes("last-used"));
  assert.ok(calls.includes("project-order:project-view-15"));
  assert.ok(calls.includes("user-order:user-view"));
});

test("DELETE returns a retryable 409 after three serialization conflicts", async () => {
  let attempts = 0;
  const handler = loadHandler({
    tx: {},
    transactionFailures: [{ code: "P2034" }, { code: "P2034" }, { code: "P2034" }],
    onTransaction: (options) => {
      attempts += 1;
      assert.deepEqual(options, { isolationLevel: "Serializable" });
    },
  });
  const res = response();

  await handler(request("DELETE", { projectId: 15, viewId: "pair-1" }), res);

  assert.equal(attempts, 3);
  assert.equal(res.result.statusCode, 409);
  assert.match(res.result.body.message, /changed at the same time/i);
});

test("a client-writable user cookie without a signed session cannot mutate splits", async () => {
  let transactionCalls = 0;
  const handler = loadHandler({
    tx: {},
    sessionUser: null,
  });
  const prismaModule = require.cache[path.join(root, "src/lib/prisma.ts")].exports.default;
  prismaModule.$transaction = async () => { transactionCalls += 1; };
  const res = response();

  await handler(
    request("POST", {
      projectId: 15,
      name: "Forged",
      prompt: "Some tasks",
    }),
    res,
  );

  assert.equal(res.result.statusCode, 401);
  assert.equal(res.result.body.code, "SESSION_REQUIRED");
  assert.equal(transactionCalls, 0);
});
