const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const viewId = "9c62b6f8-c80c-4ab4-ab6a-76caaf5f95c6";
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

function createJiti(label) {
  return require("jiti")(
    path.join(root, `tests/view-sorting-stack-${label}-${++jitiEntryId}.cjs`),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
      cache: false,
    },
  );
}

function loadViewSchemas() {
  return createJiti("validation")(
    path.join(root, "src/lib/mcp-server/validations/view.validation.ts"),
  );
}

function loadSanitizer() {
  return createJiti("sanitizer")(
    path.join(
      root,
      "src/utils/helperFunctions/Views/ViewsHelperFunctions.ts",
    ),
  ).sanitizeSortingStack;
}

function loadViewServices() {
  resetModules();
  const createCalls = [];
  const updateCalls = [];
  const storedView = {
    id: viewId,
    title: "Stored view",
    userId: 6,
    visibility: "Public",
    board_filters: { matchFilters: "ANY", addedFilters: [] },
    board_sorting_mode: "Priority",
    board_sorting_stack: [{ mode: "DueDate", order: "Ascending" }],
    board_subtask_setting: "None",
    board_empty_sections: "Show",
    project_view: {
      id: "project-view-1",
      projectId: 15,
      default_view_id: null,
    },
  };

  const prismaStub = {
      $transaction: async (operation) => operation(prismaStub),
      project_View: {
        upsert: async () => ({ id: "project-view-1" }),
      },
      label: { findMany: async () => [] },
      user: { findMany: async () => [] },
      agent: { findMany: async () => [] },
      view: {
        findFirst: async () => null,
        findUnique: async () => storedView,
        create: async (args) => {
          createCalls.push(args);
          return {
            id: "created-view",
            title: args.data.title,
            visibility: args.data.visibility,
            board_sorting_mode: args.data.board_sorting_mode,
            board_sorting_order: args.data.board_sorting_order,
            board_sorting_stack: args.data.board_sorting_stack,
            board_subtask_setting: args.data.board_subtask_setting,
            board_empty_sections: args.data.board_empty_sections,
          };
        },
        update: async (args) => {
          updateCalls.push(args);
          const hasStack = Object.hasOwn(args.data, "board_sorting_stack");
          return {
            id: storedView.id,
            title: storedView.title,
            slug: null,
            visibility: storedView.visibility,
            board_filters: storedView.board_filters,
            board_sorting_mode:
              args.data.board_sorting_mode ?? storedView.board_sorting_mode,
            board_sorting_order: "Descending",
            board_sorting_stack: hasStack
              ? args.data.board_sorting_stack
              : storedView.board_sorting_stack,
            board_subtask_setting:
              args.data.board_subtask_setting ?? storedView.board_subtask_setting,
            board_empty_sections:
              args.data.board_empty_sections ?? storedView.board_empty_sections,
          };
        },
      },
  };
  stubModule("src/lib/prisma.ts", { default: prismaStub });
  stubModule("src/lib/realtime/server.ts", {
    broadcastBoardChange: () => undefined,
  });
  stubModule("src/utils/controllers/projects/views/boardFilterWriteLock.ts", {
    acquireBoardFilterWriteLock: async () => undefined,
    assertViewIsNotManagedSmartSplit: async () => undefined,
    validateBoardFilterLabelReferences: async () => undefined,
    withBoardFilterWriteLock: async (_projectId, _filters, operation) => operation(prismaStub),
  });
  stubModule("src/lib/mcp/tasks/services.ts", {
    matchLabelIds: () => ({ ids: [], unresolved: [] }),
    validateProjectAccess: async () => ({}),
    validateProjectMemberIds: async () => ({ invalidIds: [], error: null }),
  });
  stubModule(
    "src/utils/controllers/projects/views/viewsHelperAPIfunctions.ts",
    { getUniqueSlug: async () => null },
  );

  const services = createJiti("services")(
    path.join(root, "src/lib/mcp/views/services.ts"),
  );
  return { ...services, createCalls, updateCalls };
}

test("view validation accepts two sorting stack entries and rejects three", () => {
  const { CreateViewInputSchema, UpdateViewInputSchema } = loadViewSchemas();
  const twoEntries = [
    { mode: "DueDate", order: "Ascending" },
    { mode: "Size", order: "Descending" },
  ];

  assert.equal(
    CreateViewInputSchema.safeParse({
      project_id: 15,
      title: "Two tie-breakers",
      sorting_mode: "Priority",
      sorting_stack: twoEntries,
    }).success,
    true,
  );
  assert.equal(
    UpdateViewInputSchema.safeParse({
      viewId,
      sorting_stack: [...twoEntries, { mode: "CreatedAt", order: "Ascending" }],
    }).success,
    false,
  );
  assert.equal(
    UpdateViewInputSchema.safeParse({
      viewId,
      sorting_stack: [{ mode: "Manual", order: "Ascending" }],
    }).success,
    false,
  );
});

test("MCP view validation preserves native filters and visible columns", () => {
  const { CreateViewInputSchema, UpdateViewInputSchema } = loadViewSchemas();
  const board_filters = {
    matchFilters: "ALL",
    addedFilters: [{
      type: "Status",
      match: "ANY",
      searchPayload: [{ value: "Normal" }],
    }],
  };
  const visible_section_ids = [11, 12];

  const created = CreateViewInputSchema.parse({
    project_id: 15,
    title: "Native board view",
    board_filters,
    visible_section_ids,
  });
  const updated = UpdateViewInputSchema.parse({
    viewId,
    board_filters,
    visible_section_ids,
  });

  assert.deepEqual(created.board_filters, board_filters);
  assert.deepEqual(created.visible_section_ids, visible_section_ids);
  assert.deepEqual(updated.board_filters, board_filters);
  assert.deepEqual(updated.visible_section_ids, visible_section_ids);
  assert.deepEqual(
    UpdateViewInputSchema.parse({ viewId, visible_section_ids: [] }).visible_section_ids,
    [],
  );
});

