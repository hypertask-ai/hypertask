const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function load(relativePath, stubs) {
  const javascript = ts.transpileModule(
    fs.readFileSync(path.join(root, relativePath), "utf8"),
    {
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", javascript)(
    mod,
    mod.exports,
    (request) => {
      assert.ok(request in stubs, `Unexpected dependency: ${request}`);
      return stubs[request];
    },
  );
  return mod.exports;
}

function harness() {
  const rows = [{ id: 1, projectId: 15, uniqueIndex: 41 }];
  const deliveries = [];
  const events = [];
  let lockTail = Promise.resolve();
  const aggregate = async ({ where }) => ({
    _max: {
      uniqueIndex: Math.max(...rows.filter((row) => row.projectId === where.projectId).map((row) => row.uniqueIndex)),
    },
  });
  const prisma = {
    project: {
      findFirst: async () => ({ id: 15 }),
      findUnique: async () => ({ id: 15, uniqueIdentifier: "TEST" }),
    },
    section: { findFirst: async () => ({ id: 9, section_title: "Backlog" }) },
    task: { aggregate, count: async () => 1 },
    team_Activity: { update: async () => undefined },
    drafts: { create: async () => undefined },
    $transaction: async (callback) => {
      let releaseLock;
      const tx = {
        project: prisma.project,
        $executeRaw: async (strings, ...values) => {
          assert.match(strings.join("?"), /pg_advisory_xact_lock\(\?::int, \?::int\)/);
          assert.deepEqual(values, [9428471, 15], "must share createGlobally's board lock key");
          const previous = lockTail;
          lockTail = new Promise((resolve) => { releaseLock = resolve; });
          await previous;
          events.push("lock");
        },
        task: {
          aggregate: async (args) => {
            assert.ok(releaseLock, "allocation must be inside the locked transaction");
            events.push("allocate");
            return aggregate(args);
          },
          create: async ({ data }) => {
            if (rows.some((row) => row.projectId === data.projectId && row.uniqueIndex === data.uniqueIndex)) {
              throw new Error("Unique constraint failed: projectId, uniqueIndex");
            }
            const row = {
              ...data,
              id: rows.length + 1,
              status: "Normal",
              dueDate: null,
              startDate: null,
              project: { teamId: 2 },
              priority: data.priority ? { id: "priority", ...data.priority.create } : null,
              taskLabels: [],
            };
            rows.push(row);
            events.push("create");
            return row;
          },
        },
        webhookSubscription: { findMany: async () => [] },
        boardWebhookDelivery: { create: async () => undefined },
      };
      try {
        return await callback(tx);
      } finally {
        if (releaseLock) {
          events.push("commit");
          releaseLock();
        }
      }
    },
  };
  const indexModule = load("src/utils/controllers/tasks/getNextUniqueTaskIndex.ts", {
    "@/lib/prisma": { __esModule: true, default: prisma },
  });
  const webhookModule = load("src/lib/mcp/webhooks/taskEvents.ts", {
    "./outbox": {
      persistBoardWebhookEvent: async (_tx, _projectId, event) => {
        deliveries.push(event);
        return [];
      },
    },
  });
  const { default: create } = load("src/utils/controllers/tasks/create.ts", {
    "../description/common-description-create": { __esModule: true, default: async () => undefined },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/ai/labelClassifier": { scheduleClassifyTaskAiLabels: () => undefined },
    "./getNextUniqueTaskIndex": indexModule,
    "@/utils/controllers/projects/getAllIncludes": { taskWriteAccessWhere: () => ({}) },
    "@/utils/controllers/assignees/autoAssignForSection": { autoAssignForSection: async () => "ready" },
    "@/lib/mcp/webhooks/taskEvents": webhookModule,
    "@/lib/mcp/webhooks/outbox": { publishBoardWebhookDeliveries: async () => undefined },
    "@/lib/agentWebhooks/outbox": {
      persistAgentTaskCreatedPending: async () => undefined,
      markAgentTaskCreatedReady: async () => undefined,
      emitAgentTaskCreatedWebhook: async () => undefined,
    },
  });
  return { create, rows, deliveries, events };
}

for (const index of [undefined, 0]) {
  test(`four concurrent task creates allocate distinct board numbers (${index === 0 ? "urgent" : "normal"} branch)`, async () => {
    const { create, rows, deliveries, events } = harness();
    const results = await Promise.all(Array.from({ length: 4 }, (_, i) => create({
      title: `Concurrent task ${i}`,
      description: "",
      section: "Backlog",
      userId: 7,
      ranking: `rank-${i}`,
      projectId: 15,
      sectionId: 9,
      index,
      currentUser: { id: 7 },
    })));

    assert.deepEqual(results.map((result) => result.status), [200, 200, 200, 200]);
    const created = rows.slice(1);
    assert.deepEqual(created.map((row) => row.uniqueIndex), [42, 43, 44, 45]);
    assert.deepEqual(created.map((row) => row.ticketNumber), ["TEST-42", "TEST-43", "TEST-44", "TEST-45"]);
    assert.equal(new Set(created.map((row) => row.title)).size, 4, "no creation is lost");
    assert.deepEqual(created.map((row) => row.priority?.Priority_Value ?? null), Array(4).fill(index === 0 ? "Urgent" : null));
    assert.deepEqual(deliveries.map((event) => event.data.task.ticketNumber), created.map((row) => row.ticketNumber));
    assert.deepEqual(events, Array.from({ length: 4 }, () => ["lock", "allocate", "create", "commit"]).flat());
  });
}
