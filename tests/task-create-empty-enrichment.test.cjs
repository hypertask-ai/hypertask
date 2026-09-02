const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function compile(relativePath) {
  return ts.transpileModule(
    fs.readFileSync(path.join(root, relativePath), "utf8"),
    {
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
}

function execute(javascript, stubs) {
  const originalLoad = Module._load;
  Module._load = (request, parent, isMain) =>
    stubs[request] ?? originalLoad(request, parent, isMain);
  try {
    const mod = { exports: {} };
    new Function("module", "exports", "require", javascript)(
      mod,
      mod.exports,
      (request) => stubs[request] ?? require(request),
    );
    return mod.exports;
  } finally {
    Module._load = originalLoad;
  }
}

function responseHarness() {
  let status = 200;
  let body;
  const headers = {};
  return {
    response: {
      setHeader: (name, value) => {
        headers[name] = value;
      },
      status: (nextStatus) => {
        status = nextStatus;
        return {
          json: (nextBody) => {
            body = nextBody;
            return nextBody;
          },
        };
      },
    },
    result: () => ({ status, body, headers }),
  };
}

function loadCreateRoute() {
  const calls = { relations: 0, urls: 0 };
  const createdTaskData = [];
  const background = [];
  const task = {
    id: 41,
    title: "Fast create",
    description: "",
    description_: { id: 51, taskId: 41, content: "" },
    section: "Backlog",
    sectionId: 9,
    projectId: 15,
    project: { id: 15, teamId: null },
    parentTask: null,
    parentTaskId: null,
    userId: 6,
    uniqueIndex: 41,
    ticketNumber: "HTPR-41",
    ranking: "rank",
    status: "Normal",
    dueDate: null,
  };
  const tx = {
    $executeRaw: async () => undefined,
    task: {
      create: async ({ data }) => {
        createdTaskData.push(data);
        return task;
      },
    },
    priority: { create: async () => undefined },
    taskLabel: {
      createMany: async () => undefined,
      findMany: async () => [],
    },
  };
  const prisma = {
    user: {
      findUnique: async () => ({
        id: 6,
        displayName: "Valentin",
        photoURL: null,
        email: "v@example.test",
      }),
    },
    project: { findFirst: async () => ({ id: 15 }) },
    section: {
      findUnique: async () => ({ section_title: "Backlog" }),
      findFirst: async ({ where }) =>
        where.section_title && where.section_title !== "Backlog"
          ? null
          : { id: 9, section_title: "Backlog" },
    },
    agent: { findFirst: async () => null },
    team_Activity: { update: async () => undefined },
    drafts: { createMany: async () => undefined },
  };
  const stubs = {
    "@prisma/client": {
      Prisma: { PrismaClientKnownRequestError: class extends Error {} },
    },
    "@vercel/functions": {
      waitUntil: (promise) => background.push(promise),
    },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/utils/generateRank": { __esModule: true, default: () => "rank" },
    "@/utils/controllers/tasks/getNextUniqueTaskIndex": {
      getNextUniqueTaskIndex: async () => 41,
    },
    "@/lib/mcp/webhooks/taskEvents": {
      createTaskWithBoardWebhookOutbox: async (_db, _actor, createTask) => {
        const created = await createTask(tx);
        return {
          result: created.result,
          boardWebhookDeliveryIds: [],
        };
      },
    },
    "@/lib/mcp/webhooks/outbox": {
      publishBoardWebhookDeliveries: async () => undefined,
    },
    "@/lib/agentWebhooks/outbox": {
      persistAgentTaskCreatedPending: async () => undefined,
      markAgentTaskCreatedReady: async () => undefined,
      emitAgentTaskCreatedWebhook: async () => undefined,
      ensurePendingAgentTaskCreatedWebhook: async () => undefined,
    },
    "@/utils/controllers/activities/createAssignedActivity": {
      assignmentActivityUserSelect: {},
    },
    "@/lib/auth/getSessionUser": {
      getSessionUser: async () => ({ userId: 6 }),
    },
    "@/utils/controllers/projects/getAllIncludes": {
      taskWriteAccessWhere: () => ({}),
    },
    "@/utils/controllers/tasks/addRelatedTasks": {
      addRelatedTasks: async () => {
        calls.relations += 1;
        return { status: 200, json: [] };
      },
    },
    "@/utils/controllers/urls/addIntoTaskDesc": {
      __esModule: true,
      default: async () => {
        calls.urls += 1;
      },
    },
    "@/utils/controllers/assignees/autoAssignForSection": {
      autoAssignForSection: async () => "ready",
    },
    "@/lib/agentWebhooks/taskCreatedRecovery": {
      recoverPendingAgentTaskCreatedWebhook: async () => "recovered",
    },
    "@/utils/controllers/turbopuffer/turbopufferHelper": {
      upsertTaskToTurbopuffer: async () => undefined,
    },
    "../queues/FAST/generateSummary": {
      __esModule: true,
      default: async () => undefined,
    },
    "@/lib/ai/labelClassifier": {
      classifyTaskAiLabels: async () => undefined,
    },
    "@/lib/realtime/server": {
      broadcastBoardChange: async () => undefined,
    },
  };

  return {
    handler: execute(
      compile("src/pages/api/tasks/createGlobally.ts"),
      stubs,
    ).default,
    calls,
    background,
    createdTaskData,
  };
}

const taskCreateBody = (overrides = {}) => ({
  title: "Fast create",
  userId: 6,
  projectId: 15,
  projectIdentifier: "HTPR",
  ranking: "rank",
  section_title: "Backlog",
  sectionId: 9,
  tags: [],
  assignees: [],
  relationsToAdd: [],
  urlsToAdd: [],
  description: "",
  ...overrides,
});

async function createTask(handler, body, response) {
  await handler(
    {
      method: "POST",
      headers: {},
      body,
    },
    response.response,
  );
}

test("plain task creation skips empty relation and URL enrichment", async () => {
  const { handler, calls, background } = loadCreateRoute();
  const response = responseHarness();

  await createTask(handler, taskCreateBody(), response);
  await Promise.all(background);

  const result = response.result();
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(calls, { relations: 0, urls: 0 });
  assert.deepEqual(result.body.newTask.relatedTasks, {
    status: 200,
    json: [],
  });
});

test("task creation still persists requested relations and URLs", async () => {
  const { handler, calls, background } = loadCreateRoute();
  const response = responseHarness();

  await createTask(
    handler,
    taskCreateBody({
      relationsToAdd: [{ projectId: "15", uniqueIndex: "40" }],
      urlsToAdd: [{ urlString: "https://example.test" }],
    }),
    response,
  );
  await Promise.all(background);

  assert.equal(response.result().status, 200);
  assert.deepEqual(calls, { relations: 1, urls: 1 });
});

test("section fallback stays board-scoped and persists start dates", async () => {
  const { handler, background, createdTaskData } = loadCreateRoute();
  const response = responseHarness();
  const startDate = new Date("2026-09-05T00:00:00.000Z");

  await createTask(
    handler,
    taskCreateBody({ sectionId: undefined, startDate }),
    response,
  );
  await Promise.all(background);

  assert.equal(response.result().status, 200);
  assert.equal(createdTaskData[0].section, "Backlog");
  assert.equal(createdTaskData[0].sectionId, 9);
  assert.equal(createdTaskData[0].startDate, startDate);
});

test("section fallback rejects a foreign section title", async () => {
  const { handler, background, createdTaskData } = loadCreateRoute();
  const response = responseHarness();

  await createTask(
    handler,
    taskCreateBody({ sectionId: undefined, section_title: "Foreign" }),
    response,
  );
  await Promise.all(background);

  assert.equal(response.result().status, 400);
  assert.match(response.result().body.message, /does not belong/);
  assert.equal(createdTaskData.length, 0);
});