test("sanitizeSortingStack drops Manual entries", () => {
  const sanitizeSortingStack = loadSanitizer();

  assert.deepEqual(
    sanitizeSortingStack(
      [
        { mode: "Manual", order: "Ascending" },
        { mode: "DueDate", order: "Descending" },
      ],
      "Priority",
    ),
    [{ mode: "DueDate", order: "Descending" }],
  );
});

test("createView writes the sanitized board_sorting_stack", async () => {
  const { createView, createCalls } = loadViewServices();

  await createView({
    projectId: 15,
    userId: 6,
    title: "Stacked view",
    sorting_mode: "Priority",
    sorting_stack: [
      { mode: "Priority", order: "Ascending" },
      { mode: "Manual", order: "Descending" },
      { mode: "DueDate", order: "Ascending" },
    ],
  });

  assert.deepEqual(createCalls[0].data.board_sorting_stack, [
    { mode: "DueDate", order: "Ascending" },
  ]);
});

test("updateView keeps an existing stack when sorting_stack is absent", async () => {
  const { updateView, updateCalls } = loadViewServices();

  await updateView({ viewId, userId: 6, sorting_order: "Ascending" });

  assert.equal(Object.hasOwn(updateCalls[0].data, "board_sorting_stack"), false);
});

test("updateView clears an existing stack when sorting_stack is empty", async () => {
  const { updateView, updateCalls } = loadViewServices();

  await updateView({ viewId, userId: 6, sorting_stack: [] });

  assert.deepEqual(updateCalls[0].data.board_sorting_stack, []);
});

test("view validation accepts every subtask display mode and rejects unknown modes", () => {
  const { CreateViewInputSchema, UpdateViewInputSchema } = loadViewSchemas();
  const settings = ["None", "Parent", "Flattened", "Card", "Flattened_Card"];

  for (const subtask_setting of settings) {
    assert.equal(
      CreateViewInputSchema.safeParse({
        project_id: 15,
        title: `Subtasks ${subtask_setting}`,
        subtask_setting,
      }).success,
      true,
    );
    assert.equal(
      UpdateViewInputSchema.safeParse({ viewId, subtask_setting }).success,
      true,
    );
  }

  assert.equal(
    CreateViewInputSchema.safeParse({
      project_id: 15,
      title: "Bad setting",
      subtask_setting: "Visible",
    }).success,
    false,
  );
  assert.equal(
    UpdateViewInputSchema.safeParse({
      viewId,
      subtask_setting: "Visible",
    }).success,
    false,
  );
});

test("createView writes and returns the selected subtask display mode", async () => {
  const { createView, createCalls } = loadViewServices();

  const view = await createView({
    projectId: 15,
    userId: 6,
    title: "Flattened subtasks",
    subtask_setting: "Flattened_Card",
  });

  assert.equal(createCalls[0].data.board_subtask_setting, "Flattened_Card");
  assert.equal(view.board_subtask_setting, "Flattened_Card");
});

test("updateView changes subtask display without rewriting unrelated settings", async () => {
  const { updateView, updateCalls } = loadViewServices();

  const view = await updateView({
    viewId,
    userId: 6,
    subtask_setting: "Card",
  });

  assert.equal(updateCalls[0].data.board_subtask_setting, "Card");
  assert.equal(Object.hasOwn(updateCalls[0].data, "board_sorting_stack"), false);
  assert.equal(view.board_subtask_setting, "Card");
});

test("createView and updateView persist and return the empty-section setting", async () => {
  const { createView, createCalls, updateView, updateCalls } = loadViewServices();

  const created = await createView({
    projectId: 15,
    userId: 6,
    title: "Hide empty columns",
    board_empty_sections: "Hidden",
  });
  const updated = await updateView({
    viewId,
    userId: 6,
    board_empty_sections: "Hidden",
  });

  assert.equal(createCalls[0].data.board_empty_sections, "Hidden");
  assert.equal(created.board_empty_sections, "Hidden");
  assert.equal(updateCalls[0].data.board_empty_sections, "Hidden");
  assert.equal(updated.board_empty_sections, "Hidden");
});

test("view services reject an unknown empty-section setting before writing", async () => {
  const { createView, createCalls, updateView, updateCalls } = loadViewServices();

  await assert.rejects(
    createView({
      projectId: 15,
      userId: 6,
      title: "Bad empty columns",
      board_empty_sections: "Hide",
    }),
    /board_empty_sections must be Show or Hidden/,
  );
  await assert.rejects(
    updateView({ viewId, userId: 6, board_empty_sections: "Hide" }),
    /board_empty_sections must be Show or Hidden/,
  );

  assert.equal(createCalls.length, 0);
  assert.equal(updateCalls.length, 0);
});

test("MCP view routes forward board_empty_sections to the shared service", () => {
  const createRoute = fs.readFileSync(
    path.join(root, "src/app/api/mcp/view/route.ts"),
    "utf8",
  );
  const updateRoute = fs.readFileSync(
    path.join(root, "src/app/api/mcp/view/[viewId]/route.ts"),
    "utf8",
  );

  assert.match(createRoute, /board_empty_sections: body\.board_empty_sections/);
  assert.match(updateRoute, /board_empty_sections: body\.board_empty_sections/);
});
