import assert from "node:assert/strict";
import test from "node:test";
import { activationHarness } from "./helpers/activation-harness";

process.env.POSTHOG_SERVER_PROJECT_TOKEN = "mock-local-only";

const FLAG = "htpr-7284-activation-completed";
const SIGNUP = new Date("2026-10-10T12:00:00Z");
const OCCURRED = new Date("2026-10-11T12:06:00Z");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function harness(taskCount = 3, occurredAt = OCCURRED) {
  const h = activationHarness();
  h.mocks["@/lib/flags"].HTPR_7284_ACTIVATION_COMPLETED_FLAG = FLAG;
  h.setFlagEnabled(FLAG, true);
  h.users.get(123).joinedAt = SIGNUP;
  Object.assign(h.projects.get(15), { seeded: false, status: "Normal" });
  h.tasks.clear();
  for (let id = 1; id <= taskCount; id++) {
    h.tasks.set(id, { id, projectId: 15, userId: 123, status: "Normal", deletedAt: null, archivedAt: null, createdAt: occurredAt });
  }
  const queries: any[] = [];
  h.prisma.project.findMany = async (query: any) => {
    queries.push(query);
    const { where, select } = query;
    assert.deepEqual(where, { ownerId: where.ownerId, seeded: false, status: "Normal" });
    assert.deepEqual(select, {
      id: true, teamId: true,
      _count: { select: { tasks: { where: { status: "Normal", deletedAt: null, archivedAt: null, createdAt: { lte: select._count.select.tasks.where.createdAt.lte } } } } },
    });
    const taskWhere = select._count.select.tasks.where;
    return [...h.projects.values()]
      .filter((board) => board.ownerId === where.ownerId && board.seeded === where.seeded && board.status === where.status)
      .map((board) => ({
        id: board.id, teamId: board.teamId,
        _count: { tasks: [...h.tasks.values()].filter((task) => task.projectId === board.id && task.status === taskWhere.status && task.deletedAt === taskWhere.deletedAt && task.archivedAt === taskWhere.archivedAt && task.createdAt <= taskWhere.createdAt.lte).length },
      }));
  };
  const api = h.load("src/lib/telemetry/activationCompleted.ts");
  return { ...h, queries, capture: (userId = 123, at = occurredAt) => api.captureActivationCompleted(userId, at) };
}

test("third live task within seven days captures the owner activation contract", async () => {
  const h = harness();
  await h.capture();
  assert.equal(h.captures.length, 1);
  const [{ distinctId, event, properties }] = h.captures;
  assert.equal(distinctId, "123");
  assert.equal(event, "activation_completed");
  assert.deepEqual(properties, {
    ...h.load("src/lib/telemetry/analyticsOccurrences.ts").serverAnalyticsProperties(123, "team", 15, "activation_completed:123", OCCURRED),
    account_category: "customer", signup_at: SIGNUP.toISOString(), activated_at: OCCURRED.toISOString(),
    hours_since_signup: 24.1, task_count: 3, is_seeded: false,
  });
  assert.deepEqual(h.queries[0].select._count.select.tasks.where.createdAt, { lte: OCCURRED });
  assert.deepEqual(h.flagChecks[0], { key: FLAG, userId: 123 });
});

test("second task does not activate; adding the third does", async () => {
  const h = harness(2);
  await h.capture();
  assert.equal(h.captures.length, 0);
  h.tasks.set(3, { ...h.tasks.get(2), id: 3 });
  await h.capture();
  assert.equal(h.captures.length, 1);
});

for (const [offset, expected] of [[WEEK_MS, 0], [WEEK_MS - 1, 1], [WEEK_MS + 1, 0]]) {
  test(`signup deadline at ${offset} ms captures ${expected} events`, async () => {
    const h = harness(3, new Date(SIGNUP.getTime() + offset));
    await h.capture();
    assert.equal(h.captures.length, expected);
    if (!expected) assert.equal(h.queries.length, 0);
  });
}

