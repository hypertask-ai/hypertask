const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const jiti = require("jiti")(__filename, { interopDefault: true });

const root = path.resolve(__dirname, "..");
const {
  classifyRuntimeHealth,
  filterRuntimeSnapshotToBoards,
  selectAgentOperationsQueue,
  stallThresholdMs,
} = jiti(path.join(root, "src/lib/agents/runtimeState.ts"));
const {
  acceptAgentRuntimeHeartbeat,
  RuntimeHeartbeatError,
} = jiti(path.join(root, "src/lib/agents/runtimeHeartbeat.ts"));

const now = new Date("2026-08-18T14:00:00.000Z");
const ago = (milliseconds) =>
  new Date(now.getTime() - milliseconds).toISOString();

function snapshot(overrides = {}) {
  return {
    version: 1,
    sequence: 1,
    workerId: "desktop-developer",
    runtime: "Codex",
    model: "gpt-5.6-luna",
    heartbeatAt: ago(10_000),
    lastProgressAt: ago(20_000),
    cadenceSeconds: 30,
    sourceSections: [{ boardId: 15, section: "Improvements" }],
    processedTickets: [],
    queue: [],
    ...overrides,
  };
}

test("runtime health separates connectivity, active work, waiting, and stalls", () => {
  assert.equal(stallThresholdMs(30), 5 * 60 * 1000);
  assert.equal(classifyRuntimeHealth(null, now.getTime()), "offline");
  assert.equal(classifyRuntimeHealth(snapshot(), now.getTime()), "connected");
  assert.equal(
    classifyRuntimeHealth(
      snapshot({ queue: [{ state: "running", startedAt: ago(30_000) }] }),
      now.getTime(),
    ),
    "working",
  );
  assert.equal(
    classifyRuntimeHealth(
      snapshot({ queue: [{ state: "waiting", startedAt: ago(30_000) }] }),
      now.getTime(),
    ),
    "waiting",
  );
  assert.equal(
    classifyRuntimeHealth(
      snapshot({
        lastProgressAt: ago(5 * 60 * 1000 + 1),
        queue: [{ state: "running", startedAt: ago(30_000) }],
      }),
      now.getTime(),
    ),
    "stalled",
  );
  assert.equal(
    classifyRuntimeHealth(
      snapshot({ heartbeatAt: ago(5 * 60 * 1000 + 1) }),
      now.getTime(),
    ),
    "offline",
  );
});

test("runtime queue metadata is removed when its owner loses board access", () => {
  const visible = filterRuntimeSnapshotToBoards(
    snapshot({
      sourceSections: [
        { boardId: 15, section: "Improvements" },
        { boardId: 99, section: "Private" },
      ],
      processedTickets: [
        { boardId: 15, ticket: "HTPR-1" },
        { boardId: 99, ticket: "SECRET-2" },
      ],
      queue: [
        { boardId: 15, ticket: "HTPR-1", title: "Visible" },
        { boardId: 99, ticket: "SECRET-2", title: "Hidden title" },
      ],
    }),
    new Set([15]),
  );

  assert.deepEqual(visible.processedTickets, [
    { boardId: 15, ticket: "HTPR-1" },
  ]);
  assert.deepEqual(visible.sourceSections, [
    { boardId: 15, section: "Improvements" },
  ]);
  assert.equal(visible.queue.length, 1);
  assert.doesNotMatch(JSON.stringify(visible), /Hidden title|SECRET-2/);
});

test("offline or disabled snapshots fall back to the inferred board queue", () => {
  const staleQueue = [{ ticket: "STALE-1", state: "running" }];
  const inferredQueue = [{ ticket: "HTPR-5474", state: "pending" }];
  const stale = snapshot({ queue: staleQueue });

  assert.deepEqual(
    selectAgentOperationsQueue({
      snapshot: stale,
      inferredQueue,
      health: "offline",
      enabled: true,
    }),
    { source: "inferred", queue: inferredQueue },
  );
  assert.equal(
    selectAgentOperationsQueue({
      snapshot: stale,
      inferredQueue,
      health: "working",
      enabled: false,
    }).source,
    "inferred",
  );
  assert.deepEqual(
    selectAgentOperationsQueue({
      snapshot: stale,
      inferredQueue,
      health: "working",
      enabled: true,
    }),
    { source: "runtime", queue: staleQueue },
  );
});

