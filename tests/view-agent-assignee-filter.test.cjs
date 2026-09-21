const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const agentId = "8f4e8f0c-cc2d-4ee1-9e98-98f6ff32008f";
const unknownAgentId = "3eb7d9b1-4a30-47f8-8b5d-57ff78d72b1c";
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

function loadViewSchemas() {
  const jiti = require("jiti")(
    path.join(root, `tests/view-agent-validation-jiti-${++jitiEntryId}.cjs`),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
      cache: false,
    },
  );
  return jiti(
    path.join(root, "src/lib/mcp-server/validations/view.validation.ts"),
  );
}

function loadCreateView({ agents = [], users = [] } = {}) {
  resetModules();
  const viewCreateCalls = [];
  const agentFindManyCalls = [];

  const prismaStub = {
      agent: {
        findMany: async (args) => {
          agentFindManyCalls.push(args);
          return agents.filter((agent) => args.where.id.in.includes(agent.id));
        },
      },
      project_View: {
        upsert: async () => ({ id: "project-view-1" }),
      },
      user: {
        findMany: async (args) =>
          users.filter((user) => args.where.id.in.includes(user.id)),
      },
      view: {
        findFirst: async () => null,
        create: async (args) => {
          viewCreateCalls.push(args);
          return {
            id: "view-1",
            title: args.data.title,
            visibility: args.data.visibility,
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
    validateProjectMemberIds: async (_projectId, userIds) => ({
      invalidIds: userIds.filter((id) => !users.some((user) => user.id === id)),
      error: null,
    }),
  });
  stubModule("src/lib/realtime/server.ts", {
    broadcastBoardChange: () => undefined,
  });
  stubModule(
    "src/utils/controllers/projects/views/viewsHelperAPIfunctions.ts",
    { getUniqueSlug: async () => null },
  );

  const jiti = require("jiti")(
    path.join(root, `tests/view-agent-service-jiti-${++jitiEntryId}.cjs`),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
      cache: false,
    },
  );
  const { createView } = jiti(
    path.join(root, "src/lib/mcp/views/services.ts"),
  );

  return { createView, viewCreateCalls, agentFindManyCalls };
}

test("create and update view validation accept agent UUIDs and reject garbage", () => {
  const { CreateViewInputSchema, UpdateViewInputSchema } = loadViewSchemas();

  assert.equal(
    CreateViewInputSchema.safeParse({
      project_id: 15,
      title: "Agent view",
      filters: { assignee_ids: [agentId] },
    }).success,
    true,
  );
  assert.equal(
    UpdateViewInputSchema.safeParse({
      viewId,
      assignee_ids: [agentId],
    }).success,
    true,
  );
  assert.equal(
    CreateViewInputSchema.safeParse({
      project_id: 15,
      title: "Invalid agent view",
      filters: { assignee_ids: ["not-a-uuid"] },
    }).success,
    false,
  );
  assert.equal(
    UpdateViewInputSchema.safeParse({
      viewId,
      assignee_ids: ["not-a-uuid"],
    }).success,
    false,
  );
});

test("stored assignee filters keep user uid and omit uid from agent entries", async () => {
  const user = {
    id: 42,
    uid: "firebase-user-42",
    email: "person@example.com",
    displayName: "Person",
    photoURL: null,
  };
  const agent = { id: agentId, displayName: "Build Agent" };
  const { createView, viewCreateCalls, agentFindManyCalls } = loadCreateView({
    agents: [agent],
    users: [user],
  });

  await createView({
    projectId: 15,
    userId: 6,
    title: "Mixed assignees",
    filters: { assignee_ids: [user.id, agent.id] },
  });

  const assigneesEntry = viewCreateCalls[0].data.board_filters.addedFilters[0];
  assert.deepEqual(assigneesEntry, {
    type: "Assignees",
    searchPayload: [
      {
        id: user.id,
        uid: user.uid,
        displayName: user.displayName,
        photoURL: user.photoURL,
      },
      agent,
    ],
  });
  assert.equal(Object.hasOwn(assigneesEntry.searchPayload[0], "uid"), true);
  assert.equal(Object.hasOwn(assigneesEntry.searchPayload[1], "uid"), false);
  assert.deepEqual(agentFindManyCalls[0], {
    where: {
      id: { in: [agentId] },
      revokedAt: null,
      members: { some: { projectId: 15 } },
    },
    select: { id: true, displayName: true },
  });
});

test("full native board filters validate and canonicalize assignee references", async () => {
  const user = {
    id: 42,
    uid: "firebase-user-42",
    displayName: "Person",
    photoURL: null,
  };
  const { createView, viewCreateCalls } = loadCreateView({ users: [user] });

  await createView({
    projectId: 15,
    userId: 6,
    title: "Native view",
    board_filters: {
      matchFilters: "ALL",
      addedFilters: [{
        type: "Assignees",
        match: "ANY",
        searchPayload: [{ id: user.id, uid: "native-42", displayName: "Stale device name" }],
      }],
    },
  });

  assert.deepEqual(viewCreateCalls[0].data.board_filters.addedFilters[0], {
    type: "Assignees",
    match: "ANY",
    searchPayload: [{
      id: user.id,
      uid: user.uid,
      displayName: user.displayName,
      photoURL: user.photoURL,
    }],
  });
});

test("unknown agent UUIDs produce a clear assignee error", async () => {
  const { createView } = loadCreateView();

  await assert.rejects(
    createView({
      projectId: 15,
      userId: 6,
      title: "Unknown agent",
      filters: { assignee_ids: [unknownAgentId] },
    }),
    new Error(
      `assignee ${unknownAgentId} is neither a project member nor an agent on this board`,
    ),
  );
});