for (const boardChange of [{ seeded: true }, { status: "Deleted" }, { status: "Archive" }, { ownerId: 777 }]) {
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

for (const taskChange of [{ status: "Deleted" }, { status: "Archive" }, { deletedAt: OCCURRED }, { archivedAt: OCCURRED }, { createdAt: new Date(OCCURRED.getTime() + 1) }]) {
  test(`ineligible task ${JSON.stringify(taskChange)} never counts toward three`, async () => {
    const h = harness();
    const original = { ...h.tasks.get(3) };
    Object.assign(h.tasks.get(3), taskChange);
    await h.capture();
    assert.equal(h.captures.length, 0);
    h.tasks.set(3, original);
    await h.capture();
    assert.equal(h.captures.length, 1);
  });
}

test("tasks on different boards do not combine; any qualifying owned board can activate", async () => {
  const h = harness();
  h.projects.set(16, { ...h.projects.get(15), id: 16, teamId: "other-team" });
  h.tasks.get(3).projectId = 16;
  await h.capture();
  assert.equal(h.captures.length, 0);
  h.tasks.set(4, { ...h.tasks.get(3), id: 4 });
  h.tasks.set(5, { ...h.tasks.get(3), id: 5 });
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
  assert.equal(h.queries.length, 0);
});

test("flag off never reads the user or boards or captures", async () => {
  const h = harness();
  h.setFlagEnabled(FLAG, false);
  await h.capture();
  assert.deepEqual(h.prismaCalls, []);
  assert.equal(h.queries.length, 0);
  assert.equal(h.captures.length, 0);
});

test("parallel and later replays deduplicate once per user with the activation marker", async () => {
  const h = harness(4);
  await Promise.all([h.capture(), h.capture(), h.capture()]);
  await h.capture();
  assert.equal(h.captures.length, 1);
  assert.equal(h.captures[0].properties.task_count, 4);
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

test("a collaborator's task evaluates only the board owner even when task_created is off", async () => {
  const h = harness();
  h.users.set(777, { ...h.users.get(123), id: 777 });
  h.projects.get(15).ownerId = 777;
  h.projects.get(15).owner = h.users.get(777);
  await h.load("src/lib/telemetry/savedWorkAnalytics.ts").captureTaskCreated(3, { userId: 123 }, "web");
  assert.deepEqual(h.captures.map((capture) => [capture.event, capture.distinctId]), [["activation_completed", "777"]]);
  assert.equal(h.queries[0].where.ownerId, 777);
  assert.ok(h.flagChecks.some(({ key, userId }) => key === FLAG && userId === 777));
  assert.ok(!h.flagChecks.some(({ key, userId }) => key === FLAG && userId === 123));
});

test("agent-created tasks count and activation follows task_created using task.createdAt", async () => {
  const h = harness();
  h.setFlagEnabled("htpr-7271-saved-work-events", true);
  for (const task of h.tasks.values()) Object.assign(task, { userId: 777, agentId: "agent-1" });
  await h.load("src/lib/telemetry/savedWorkAnalytics.ts").captureTaskCreated(3, { userId: 777, agentId: "agent-1" }, "agent");
  assert.deepEqual(h.captures.map((capture) => capture.event), ["task_created", "activation_completed"]);
  assert.equal(h.captures[1].distinctId, "123");
  assert.equal(h.captures[1].properties.activated_at, OCCURRED.toISOString());
});

test("activation flag off keeps task_created without activation", async () => {
  const h = harness();
  h.setFlagEnabled("htpr-7271-saved-work-events", true);
  h.setFlagEnabled(FLAG, false);
  await h.load("src/lib/telemetry/savedWorkAnalytics.ts").captureTaskCreated(3, { userId: 123 }, "web");
  assert.deepEqual(h.captures.map((capture) => capture.event), ["task_created"]);
});

test("the shared occurrence path uses user scope and a durable deduplicated outbox", async () => {
  const h = harness();
  const rows: any[] = [];
  const delivered: any[] = [];
  Object.assign(h.load("src/lib/telemetry/analyticsOutbox.ts"), {
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
  const savedWork = h.load("src/lib/telemetry/savedWork.ts");
  savedWork.processAnalyticsIntentSoon(await savedWork.enqueueTaskCreated(h.prisma, 3, { userId: 123 }, "web"));
  await h.drain();
  assert.equal(h.captures.length, 0);
});

test("activation flag keeps the feature owner-and-QA default and release risk", () => {
  const definition = harness().load("src/lib/flags/definitions/htpr-7284-activation-completed.ts").default;
  assert.equal(definition.key, FLAG);
  assert.equal(definition.kind, "feature");
  assert.equal(definition.shippedOn, "2026-10-17");
  assert.equal(definition.defaultMode, "OWNER_AND_QA");
  assert.equal(definition.releaseRisk.risk, "new");
  assert.ok(definition.releaseRisk.reason);
});
