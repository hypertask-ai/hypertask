import assert from "node:assert/strict";
import test from "node:test";
import { ACTIVATION_METRIC_VERSION, computeBoard3Tasks7dV1, type ActivationFacts } from "../src/lib/analytics/activationMetric";
import { activationHarness } from "./helpers/activation-harness";

process.env.POSTHOG_SERVER_PROJECT_TOKEN = "mock-local-only";

const FLAG = "htpr-7293-activation-metric-v1";
const LEGACY_FLAG = "htpr-7284-activation-completed";
const SIGNUP = new Date("2026-10-10T12:00:00Z");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const at = (offset: number) => new Date(SIGNUP.getTime() + offset);
const THRESHOLD = at(3 * 3600000);
const LATER = at(5 * 3600000);

function facts(): ActivationFacts {
  return {
    userId: 123,
    signupAt: SIGNUP,
    boards: [{ id: 15, ownerId: 123, seeded: false, createdAt: SIGNUP, teamId: "team" }],
    tasks: [1, 2, 3].map((id) => ({ id, projectId: 15, createdAt: at(id * 3600000) })),
  };
}

const expected = {
  version: "board_3_tasks_7d_v1", userId: 123, boardId: 15, teamId: "team",
  signupAt: SIGNUP, activatedAt: THRESHOLD, taskIds: [1, 2, 3],
};

const fixtures: { name: string; change: (input: ActivationFacts) => void; result: typeof expected | null }[] = [
  { name: "three tasks on one board activate", change: () => {}, result: expected },
  { name: "three tasks across two boards do not combine", change: (f) => { f.boards.push({ ...f.boards[0], id: 16 }); f.tasks[2].projectId = 16; }, result: null },
  { name: "seeded board does not activate", change: (f) => { f.boards[0].seeded = true; }, result: null },
  { name: "another owner's board does not activate", change: (f) => { f.boards[0].ownerId = 777; }, result: null },
  { name: "duplicate task rows count once", change: (f) => { f.tasks = [f.tasks[0], { ...f.tasks[0] }, f.tasks[1]]; }, result: null },
  { name: "humans and agents both count without an actor filter", change: (f) => { Object.assign(f.tasks[0], { userId: 123 }); Object.assign(f.tasks[1], { userId: 777, agentId: "agent-1" }); }, result: expected },
  { name: "a later soft-deleted task still counts", change: (f) => { Object.assign(f.tasks[2], { status: "Deleted", deletedAt: LATER }); }, result: expected },
  { name: "a later archived task still counts", change: (f) => { Object.assign(f.tasks[2], { status: "Archive", archivedAt: LATER }); }, result: expected },
  { name: "a later deleted board still counts", change: (f) => { Object.assign(f.boards[0], { status: "Deleted" }); }, result: expected },
  { name: "a later archived board still counts", change: (f) => { Object.assign(f.boards[0], { status: "Archive" }); }, result: expected },
  { name: "board before signup is excluded", change: (f) => { f.boards[0].createdAt = at(-1); }, result: null },
  { name: "board exactly at deadline is excluded", change: (f) => { f.boards[0].createdAt = at(WEEK_MS); }, result: null },
  { name: "board after deadline is excluded", change: (f) => { f.boards[0].createdAt = at(WEEK_MS + 1); }, result: null },
  { name: "task exactly at deadline is excluded", change: (f) => { f.tasks[2].createdAt = at(WEEK_MS); }, result: null },
  { name: "task one millisecond before deadline is included", change: (f) => { f.tasks[2].createdAt = at(WEEK_MS - 1); }, result: { ...expected, activatedAt: at(WEEK_MS - 1) } },
  { name: "task exactly at signup is included", change: (f) => { f.tasks[0].createdAt = SIGNUP; }, result: expected },
  { name: "task before signup is excluded", change: (f) => { f.tasks[0].createdAt = at(-1); }, result: null },
  { name: "late out-of-order arrival uses third creation time", change: (f) => { f.tasks.reverse(); }, result: expected },
  { name: "fewer than three tasks returns null", change: (f) => { f.tasks.pop(); }, result: null },
  { name: "hard-deleted absent task cannot count", change: (f) => { f.tasks = f.tasks.filter((task) => task.id !== 2); }, result: null },
  { name: "empty facts return null", change: (f) => { f.boards = []; f.tasks = []; }, result: null },
  { name: "extra tasks keep the first three", change: (f) => { f.tasks.push({ id: 4, projectId: 15, createdAt: LATER }); }, result: expected },
];

