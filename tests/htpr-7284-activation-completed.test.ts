import assert from "node:assert/strict";
import test from "node:test";
import { ACTIVATION_METRIC_VERSION } from "../src/lib/analytics/activationMetric";
import { activationHarness } from "./helpers/activation-harness";

process.env.POSTHOG_SERVER_PROJECT_TOKEN = "mock-local-only";

const SIGNUP = new Date("2026-10-10T12:00:00Z");
const OCCURRED = new Date("2026-10-11T12:06:00Z");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function harness(taskCount = 3, occurredAt = OCCURRED) {
  const h = activationHarness();
  h.users.get(123).joinedAt = SIGNUP;
  Object.assign(h.projects.get(15), { id: 15, ownerId: 123, seeded: false, status: "Normal", createdAt: SIGNUP, teamId: "team" });
  h.tasks.clear();
  for (let id = 1; id <= taskCount; id++) {
    h.tasks.set(id, { id, projectId: 15, userId: 123, status: "Normal", deletedAt: null, archivedAt: null, createdAt: occurredAt });
  }
  const queries: { model: string; query: any }[] = [];
  const select = (row: any, fields: any) => row ? Object.fromEntries(Object.keys(fields).map((key) => [key, row[key]])) : null;
  h.prisma.user.findUnique = async (query: any) => {
    queries.push({ model: "user", query });
    return select(h.users.get(query.where.id), query.select);
  };
  h.prisma.project.findMany = async (query: any) => {
    queries.push({ model: "project", query });
    const { where } = query;
    if (query.select?._count) {
      const taskWhere = query.select._count.select.tasks.where;
      return [...h.projects.values()]
        .filter((board) => board.ownerId === where.ownerId && board.seeded === where.seeded && board.status === where.status)
        .map((board) => ({
          id: board.id, teamId: board.teamId,
          _count: { tasks: [...h.tasks.values()].filter((task) => task.projectId === board.id && task.status === taskWhere.status && task.deletedAt === null && task.archivedAt === null && task.createdAt <= taskWhere.createdAt.lte).length },
        }));
    }
    const boards = [...h.projects.values()].filter((board) => board.ownerId === where.ownerId && board.seeded === where.seeded);
    return boards.filter((board) => board.createdAt >= where.createdAt.gte && board.createdAt < where.createdAt.lt)
      .sort((a, b) => a.id - b.id).map((board) => select(board, query.select));
  };
  h.prisma.task.findMany = async (query: any) => {
    queries.push({ model: "task", query });
    const { where } = query;
    return [...h.tasks.values()].filter((task) => where.projectId.in.includes(task.projectId) && task.createdAt >= where.createdAt.gte && task.createdAt < where.createdAt.lt)
      .sort((a, b) => a.createdAt - b.createdAt || a.id - b.id).map((task) => select(task, query.select));
  };
  const api = h.load("src/lib/telemetry/activationCompleted.ts");
  const occurrences = h.load("src/lib/telemetry/analyticsOccurrences.ts");
  return {
    ...h,
    queries,
    occurrences,
    capture: (userId = 123, at = occurredAt) => api.captureActivationCompleted(userId, at),
    expectedProperties: (userId: number, boardId: number, teamId: string, activatedAt: Date) => ({
      ...occurrences.serverAnalyticsProperties(userId, teamId, boardId, `activation_completed:${userId}`, activatedAt),
      account_category: "customer",
      signup_at: SIGNUP.toISOString(),
      activated_at: activatedAt.toISOString(),
      hours_since_signup: Math.round((activatedAt.getTime() - SIGNUP.getTime()) / 360000) / 10,
      task_count: 3,
      is_seeded: false,
      definition_version: ACTIVATION_METRIC_VERSION,
      activation_task_ids: ["1", "2", "3"],
    }),
  };
}

test("third live task within seven days captures the owner activation contract", async () => {
  const h = harness();
  await h.capture();
  assert.equal(h.captures.length, 1);
  const [{ distinctId, event, properties }] = h.captures;
  assert.equal(distinctId, "123");
  assert.equal(event, "activation_completed");
  assert.deepEqual(properties, h.expectedProperties(123, 15, "team", OCCURRED));
});

test("second task does not activate; adding the third does", async () => {
  const h = harness(2);
  await h.capture();
  assert.equal(h.captures.length, 0);
  h.tasks.set(3, { ...h.tasks.get(2), id: 3 });
  await h.capture();
  assert.equal(h.captures.length, 1);
});

for (const [offset, expected] of [[WEEK_MS, 0], [WEEK_MS - 1, 1], [WEEK_MS + 1, 0]] as const) {
  test(`signup deadline at ${offset} ms captures ${expected} events`, async () => {
    const h = harness(3, new Date(SIGNUP.getTime() + offset));
    await h.capture();
    assert.equal(h.captures.length, expected);
    if (!expected) assert.deepEqual(h.queries.map(({ model }) => model), ["user"]);
  });
}

for (const boardChange of [{ seeded: true }, { ownerId: 777 }] as const) {
  test(`ineligible board ${JSON.stringify(boardChange)} never counts`, async () => {
    const h = harness();
    Object.assign(h.projects.get(15), boardChange);
    await h.capture();
    assert.equal(h.captures.length, 0);
    Object.assign(h.projects.get(15), { seeded: false, status: "Normal", ownerId: 123 });
    await h.capture();
    assert.equal(h.captures.length, 1);
  });
}

test("later board archival or deletion still counts toward activation", async () => {
  for (const change of [{ status: "Deleted" }, { status: "Archive" }] as const) {
    const h = harness();
    Object.assign(h.projects.get(15), change);
    await h.capture();
    assert.equal(h.captures.length, 1);
  }
});

