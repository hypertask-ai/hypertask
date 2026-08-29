const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let loadId = 0;

const pairedLabel = {
  id: "paired",
  value: "Needs design",
  ai_prompt: "Tasks that need design",
  projectId: 15,
};
const pairedView = {
  id: "paired",
  project_view_id: "project-view-15",
  project_view: { id: "project-view-15", projectId: 15 },
  board_filters: {
    matchFilters: "ALL",
    addedFilters: [
      {
        type: "Labels",
        match: "ANY",
        searchPayload: [{ id: pairedLabel.id, value: pairedLabel.value }],
      },
    ],
  },
};
const legacyLabel = { ...pairedLabel, id: "legacy-label" };
const legacyView = {
  ...pairedView,
  id: "legacy-view",
  board_filters: {
    ...pairedView.board_filters,
    addedFilters: [
      {
        ...pairedView.board_filters.addedFilters[0],
        searchPayload: [{ id: legacyLabel.id, value: legacyLabel.value }],
      },
    ],
  },
};

const stubModule = (relativePath, exports) => {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
};

const loadRoute = (relativePath, stubs) => {
  delete require.cache[path.join(root, relativePath)];
  delete require.cache[path.join(
    root,
    "src/utils/controllers/projects/views/boardFilterWriteLock.ts",
  )];
  for (const [stubPath, exports] of Object.entries(stubs)) {
    stubModule(stubPath, exports);
  }
  const jiti = require("jiti")(
    path.join(root, `tests/smart-split-generic-route-${++loadId}.cjs`),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
      cache: false,
    },
  );
  return jiti(path.join(root, relativePath)).default;
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

class ManagedSmartSplitMutationError extends Error {
  constructor() {
    super("Manage this smart split from Manage views");
    this.status = 409;
  }
}

const labelHandler = (writes, label, view, options = {}) => loadRoute(
  "src/pages/api/labels/updateLabel.ts",
  {
    "src/lib/prisma.ts": {
      default: (() => {
        const tx = {
          label: {
            findUnique: async () => ({
              id: label.id,
              projectId: label.projectId,
              ai_prompt: label.ai_prompt,
            }),
            findMany: async () => [label],
            update: async () => { writes.labelUpdate += 1; },
            delete: async () => {
              writes.events?.push("label-delete");
              writes.labelDelete += 1;
              return label;
            },
          },
          view: {
            findMany: async () => [view],
            update: async () => {
              writes.events?.push("view-update");
              if (options.failViewUpdate) throw new Error("view update failed");
              writes.viewUpdate = (writes.viewUpdate ?? 0) + 1;
            },
          },
          taskLabel: {
            deleteMany: async () => {
              writes.events?.push("task-label-delete");
              writes.taskLabelDelete += 1;
            },
          },
          project_View: {
            findFirst: async () => options.projectView ?? null,
          },
          $queryRaw: async () => {
            writes.events?.push("lock");
            return [{ id: "project-view-15" }];
          },
        };
        return { ...tx, $transaction: async (operation) => operation(tx) };
      })(),
    },
    "src/lib/realtime/server.ts": { broadcastBoardChange: () => undefined },
    "src/lib/ai/labelClassifier.ts": { scheduleBackfillAiLabel: () => undefined },
    "src/lib/mcp/tasks/services.ts": {
      validateProjectMemberIds: async () => ({ invalidIds: [] }),
    },
    "src/utils/helperFunctions/Views/BoardFilterSanitizer.ts": {
      sanitizeBoardFilters: (value) => value,
    },
  },
);

const viewHandler = (writes, label, view) => loadRoute(
  "src/pages/api/projects/views/delete-rename-view.ts",
  {
    "src/lib/prisma.ts": {
      default: {
        $transaction: async function (operation) { return operation(this); },
        label: { findMany: async () => [label] },
        view: {
          findUnique: async () => view,
          findMany: async () => [view],
          update: async () => { writes.viewUpdate += 1; },
          delete: async () => { writes.viewDelete += 1; },
        },
        view_Last_Used: {
          deleteMany: async () => { writes.lastUsedDelete += 1; },
        },
        user_Project_View: { findUnique: async () => null },
      },
    },
    "src/lib/realtime/server.ts": { broadcastBoardChange: () => undefined },
    "src/utils/controllers/projects/views/viewsHelperAPIfunctions.ts": {
      default: async () => ({}),
      getUniqueSlug: async () => "renamed",
    },
    "src/utils/helperFunctions/Views/BoardFilterSanitizer.ts": {
      sanitizeViewBoardFilters: (value) => value,
    },
    "src/utils/controllers/projects/views/boardFilterWriteLock.ts": {
      acquireBoardFilterWriteLock: async () => undefined,
      assertViewIsNotManagedSmartSplit: async () => {
        throw new ManagedSmartSplitMutationError();
      },
      ManagedSmartSplitMutationError,
    },
  },
);

