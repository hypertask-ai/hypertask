const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

const now = new Date("2026-11-14T16:00:00Z");
const day = 24 * 60 * 60 * 1000;

function queue() {
  const scheduled = [];
  const { scheduleDueDateJob } = load("src/pages/api/queues/duedateQueue.ts", {
    "@/lib/qstash": {
      scheduleJobById: async (job) => { scheduled.push(job); return { messageId: "m1" }; },
      cancelJobById: async () => {},
      withQstashSignature: (handler) => handler,
    },
    "@/utils/controllers/tasks/invokeDueDate": { default: async () => "skipped" },
  });
  return { scheduled, scheduleDueDateJob };
}

test.beforeEach(() => test.mock.timers.enable({ apis: ["Date"], now }));
test.afterEach(() => test.mock.timers.reset());

test("a due date within the queue delay limit is scheduled", async () => {
  const { scheduled, scheduleDueDateJob } = queue();
  await scheduleDueDateJob({ taskId: 5, projectId: 7049 }, new Date(now.getTime() + 300 * day));
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].notBefore, Math.floor((now.getTime() + 300 * day) / 1000));
});

test("a due date beyond the queue delay limit is not sent to the queue", async () => {
  const { scheduled, scheduleDueDateJob } = queue();
  await scheduleDueDateJob({ taskId: 5, projectId: 7049 }, new Date("2031-06-01T09:00:00Z"));
  assert.equal(scheduled.length, 0);
});

const qstashMaxDelaySeconds = 31622400;

function dueDateRoute() {
  const scheduled = [];
  const { POST } = load("src/lib/api/task-writes/due-date.ts", {
    "./route": { taskWriteRoute: (options) => options },
    "@/lib/auth/resolveActingAgent": { resolveActingAgent: () => ({ ok: true, agentId: null }) },
    "@/lib/prisma": { default: { agent: { findUnique: async () => null } } },
    "@/utils/controllers/activities/createTaskDueDateActivity": { default: async () => {} },
    "@/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove": { default: async () => {} },
    "@/lib/qstash": {
      scheduleJobById: async (job) => {
        if (job.notBefore - Math.floor(Date.now() / 1000) > qstashMaxDelaySeconds) {
          throw new Error(`QstashError: {"error":"quota maxDelay exceeded, current limit: ${qstashMaxDelaySeconds}"}`);
        }
        scheduled.push(job);
        return { messageId: "m1" };
      },
      cancelJobById: async () => {},
      withQstashSignature: (handler) => handler,
    },
    "@/utils/controllers/tasks/invokeDueDate": { default: async () => "skipped" },
    "@/utils/controllers/tasks/single": {
      updateTaskSingle: async (patch) => ({ status: 200, json: { id: 5, projectId: 7049, dueDate: new Date(patch.dueDate) }, oldTask: { dueDate: null } }),
    },
    "@/lib/realtime/server": { broadcastBoardChange: () => {}, broadcastTaskChange: () => {} },
    "@/lib/auth/sessionUserRecord": { loadSessionUserRecord: async () => ({ id: 985 }) },
  });
  const set = (dueDate) => POST.operation(
    { taskId: 5, dueDate },
    { user: { id: 985 }, session: { userId: 985, agentId: null, teamScope: null } },
  );
  return { scheduled, set };
}

test("setting a due date years ahead answers success and saves the date", async () => {
  const { scheduled, set } = dueDateRoute();
  const response = await set("2031-06-01T09:00:00.000Z");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).id, 5);
  assert.equal(scheduled.length, 0);
});

test("setting a due date inside the limit still schedules its job", async () => {
  const { scheduled, set } = dueDateRoute();
  const response = await set(new Date(now.getTime() + 30 * day).toISOString());
  assert.equal(response.status, 200);
  assert.equal(scheduled.length, 1);
});