test("later task archival, deletion, or post-window creation still uses creation facts", async () => {
  for (const change of [{ status: "Deleted" }, { status: "Archive" }, { deletedAt: OCCURRED }, { archivedAt: OCCURRED }] as const) {
    const h = harness();
    Object.assign(h.tasks.get(3), change);
    await h.capture();
    assert.equal(h.captures.length, 1);
  }
  const h = harness();
  Object.assign(h.tasks.get(3), { createdAt: new Date(SIGNUP.getTime() + WEEK_MS) });
  await h.capture();
  assert.equal(h.captures.length, 0);
});

test("tasks on different boards do not combine; any qualifying owned board can activate", async () => {
  const h = harness();
  h.projects.set(16, { ...h.projects.get(15), id: 16, teamId: "other-team", createdAt: SIGNUP });
  h.tasks.get(3).projectId = 16;
  await h.capture();
  assert.equal(h.captures.length, 0);
  h.tasks.set(4, { ...h.tasks.get(3), id: 4, createdAt: OCCURRED });
  h.tasks.set(5, { ...h.tasks.get(3), id: 5, createdAt: OCCURRED });
  await h.capture();
  assert.equal(h.captures[0].properties.board_id, "16");
  assert.equal(h.captures[0].properties.workspace_id, "other-team");
});

test("guest and missing users never activate", async () => {
  const h = harness();
  h.users.get(123).uid = "guest_local";
  await h.capture();
  await h.capture(999);
  assert.equal(h.captures.length, 0);
  assert.deepEqual(h.queries.map(({ model }) => model), ["user", "user"]);
});

test("parallel and later replays deduplicate once per user with the activation marker", async () => {
  const h = harness(4);
  await Promise.all([h.capture(), h.capture(), h.capture()]);
  await h.capture();
  assert.equal(h.captures.length, 1);
  assert.equal(h.captures[0].properties.task_count, 3);
  assert.equal(h.logs.length, 1);
  assert.equal(h.logs[0].log, "analytics:activation_completed");
  assert.equal(h.logs[0].LoggedById, 123);
  h.users.set(777, { ...h.users.get(123), id: 777 });
  h.projects.get(15).ownerId = 777;
  await h.capture(777);
  assert.equal(h.captures.length, 2);
  assert.equal(h.captures[1].distinctId, "777");
});

for (const [userId, email, category] of [[985, "qa@example.test", "qa"], [6, "owner@example.test", "internal"]] as const) {
  test(`${category} account still activates with its account_category`, async () => {
    const h = harness();
    h.users.set(userId, { ...h.users.get(123), id: userId, email });
    h.projects.get(15).ownerId = userId;
    await h.capture(userId);
    assert.equal(h.captures.length, 1);
    assert.equal(h.captures[0].properties.account_category, category);
  });
}

test("a collaborator's task evaluates only the board owner for activation", async () => {
  const h = harness();
  h.users.set(777, { ...h.users.get(123), id: 777 });
  h.projects.get(15).ownerId = 777;
  h.projects.get(15).owner = h.users.get(777);
  await h.load("src/lib/telemetry/savedWorkAnalytics.ts").captureTaskCreated(3, { userId: 123 }, "web");
  assert.deepEqual(h.captures.map((capture) => [capture.event, capture.distinctId]), [["task_created", "777"], ["activation_completed", "777"]]);
  assert.equal(h.captures.find((capture) => capture.event === "activation_completed").properties.definition_version, ACTIVATION_METRIC_VERSION);
});

test("agent-created tasks count and activation follows task_created using task.createdAt", async () => {
  const h = harness();
  for (const task of h.tasks.values()) Object.assign(task, { userId: 777, agentId: "agent-1" });
  await h.load("src/lib/telemetry/savedWorkAnalytics.ts").captureTaskCreated(3, { userId: 777, agentId: "agent-1" }, "agent");
  assert.deepEqual(h.captures.map((capture) => capture.event), ["task_created", "activation_completed"]);
  assert.equal(h.captures[1].distinctId, "123");
  assert.equal(h.captures[1].properties.activated_at, OCCURRED.toISOString());
  assert.equal(h.captures[1].properties.definition_version, ACTIVATION_METRIC_VERSION);
});

test("the shared occurrence path uses user scope and a durable deduplicated outbox", async () => {
  const h = harness();
  const rows: any[] = [];
  const delivered: any[] = [];
  Object.assign(h.mocks["@/lib/telemetry/analyticsOutbox"], {
    isAnalyticsOutboxEnabled: async () => true,
    deliverAnalyticsOutbox: async (row: any) => { delivered.push(row); },
  });
  h.prisma.analyticsOutbox = {
    findUnique: async ({ where }: any) => rows.find((row) => row.key === where.key),
    create: async ({ data }: any) => { rows.push(data); return data; },
  };
  await h.capture();
  await h.capture();
  assert.equal(rows.length, 1);
  assert.equal(delivered.length, 1);
  assert.equal(rows[0].key, "123:analytics:activation_completed");
  assert.equal(rows[0].event, "activation_completed");
  assert.equal(rows[0].occurredAt.toISOString(), OCCURRED.toISOString());
});

test("activation database failure is swallowed by the existing afterResponse boundary", async () => {
  const h = harness();
  h.setFailure("database");
  h.prisma.user.findUnique = async () => { throw Error("mock database unavailable"); };
  const savedWork = h.load("src/lib/telemetry/savedWork.ts");
  savedWork.processAnalyticsIntentSoon(await savedWork.enqueueTaskCreated(h.prisma, 3, { userId: 123 }, "web"));
  await h.drain();
  assert.deepEqual(h.captures.map((capture) => capture.event), ["task_created"]);
});