test("managed heartbeat resolves trusted task fields and drops foreign or sensitive input", async () => {
  const saved = [];
  let agentQuery;
  let taskWhere;
  const db = {
    agent: {
      async findFirst(query) {
        agentQuery = query;
        return {
          id: "agent-1",
          runtimeGeneration: 7,
          members: [{ projectId: 15 }],
        };
      },
    },
    task: {
      async findMany(query) {
        taskWhere = query.where;
        return [
          {
            projectId: 15,
            uniqueIndex: 5474,
            ticketNumber: "HTPR-5474",
            title: "Trusted database title",
            section: "In Progress",
            dueDate: new Date("2026-08-18T16:00:00.000Z"),
            project: { name: "Product", title: "Hypertask Product" },
            priority: { Priority_Value: "Urgent" },
          },
          {
            projectId: 15,
            uniqueIndex: 5475,
            ticketNumber: "HTPR-5475",
            title: "Second task",
            section: "Improvements",
            dueDate: null,
            project: { name: "Product", title: "Hypertask Product" },
            priority: null,
          },
          {
            projectId: 15,
            uniqueIndex: 5473,
            ticketNumber: "HTPR-5473",
            title: "Processed task",
            section: "Improvements",
            dueDate: null,
            project: { name: "Product", title: "Hypertask Product" },
            priority: null,
          },
        ];
      },
    },
  };
  const result = await acceptAgentRuntimeHeartbeat({
    agentId: "agent-1",
    userId: 6,
    authenticatedGeneration: 7,
    projectWhere: { users: { some: { userId: 6 } } },
    now,
    db,
    save: async (agentId, generation, value) => {
      saved.push([agentId, generation, value]);
      return { status: "saved" };
    },
    body: {
      sequence: 42,
      worker_id: "desktop-developer",
      runtime: "Codex",
      model: "sk-proj-should-never-appear",
      cadence_seconds: 30,
      source_sections: [
        { board_id: 15, section: "Improvements" },
        {
          board_id: 15,
          section: "OPENAI_API_KEY=sk-proj-should-never-appear",
        },
        { board_id: 15, section: "Improvements" },
        { board_id: 99, section: "Hidden" },
      ],
      processed_tickets: [
        { board_id: 15, ticket: "HTPR-5473" },
        { board_id: 99, ticket: "OTHER-1" },
      ],
      scope_label: "SPEED OPTIMIZATION",
      last_progress_at: "2099-01-01T00:00:00.000Z",
      prompt: "private prompt",
      private_logs: ["secret log"],
      access_key: "htk_should-never-appear",
      queue: [
        {
          board_id: 15,
          ticket: "HTPR-5474",
          title: "Untrusted title",
          state: "running",
          reason: "direct_mention",
          started_at: "2026-08-18T13:30:00.000Z",
        },
        {
          board_id: 15,
          ticket: "HTPR-5475",
          state: "waiting",
          reason: "assignment",
          started_at: "2026-08-18T13:40:00.000Z",
        },
        { board_id: 99, ticket: "OTHER-1", state: "running" },
      ],
    },
  });

  assert.equal(saved.length, 1);
  assert.equal(agentQuery.where.runtimeGeneration, 7);
  assert.equal(agentQuery.where.archivedAt, undefined);
  assert.deepEqual(agentQuery.select.members.where.project.users, {
    some: { userId: 6 },
  });
  assert.deepEqual(taskWhere.project, { users: { some: { userId: 6 } } });
  assert.equal(taskWhere.archivedAt, null);
  assert.equal(taskWhere.deletedAt, null);
  assert.equal(saved[0][0], "agent-1");
  assert.equal(saved[0][1], 7);
  assert.equal(saved[0][2], result);
  assert.equal(result.sequence, 42);
  assert.equal(result.lastProgressAt, now.toISOString());
  assert.deepEqual(result.sourceSections, [
    { boardId: 15, section: "Improvements" },
  ]);
  assert.deepEqual(result.processedTickets, [
    { boardId: 15, ticket: "HTPR-5473" },
  ]);
  assert.equal(result.scopeLabel, "SPEED OPTIMIZATION");
  assert.equal(result.queue.length, 2);
  assert.equal(result.queue[0].title, "Trusted database title");
  assert.equal(result.queue[0].state, "running");
  assert.equal(result.queue[1].state, "pending");
  assert.equal(result.queue[0].url, "/detail/project-15/5474");
  assert.equal(result.model, "Unreported");
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(
    serialized,
    /private prompt|secret log|htk_should|sk-proj-should/,
  );
});