for (const fixture of fixtures) {
  test(fixture.name, () => {
    const input = facts();
    fixture.change(input);
    assert.deepEqual(computeBoard3Tasks7dV1(input), fixture.result);
  });
}

function secondBoard(input: ActivationFacts, times: number[]) {
  input.boards.push({ ...input.boards[0], id: 16, teamId: "other-team" });
  input.tasks.push(...times.map((time, index) => ({ id: index + 4, projectId: 16, createdAt: at(time * 3600000) })));
}

test("multiple qualifying boards choose the earliest threshold, not lowest id", () => {
  const input = facts();
  secondBoard(input, [0, 1, 2]);
  assert.deepEqual(computeBoard3Tasks7dV1(input), { ...expected, boardId: 16, teamId: "other-team", activatedAt: at(2 * 3600000), taskIds: [4, 5, 6] });
});

test("equal board thresholds choose lower board id even with higher task ids", () => {
  const input = facts();
  input.tasks.forEach((task) => { task.id += 10; });
  secondBoard(input, [0, 1, 3]);
  input.boards.reverse();
  input.tasks.reverse();
  assert.deepEqual(computeBoard3Tasks7dV1(input), { ...expected, taskIds: [11, 12, 13] });
});

test("equal task times choose lower task ids", () => {
  const input = facts();
  input.tasks = [4, 3, 2, 1].map((id) => ({ id, projectId: 15, createdAt: THRESHOLD }));
  assert.deepEqual(computeBoard3Tasks7dV1(input), expected);
});

