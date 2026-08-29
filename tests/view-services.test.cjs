const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

const stubbedModulePaths = [
  "src/lib/prisma.ts",
  "src/lib/realtime/server.ts",
  "src/lib/mcp/tasks/services.ts",
  "src/lib/mcp/views/services.ts",
  "src/utils/controllers/projects/views/viewsHelperAPIfunctions.ts",
  "src/utils/controllers/projects/views/boardFilterWriteLock.ts",
];

function resetModules() {
  for (const relativePath of stubbedModulePaths) {
    delete require.cache[path.join(root, relativePath)];
  }
}

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

function loadUpdateView(storedBoardFilters) {
  resetModules();
  const updateCalls = [];
  const storedView = {
    id: "view-1",
    title: "Stored view",
    userId: 6,
    visibility: "Public",
    board_filters: storedBoardFilters,
    project_view: {
      id: "project-view-1",
      projectId: 15,
      default_view_id: null,
    },
  };

  const prismaStub = {
      $transaction: async (operation) => operation(prismaStub),
      view: {
        findUnique: async ({ select }) => {
          assert.equal(select.board_filters, true);
          return storedView;
        },
        update: async (args) => {
          updateCalls.push(args);
          return {
            id: storedView.id,
            title: storedView.title,
            slug: null,
            visibility: storedView.visibility,
            board_filters: args.data.board_filters,
            board_sorting_mode: "Manual",
            board_sorting_order: "Descending",
          };
        },
      },
  };
  stubModule("src/lib/prisma.ts", { default: prismaStub });
  stubModule("src/utils/controllers/projects/views/boardFilterWriteLock.ts", {
    acquireBoardFilterWriteLock: async () => undefined,
    assertViewIsNotManagedSmartSplit: async () => undefined,
    validateBoardFilterLabelReferences: async () => undefined,
    withBoardFilterWriteLock: async (_projectId, _filters, operation) => operation(prismaStub),
  });
  stubModule("src/lib/mcp/tasks/services.ts", {
    matchLabelIds: () => ({ ids: [], unresolved: [] }),
    validateProjectAccess: async () => ({}),
  });
  stubModule("src/lib/realtime/server.ts", {
    broadcastBoardChange: () => undefined,
  });
  stubModule(
    "src/utils/controllers/projects/views/viewsHelperAPIfunctions.ts",
    { getUniqueSlug: async () => null },
  );

  const jiti = require("jiti")(
    path.join(root, `tests/view-services-jiti-${++jitiEntryId}.cjs`),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
      cache: false,
    },
  );
  const { updateView } = jiti(
    path.join(root, "src/lib/mcp/views/services.ts"),
  );

  return { updateView, updateCalls };
}

const labelsEntry = {
  type: "Labels",
  searchPayload: [{ id: "label-1" }],
};
const assigneesEntry = {
  type: "Assignees",
  searchPayload: [
    {
      id: 42,
      uid: "firebase-user-42",
      displayName: "Person",
      photoURL: null,
    },
  ],
};

test("view services broadcast board changes after create, update, apply, and delete", () => {
  const source = fs.readFileSync(
    path.join(root, "src/lib/mcp/views/services.ts"),
    "utf8",
  );
  const functionSource = (name, nextName) =>
    source.slice(
      source.indexOf(`export async function ${name}`),
      nextName
        ? source.indexOf(`export async function ${nextName}`)
        : source.length,
    );

  assert.match(
    functionSource("createView", "updateView"),
    /broadcastBoardChange\(projectId, \{ originUserId: userId \}\)/,
  );
  assert.match(
    functionSource("updateView", "applyView"),
    /broadcastBoardChange\(projectId, \{ originUserId: userId \}\)/,
  );
  assert.match(
    functionSource("applyView", "deleteView"),
    /broadcastBoardChange\(projectId, \{ originUserId: userId \}\)/,
  );
  assert.match(
    functionSource("deleteView"),
    /broadcastBoardChange\(view\.project_view\.projectId, \{ originUserId: userId \}\)/,
  );
});

test("browser view switching does not broadcast a user-local applied pointer", () => {
  const source = fs.readFileSync(
    path.join(root, "src/pages/api/projects/views/switch-view.ts"),
    "utf8",
  );

  assert.doesNotMatch(source, /broadcastBoardChange/);
});

test("updateView preserves stored filter dimensions when only match changes", async () => {
  const { updateView, updateCalls } = loadUpdateView({
    matchFilters: "ALL",
    addedFilters: [labelsEntry, assigneesEntry],
  });

  await updateView({
    viewId: "view-1",
    userId: 6,
    filters: { match: "ANY" },
  });

  assert.deepEqual(updateCalls[0].data.board_filters, {
    matchFilters: "ANY",
    addedFilters: [labelsEntry, assigneesEntry],
  });
});

test("updateView clears only Labels when label_names is an empty array", async () => {
  const { updateView, updateCalls } = loadUpdateView({
    matchFilters: "ALL",
    addedFilters: [labelsEntry, assigneesEntry],
  });

  await updateView({
    viewId: "view-1",
    userId: 6,
    filters: { label_names: [] },
  });

  assert.deepEqual(updateCalls[0].data.board_filters, {
    matchFilters: "ALL",
    addedFilters: [assigneesEntry],
  });
});

test("updateView preserves filter types it doesn't understand (e.g. Priority) on a partial label update", async () => {
  const priorityEntry = { type: "Priority", searchPayload: [1, 2] };
  const { updateView, updateCalls } = loadUpdateView({
    matchFilters: "ANY",
    addedFilters: [priorityEntry, labelsEntry],
  });

  await updateView({
    viewId: "view-1",
    userId: 6,
    filters: { label_names: [] },
  });

  assert.deepEqual(updateCalls[0].data.board_filters, {
    matchFilters: "ANY",
    addedFilters: [priorityEntry],
  });
});

test("updateView rejects a visibility change from a non-owner on a Public view", async () => {
  const { updateView } = loadUpdateView({
    matchFilters: "ANY",
    addedFilters: [],
  });

  await assert.rejects(
    updateView({
      viewId: "view-1",
      userId: 999, // stored view's owner is userId 6
      visibility: "Private",
    }),
    /Only the view's owner can change its visibility/,
  );
});