test("a credential-shaped scope label never reaches the runtime snapshot", async () => {
  const saved = [];
  const db = {
    agent: {
      async findFirst() {
        return { id: "agent-1", runtimeGeneration: 7, members: [{ projectId: 15 }] };
      },
    },
    task: { async findMany() { return []; } },
  };

  const result = await acceptAgentRuntimeHeartbeat({
    agentId: "agent-1",
    userId: 6,
    authenticatedGeneration: 7,
    projectWhere: { ownerId: 6 },
    now,
    db,
    save: async (agentId, generation, value) => {
      saved.push(value);
      return { status: "saved" };
    },
    body: {
      sequence: 1,
      scope_label: "Bearer htk_should_never_render",
      source_sections: [{ board_id: 15, section: "Bugs" }],
    },
  });

  assert.equal(result.scopeLabel, null);
  assert.doesNotMatch(JSON.stringify(saved), /htk_should_never_render/);
});

test("managed heartbeat requires a positive monotonic sequence", async () => {
  const db = {
    agent: {
      async findFirst() {
        return {
          id: "agent-1",
          runtimeGeneration: 3,
          members: [],
        };
      },
    },
    task: { async findMany() { return []; } },
  };

  await assert.rejects(
    acceptAgentRuntimeHeartbeat({
      agentId: "agent-1",
      userId: 6,
      authenticatedGeneration: 3,
      projectWhere: { ownerId: 6 },
      body: { sequence: 0 },
      now,
      db,
      save: async () => ({ status: "saved" }),
    }),
    (error) =>
      error instanceof RuntimeHeartbeatError && error.status === 400,
  );
});

test("revoked, foreign, or missing agents cannot publish runtime state", async () => {
  const db = {
    agent: { async findFirst() { return null; } },
    task: { async findMany() { throw new Error("must not query tasks"); } },
  };
  await assert.rejects(
    acceptAgentRuntimeHeartbeat({
      agentId: "agent-1",
      userId: 6,
      authenticatedGeneration: 7,
      projectWhere: { ownerId: 6 },
      body: {},
      now,
      db,
      save: async () => ({ status: "saved" }),
    }),
    (error) => error instanceof RuntimeHeartbeatError && error.status === 404,
  );
});

test("managed heartbeat surfaces a safe sequence resynchronization", async () => {
  const db = {
    agent: {
      async findFirst() {
        return { id: "agent-1", members: [] };
      },
    },
    task: { async findMany() { return []; } },
  };

  await assert.rejects(
    acceptAgentRuntimeHeartbeat({
      agentId: "agent-1",
      userId: 6,
      authenticatedGeneration: 3,
      projectWhere: { ownerId: 6 },
      body: { sequence: 2000 },
      now,
      db,
      save: async () => ({
        status: "reset_required",
        nextSequence: 17,
      }),
    }),
    (error) =>
      error instanceof RuntimeHeartbeatError &&
      error.status === 409 &&
      error.resetSequence === 17,
  );

  await assert.rejects(
    acceptAgentRuntimeHeartbeat({
      agentId: "agent-1",
      userId: 6,
      authenticatedGeneration: 3,
      projectWhere: { ownerId: 6 },
      body: { sequence: 2 },
      now,
      db,
      save: async () => ({ status: "stale", nextSequence: 23 }),
    }),
    (error) =>
      error instanceof RuntimeHeartbeatError &&
      error.status === 409 &&
      error.resetSequence === 23,
  );
});