test("twenty shuffled permutations with duplicate rows produce identical results without mutation", () => {
  const input = facts();
  secondBoard(input, [0, 1, 3]);
  let seed = 7293;
  function shuffled<T>(rows: T[]): T[] {
    const result = [...rows];
    for (let i = result.length - 1; i > 0; i--) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const j = seed % (i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  for (let iteration = 0; iteration < 20; iteration++) {
    const permuted = { ...input, boards: shuffled(input.boards), tasks: shuffled([...input.tasks, ...input.tasks.map((task) => ({ ...task }))]) };
    const original = structuredClone(permuted);
    assert.deepEqual(computeBoard3Tasks7dV1(permuted), expected);
    assert.deepEqual(permuted, original);
  }
});

test("version string is board_3_tasks_7d_v1", () => {
  assert.equal(ACTIVATION_METRIC_VERSION, "board_3_tasks_7d_v1");
});

function harness() {
  const h = activationHarness();
  h.mocks["@/lib/flags"].HTPR_7284_ACTIVATION_COMPLETED_FLAG = LEGACY_FLAG;
  h.setFlagEnabled(FLAG, true);
  h.users.get(123).joinedAt = SIGNUP;
  Object.assign(h.projects.get(15), facts().boards[0], { status: "Normal" });
  h.tasks.clear();
  for (const task of facts().tasks) h.tasks.set(task.id, { ...task, userId: 123, status: "Normal", deletedAt: null, archivedAt: null });
  const queries: { model: string; query: any }[] = [];
  const select = (row: any, fields: any) => row ? Object.fromEntries(Object.keys(fields).map((key) => [key, row[key]])) : null;
  h.prisma.user.findUnique = async (query: any) => {
    queries.push({ model: "user", query });
    return select(h.users.get(query.where.id), query.select);
  };
  h.prisma.project.findMany = async (query: any) => {
    queries.push({ model: "project", query });
    const { where } = query;
    const boards = [...h.projects.values()].filter((board) => board.ownerId === where.ownerId && board.seeded === where.seeded);
    if (query.select._count) {
      const taskWhere = query.select._count.select.tasks.where;
      return boards.filter((board) => board.status === where.status).map((board) => ({
        id: board.id, teamId: board.teamId,
        _count: { tasks: [...h.tasks.values()].filter((task) => task.projectId === board.id && task.status === taskWhere.status && task.deletedAt === null && task.archivedAt === null && task.createdAt <= taskWhere.createdAt.lte).length },
      }));
    }
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
  const report = h.load("src/lib/analytics/activationFacts.ts") as typeof import("../src/lib/analytics/activationFacts");
  return { ...h, queries, ...report, capture: (at = LATER) => api.captureActivationCompleted(123, at) };
}

test("loader selects only bounded creation facts, including archived/deleted tasks and boards", async () => {
  const h = harness();
  h.projects.get(15).status = "Deleted";
  Object.assign(h.tasks.get(2), { status: "Archive", archivedAt: LATER, agentId: "agent-1" });
  Object.assign(h.tasks.get(3), { status: "Deleted", deletedAt: LATER });
  const loaded = await h.loadActivationFacts(123);
  assert.deepEqual(loaded, facts());
  const window = { gte: SIGNUP, lt: at(WEEK_MS) };
  assert.deepEqual(h.queries, [
    { model: "user", query: { where: { id: 123 }, select: { joinedAt: true } } },
    { model: "project", query: { where: { ownerId: 123, seeded: false, createdAt: window }, select: { id: true, ownerId: true, seeded: true, createdAt: true, teamId: true }, orderBy: { id: "asc" } } },
    { model: "task", query: { where: { projectId: { in: [15] }, createdAt: window }, select: { id: true, projectId: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  ]);
  assert.deepEqual(await h.computeActivationForUser(123), expected);
});

test("report computation is repeatable for an old user without processing-time filtering", async () => {
  const h = harness();
  h.users.get(123).joinedAt = new Date(0);
  h.projects.get(15).createdAt = new Date(0);
  for (const task of h.tasks.values()) task.createdAt = new Date(task.id * 3600000);
  const historical = { ...expected, signupAt: new Date(0), activatedAt: new Date(3 * 3600000) };
  assert.deepEqual(await h.computeActivationForUser(123), historical);
  assert.deepEqual(await h.computeActivationForUser(123), historical);
});

test("loader excludes boards outside window, seeded boards and other owners and skips task query", async () => {
  const h = harness();
  const board = h.projects.get(15);
  h.projects.clear();
  for (const [index, change] of [{ createdAt: at(-1) }, { createdAt: at(WEEK_MS) }, { seeded: true }, { ownerId: 777 }].entries()) {
    h.projects.set(index, { ...board, ...change, id: index });
  }
  assert.equal(await h.computeActivationForUser(123), null);
  assert.deepEqual(h.queries.map(({ model }) => model), ["user", "project"]);
});

test("loader filters task window on both inclusive start and exclusive end", async () => {
  const h = harness();
  h.tasks.get(1).createdAt = SIGNUP;
  h.tasks.get(2).createdAt = at(WEEK_MS - 1);
  h.tasks.get(3).createdAt = at(WEEK_MS);
  h.tasks.set(4, { ...h.tasks.get(1), id: 4, createdAt: at(-1) });
  assert.deepEqual((await h.loadActivationFacts(123))!.tasks.map((task) => task.id), [1, 2]);
  assert.equal(await h.computeActivationForUser(123), null);
});

test("missing report user returns null without board/task queries", async () => {
  const h = harness();
  assert.equal(await h.computeActivationForUser(999), null);
  assert.deepEqual(h.queries.map(({ model }) => model), ["user"]);
});

test("versioned capture sends the threshold contract, not the later triggering time", async () => {
  const h = harness();
  const occurrences = h.load("src/lib/telemetry/analyticsOccurrences.ts");
  const capture = occurrences.captureAnalyticsOccurrence;
  const calls: any[] = [];
  occurrences.captureAnalyticsOccurrence = (...args: any[]) => { calls.push(args); return capture(...args); };
  await h.capture();
  assert.equal(h.captures.length, 1);
  assert.equal(h.captures[0].event, "activation_completed");
  assert.equal(h.captures[0].distinctId, "123");
  assert.deepEqual(h.captures[0].properties, {
    ...occurrences.serverAnalyticsProperties(123, "team", 15, "activation_completed:123", THRESHOLD),
    account_category: "customer", signup_at: SIGNUP.toISOString(), activated_at: THRESHOLD.toISOString(),
    hours_since_signup: 3, task_count: 3, is_seeded: false,
    definition_version: "board_3_tasks_7d_v1", activation_task_ids: ["1", "2", "3"],
  });
  assert.deepEqual(calls[0].slice(0, 3), [123, "activation_completed", "analytics:activation_completed"]);
  assert.deepEqual(calls[0][4], { scope: "user", occurredAt: THRESHOLD });
});

test("versioned outbox stores threshold business time and deduplicates delivery", async () => {
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
  assert.deepEqual(rows[0].occurredAt, THRESHOLD);
  assert.equal(rows[0].properties.activated_at, THRESHOLD.toISOString());
});

test("flag off keeps the unversioned live-task contract unchanged", async () => {
  const h = harness();
  h.setFlagEnabled(FLAG, false);
  h.projects.get(15).createdAt = at(-1);
  h.tasks.set(4, { ...h.tasks.get(3), id: 4 });
  await h.capture();
  const occurrences = h.load("src/lib/telemetry/analyticsOccurrences.ts");
  assert.deepEqual(h.captures[0].properties, {
    ...occurrences.serverAnalyticsProperties(123, "team", 15, "activation_completed:123", LATER),
    account_category: "customer", signup_at: SIGNUP.toISOString(), activated_at: LATER.toISOString(),
    hours_since_signup: 5, task_count: 4, is_seeded: false,
  });
  assert.deepEqual(h.queries.map(({ model }) => model), ["user", "project", "user"]);
});

for (const enabled of [false, true]) {
  test(`expired triggering time avoids all fact reads beyond user signup lookup with v1=${enabled}`, async () => {
    const h = harness();
    h.setFlagEnabled(FLAG, enabled);
    await h.capture(at(WEEK_MS));
    await h.capture(at(WEEK_MS + 1));
    assert.deepEqual(h.queries.map(({ model }) => model), ["user", "user"]);
    assert.equal(h.captures.length, 0);
    assert.ok(!h.flagChecks.some(({ key }) => key === FLAG));
  });
}

test("legacy flag off avoids every database read even when v1 is on", async () => {
  const h = harness();
  h.setFlagEnabled(LEGACY_FLAG, false);
  await h.capture();
  assert.deepEqual(h.queries, []);
  assert.deepEqual(h.prismaCalls, []);
  assert.equal(h.captures.length, 0);
});

test("guest exclusion still precedes v1 fact loading", async () => {
  const h = harness();
  h.users.get(123).uid = "guest_local";
  await h.capture();
  assert.deepEqual(h.queries.map(({ model }) => model), ["user"]);
  assert.equal(h.captures.length, 0);
});

test("captureTaskCreated emits versioned activation once for human and agent replays", async () => {
  const h = harness();
  h.setFlagEnabled("htpr-7271-saved-work-events", true);
  h.projects.get(15).status = "Archive";
  h.tasks.get(1).deletedAt = LATER;
  h.tasks.get(2).status = "Archive";
  const api = h.load("src/lib/telemetry/savedWorkAnalytics.ts");
  await Promise.all([
    api.captureTaskCreated(3, { userId: 777, agentId: "agent-1" }, "agent"),
    api.captureTaskCreated(3, { userId: 123 }, "web"),
  ]);
  await api.captureTaskCreated(1, { userId: 123 }, "web");
  const activations = h.captures.filter((capture) => capture.event === "activation_completed");
  assert.equal(activations.length, 1);
  assert.equal(activations[0].distinctId, "123");
  assert.equal(activations[0].properties.definition_version, ACTIVATION_METRIC_VERSION);
  assert.equal(activations[0].properties.activated_at, THRESHOLD.toISOString());
  assert.deepEqual(h.logs.filter((row) => row.log === "analytics:activation_completed").map((row) => row.LoggedById), [123]);
});

test("legacy activation marker prevents re-emission after v1 rollout", async () => {
  const h = harness();
  h.setFlagEnabled(FLAG, false);
  await h.capture();
  h.setFlagEnabled(FLAG, true);
  await h.capture();
  assert.equal(h.captures.length, 1);
  assert.equal(h.captures[0].properties.definition_version, undefined);
});

test("v1 flag has an honest Owner + QA feature definition and release risk", () => {
  const definition = activationHarness().load("src/lib/flags/definitions/htpr-7293-activation-metric-v1.ts").default;
  assert.equal(definition.key, FLAG);
  assert.equal(definition.kind, "feature");
  assert.equal(definition.defaultMode, "OWNER_AND_QA");
  assert.equal(definition.shippedOn, "2026-10-17");
  assert.equal(definition.releaseRisk.risk, "new");
  assert.ok(definition.releaseRisk.reason);
});
