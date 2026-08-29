const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

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

function loadRoute({ agentId = "agent-1", records } = {}) {
  const calls = { queries: [], userInbox: 0 };
  const invocationRecords = records ?? [
    {
      id: 8821,
      taskId: 27744,
      projectId: 15,
      commentId: null,
      fromUserId: 6,
      fromAgentId: null,
      agentId: "agent-1",
      type: "Mentioned",
      status: "Normal",
      agentReplyConsumedAt: null,
      taskStatus: "Normal",
      projectAccess: [{ userId: 6, actingAgentId: "agent-1" }],
      createdAt: new Date("2026-08-21T12:00:00.000Z"),
    },
  ];
  const dependencies = [
    "src/app/api/mcp/inbox/list/route.ts",
    "src/lib/mcp/auth.ts",
    "src/lib/mcp/agents.ts",
    "src/utils/controllers/notifications/getAll.ts",
    "src/utils/controllers/notifications/getStructuredInboxForAgent.ts",
    "src/lib/prisma.ts",
    "src/utils/controllers/projects/getAllIncludes.ts",
    "src/lib/configs/general.config.ts",
  ];
  for (const dependency of dependencies) {
    delete require.cache[path.join(root, dependency)];
  }

  stubModule("src/lib/mcp/auth.ts", {
    checkMcpRateLimit: async () => null,
    validateMcpAuth: async () => ({
      user: { id: 6, email: "owner@example.test" },
      agentId,
    }),
    createUnauthorizedResponse: () =>
      new Response(JSON.stringify({ success: false }), { status: 401 }),
  });
  stubModule("src/lib/mcp/agents.ts", {
    getMcpSessionAgentSummary: async () => null,
  });
  stubModule("src/utils/controllers/notifications/getAll.ts", {
    default: async () => {
      calls.userInbox += 1;
      return { status: 200, json: { structuredData: {}, notifications: [] } };
    },
  });
  stubModule(
    "src/utils/controllers/notifications/getStructuredInboxForAgent.ts",
    {
      getStructuredInboxForAgent: async () => ({
        ok: true,
        structuredData: {},
        notifications: [],
      }),
    },
  );
  stubModule("src/lib/prisma.ts", {
    default: {
      notification: {
        findMany: async (query) => {
          calls.queries.push(query);
          const projectAccess = query.where.task?.project?.accessibleBy;
          return invocationRecords
            .filter(
              (row) =>
                row.agentId === query.where.agentId &&
                row.projectId === query.where.projectId &&
                row.taskId === query.where.taskId &&
                row.type === query.where.type &&
                row.status === query.where.status &&
                row.agentReplyConsumedAt === null &&
                row.fromAgentId === null &&
                row.taskStatus === query.where.task?.status &&
                row.projectAccess.some(
                  (access) =>
                    access.userId === projectAccess?.userId &&
                    access.actingAgentId === projectAccess?.actingAgentId,
                )
            )
            .slice(0, query.take)
            .map(({ id, taskId, projectId, commentId, fromUserId, createdAt }) => ({
              id,
              taskId,
              projectId,
              commentId,
              fromUserId,
              createdAt,
            }));
        },
      },
    },
  });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", {
    getProjectListingWhere: (userId, actingAgentId) => ({
      accessibleBy: { userId, actingAgentId },
    }),
  });
  stubModule("src/lib/configs/general.config.ts", {
    generalConfig: { hyperAiId: 332 },
  });

  const jiti = require("jiti")(
    path.join(root, `tests/jiti-agent-invocations-${++jitiEntryId}.cjs`),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
      cache: false,
    },
  );
  const route = jiti(path.join(root, "src/app/api/mcp/inbox/list/route.ts"));
  return { ...route, calls };
}

function request(query) {
  return new NextRequest(`https://app.hypertask.ai/api/mcp/inbox/list?${query}`);
}

test("an agent reads pending invocations without polling its owner's inbox", async () => {
  const { GET, calls } = loadRoute();
  const response = await GET(
    request("agent_invocations=true&project_id=15&task_id=27744"),
  );

  assert.equal(response.status, 200);
  assert.equal(calls.userInbox, 0);
  assert.deepEqual(await response.json(), {
    success: true,
    agent_invocations: [
      {
        id: 8821,
        task_id: 27744,
        project_id: 15,
        comment_id: null,
        from_user_id: 6,
        created_at: "2026-08-21T12:00:00.000Z",
      },
    ],
  });
  assert.deepEqual(calls.queries[0].where, {
    agentId: "agent-1",
    projectId: 15,
    taskId: 27744,
    type: "Mentioned",
    status: "Normal",
    agentReplyConsumedAt: null,
    fromAgentId: null,
    fromUserId: { not: 332 },
    task: {
      status: "Normal",
      project: { accessibleBy: { userId: 6, actingAgentId: "agent-1" } },
    },
  });
  assert.equal(calls.queries[0].take, 100);
});

test("consumed and inaccessible invocations are not exposed", async () => {
  const base = {
    id: 8821,
    taskId: 27744,
    projectId: 15,
    commentId: null,
    fromUserId: 6,
    fromAgentId: null,
    agentId: "agent-1",
    type: "Mentioned",
    status: "Normal",
    taskStatus: "Normal",
    projectAccess: [{ userId: 6, actingAgentId: "agent-1" }],
    createdAt: new Date("2026-08-21T12:00:00.000Z"),
  };
  const { GET } = loadRoute({
    records: [
      { ...base, agentReplyConsumedAt: new Date() },
      { ...base, id: 8822, agentReplyConsumedAt: null, projectAccess: [] },
    ],
  });

  const response = await GET(
    request("agent_invocations=true&project_id=15&task_id=27744"),
  );
  assert.deepEqual(await response.json(), {
    success: true,
    agent_invocations: [],
  });
});

test("a human token cannot use the agent-invocation read", async () => {
  const { GET, calls } = loadRoute({ agentId: null });
  const response = await GET(
    request("agent_invocations=true&project_id=15&task_id=27744"),
  );

  assert.equal(response.status, 403);
  assert.equal(calls.queries.length, 0);
  assert.equal(calls.userInbox, 0);
});

test("the invocation read rejects an invalid task identifier", async () => {
  const { GET, calls } = loadRoute();
  const response = await GET(
    request("agent_invocations=true&project_id=15&task_id=0"),
  );

  assert.equal(response.status, 400);
  assert.equal(calls.queries.length, 0);
});