for (const fixture of [
  { kind: "stable", label: pairedLabel, view: pairedView },
  { kind: "legacy", label: legacyLabel, view: legacyView },
]) {
  test(`generic label POST refuses a ${fixture.kind} smart split without writes`, async () => {
    const writes = { labelUpdate: 0, labelDelete: 0, taskLabelDelete: 0 };
    const handler = labelHandler(writes, fixture.label, fixture.view);
    const res = response();

    await handler({
      method: "POST",
      body: { labelId: fixture.label.id, value: "Renamed" },
      query: {},
      cookies: { nookies_user: JSON.stringify({ id: 6 }) },
    }, res);

    assert.equal(res.result.statusCode, 409);
    assert.deepEqual(writes, { labelUpdate: 0, labelDelete: 0, taskLabelDelete: 0 });
  });

  test(`generic label DELETE refuses a ${fixture.kind} smart split without writes`, async () => {
    const writes = { labelUpdate: 0, labelDelete: 0, taskLabelDelete: 0 };
    const handler = labelHandler(writes, fixture.label, fixture.view);
    const res = response();

    await handler({
      method: "DELETE",
      body: {},
      query: { labelId: fixture.label.id, projectId: "15" },
      cookies: { nookies_user: JSON.stringify({ id: 6 }) },
    }, res);

    assert.equal(res.result.statusCode, 409);
    assert.deepEqual(writes, { labelUpdate: 0, labelDelete: 0, taskLabelDelete: 0 });
  });

  test(`generic view POST refuses a ${fixture.kind} smart split without writes`, async () => {
    const writes = { viewUpdate: 0, viewDelete: 0, lastUsedDelete: 0 };
    const handler = viewHandler(writes, fixture.label, fixture.view);
    const res = response();

    await handler({
      method: "POST",
      body: { viewId: fixture.view.id, projectId: 15, title: "Renamed" },
      query: {},
      cookies: { nookies_user: JSON.stringify({ id: 6 }) },
    }, res);

    assert.equal(res.result.statusCode, 409);
    assert.deepEqual(writes, { viewUpdate: 0, viewDelete: 0, lastUsedDelete: 0 });
  });

  test(`generic view DELETE refuses a ${fixture.kind} smart split without writes`, async () => {
    const writes = { viewUpdate: 0, viewDelete: 0, lastUsedDelete: 0 };
    const handler = viewHandler(writes, fixture.label, fixture.view);
    const res = response();

    await handler({
      method: "DELETE",
      body: {},
      query: { viewId: fixture.view.id, projectId: "15" },
      cookies: { nookies_user: JSON.stringify({ id: 6 }) },
    }, res);

    assert.equal(res.result.statusCode, 409);
    assert.deepEqual(writes, { viewUpdate: 0, viewDelete: 0, lastUsedDelete: 0 });
  });
}

const ordinaryLabel = {
  id: "ordinary-label",
  value: "Ordinary",
  ai_prompt: null,
  projectId: 15,
};
const ordinaryView = {
  ...pairedView,
  id: "ordinary-view",
  title: null,
  board_filters: {
    ...pairedView.board_filters,
    addedFilters: [
      {
        ...pairedView.board_filters.addedFilters[0],
        searchPayload: [{ id: ordinaryLabel.id, value: ordinaryLabel.value }],
      },
    ],
  },
};
const projectViewWithOrdinaryReference = {
  allViews: [ordinaryView],
};

test("ordinary label deletion scrubs an unlinked null-title view before deleting", async () => {
  const writes = {
    events: [],
    labelUpdate: 0,
    labelDelete: 0,
    taskLabelDelete: 0,
    viewUpdate: 0,
  };
  const handler = labelHandler(writes, ordinaryLabel, ordinaryView, {
    projectView: projectViewWithOrdinaryReference,
  });
  const res = response();

  await handler({
    method: "DELETE",
    body: {},
    query: { labelId: ordinaryLabel.id, projectId: "15" },
    cookies: { nookies_user: JSON.stringify({ id: 6 }) },
  }, res);

  assert.equal(res.result.statusCode, 200);
  assert.deepEqual(writes.events, [
    "lock",
    "view-update",
    "task-label-delete",
    "label-delete",
  ]);
  assert.equal(writes.viewUpdate, 1);
  assert.equal(writes.labelDelete, 1);
});

test("a failed view-reference scrub prevents ordinary label deletion", async () => {
  const writes = {
    events: [],
    labelUpdate: 0,
    labelDelete: 0,
    taskLabelDelete: 0,
    viewUpdate: 0,
  };
  const handler = labelHandler(writes, ordinaryLabel, ordinaryView, {
    projectView: projectViewWithOrdinaryReference,
    failViewUpdate: true,
  });
  const res = response();

  await handler({
    method: "DELETE",
    body: {},
    query: { labelId: ordinaryLabel.id, projectId: "15" },
    cookies: { nookies_user: JSON.stringify({ id: 6 }) },
  }, res);

  assert.equal(res.result.statusCode, 500);
  assert.deepEqual(writes.events, ["lock", "view-update"]);
  assert.equal(writes.taskLabelDelete, 0);
  assert.equal(writes.labelDelete, 0);
});
