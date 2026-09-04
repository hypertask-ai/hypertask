const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
let loadId = 0;

function stub(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

function loadOutbox(enabled = true) {
  const outboxPath = path.join(root, "src/lib/agentWebhooks/outbox.ts");
  delete require.cache[outboxPath];
  stub("src/lib/prisma.ts", { default: {} });
  stub("src/lib/flags.ts", {
    isFeatureEnabled: async () => enabled,
  });
  stub("src/lib/agentWebhooks/queue.ts", {
    queueAgentWebhookDelivery: async () => {},
  });
  const jiti = createJiti(path.join(root, `tests/agent-runs-outbox-${++loadId}.cjs`), {
    alias: { "@": path.join(root, "src") },
    interopDefault: true,
  });
  return jiti(outboxPath);
}

function statusMatches(status, filter) {
  if (typeof filter === "string") return status === filter;
  return !filter?.in || filter.in.includes(status);
}

function runMatches(run, where) {
  return (
    (!where.id || run.id === where.id) &&
    (!where.agentId || run.agentId === where.agentId) &&
    (where.taskId === undefined || run.taskId === where.taskId) &&
    (where.chatSessionId === undefined || run.chatSessionId === where.chatSessionId) &&
    statusMatches(run.status, where.status)
  );
}

function fakeRunTransaction(events = [
  "comment.mention",
  "task.assigned",
  "chat.message",
  "run.created",
  "run.prompted",
  "run.stopped",
]) {
  const runs = [];
  const deliveries = [];
  const subscription = {
    id: "subscription-1",
    active: true,
    projectId: null,
    events,
    agent: {
      userId: 6,
      revokedAt: null,
      members: [{ id: "member-1" }],
    },
  };
  const tx = {
    runs,
    deliveries,
    featureFlag: {},
    user: {},
    agentWebhookSubscription: {
      findUnique: async () => subscription,
    },
    agentWebhookDelivery: {
      create: async ({ data }) => {
        deliveries.push(data);
        return data;
      },
    },
    agentRun: {
      createMany: async ({ data }) => {
        const candidate = data[0];
        const conflict = runs.some(
          (run) =>
            ["ACTIVE", "STALE"].includes(run.status) &&
            run.agentId === candidate.agentId &&
            ((candidate.taskId != null && run.taskId === candidate.taskId) ||
              (candidate.chatSessionId != null &&
                run.chatSessionId === candidate.chatSessionId)),
        );
        if (conflict) return { count: 0 };
        runs.push({ ...candidate, stoppedById: null });
        return { count: 1 };
      },
      updateMany: async ({ where, data }) => {
        const matching = runs.filter((run) => runMatches(run, where));
        matching.forEach((run) => Object.assign(run, data));
        return { count: matching.length };
      },
      findFirst: async ({ where }) => runs.find((run) => runMatches(run, where)) ?? null,
      findMany: async () =>
        runs
          .filter((run) => ["ACTIVE", "STALE"].includes(run.status))
          .map((run) => ({
            ...run,
            agent: {
              userId: 6,
              revokedAt: null,
              members: [{ id: "member-1" }],
              agentWebhookSubscription: {
                id: subscription.id,
                projectId: subscription.projectId,
                active: true,
                events: subscription.events,
              },
            },
          })),
    },
  };
  return tx;
}

const actor = { userId: 6, agentId: null, displayName: "Valentin" };
const mention = {
  event: "comment.mention",
  agentId: "agent-1",
  projectId: 15,
  taskId: 42,
  ticketNumber: "HTPR-42",
  taskTitle: "Run lifecycle",
  commentId: 10,
  commentHtml: "<p>@Agent start</p>",
  actor,
};

function chat(messageId, text) {
  return {
    event: "chat.message",
    agentId: "agent-1",
    projectId: null,
    taskId: null,
    ticketNumber: null,
    taskTitle: null,
    actor,
    chat: {
      sessionId: "session-1",
      messageId,
      text,
      userName: "Valentin",
    },
  };
}

test("first trigger creates one run and later ticket prompt reuses it", async () => {
  const { persistAgentRunTriggerWebhooks, persistAgentTaskRunPromptWebhooks } =
    loadOutbox(true);
  const tx = fakeRunTransaction();
  const firstAt = new Date("2026-09-04T10:00:00.000Z");
  const createdIds = await persistAgentRunTriggerWebhooks(tx, mention, firstAt);

  assert.equal(createdIds.length, 2);
  assert.equal(tx.runs.length, 1);
  assert.equal(tx.deliveries[0].event, "comment.mention");
  assert.equal(tx.deliveries[0].payload.runId, tx.runs[0].id);
  assert.equal(tx.deliveries[1].event, "run.created");
  assert.equal(tx.deliveries[1].payload.run.status, "active");

  tx.runs[0].status = "STALE";
  const promptedAt = new Date("2026-09-04T10:06:00.000Z");
  const promptIds = await persistAgentTaskRunPromptWebhooks(
    tx,
    {
      projectId: 15,
      taskId: 42,
      ticketNumber: "HTPR-42",
      taskTitle: "Run lifecycle",
      commentId: 11,
      commentHtml: "<p>Continue with this</p>",
      actor,
    },
    promptedAt,
  );

  assert.equal(promptIds.length, 1);
  assert.equal(tx.runs.length, 1);
  assert.equal(tx.runs[0].status, "ACTIVE");
  assert.equal(tx.runs[0].lastActivityAt, promptedAt);
  assert.equal(tx.deliveries[2].event, "run.prompted");
  assert.equal(tx.deliveries[2].payload.runId, tx.runs[0].id);
  assert.equal(tx.deliveries[2].payload.prompt, "<p>Continue with this</p>");
});

test("chat follow-up emits run.prompted without creating a second run", async () => {
  const { persistAgentRunTriggerWebhooks } = loadOutbox(true);
  const tx = fakeRunTransaction();

  await persistAgentRunTriggerWebhooks(tx, chat("message-1", "Start"));
  const runId = tx.runs[0].id;
  await persistAgentRunTriggerWebhooks(tx, chat("message-2", "Continue"));

  assert.equal(tx.runs.length, 1);
  assert.equal(tx.runs[0].id, runId);
  assert.deepEqual(
    tx.deliveries.map(({ event }) => event),
    ["chat.message", "run.created", "chat.message", "run.prompted"],
  );
  assert.equal(tx.deliveries[3].payload.prompt, "Continue");
});

test("lifecycle-only subscriptions can create a run", async () => {
  const { persistAgentRunTriggerWebhooks } = loadOutbox(true);
  const tx = fakeRunTransaction(["run.created"]);

  const ids = await persistAgentRunTriggerWebhooks(tx, mention);

  assert.equal(ids.length, 1);
  assert.equal(tx.runs.length, 1);
  assert.equal(tx.deliveries[0].event, "run.created");
  assert.equal(tx.deliveries[0].payload.runId, tx.runs[0].id);
});

test("task comments do not reactivate runs without run.prompted delivery", async () => {
  const { persistAgentRunTriggerWebhooks, persistAgentTaskRunPromptWebhooks } =
    loadOutbox(true);
  const tx = fakeRunTransaction(["comment.mention", "run.created"]);
  const firstAt = new Date("2026-09-04T10:00:00.000Z");

  await persistAgentRunTriggerWebhooks(tx, mention, firstAt);
  tx.runs[0].status = "STALE";
  const ids = await persistAgentTaskRunPromptWebhooks(
    tx,
    {
      projectId: 15,
      taskId: 42,
      ticketNumber: "HTPR-42",
      taskTitle: "Run lifecycle",
      commentId: 11,
      commentHtml: "<p>This agent did not subscribe to prompts</p>",
      actor,
    },
    new Date("2026-09-04T10:06:00.000Z"),
  );

  assert.deepEqual(ids, []);
  assert.equal(tx.runs[0].status, "STALE");
  assert.equal(tx.runs[0].lastActivityAt, firstAt);
});

test("feature-off trigger preserves the legacy payload and creates no run", async () => {
  const { persistAgentRunTriggerWebhooks } = loadOutbox(false);
  const tx = fakeRunTransaction();

  const ids = await persistAgentRunTriggerWebhooks(tx, mention);

  assert.equal(ids.length, 1);
  assert.equal(tx.runs.length, 0);
  assert.equal(tx.deliveries[0].event, "comment.mention");
  assert.equal(tx.deliveries[0].payload.runId, undefined);
});

test("turning the flag off cancels queued run payloads before delivery", async () => {
  const deliveryPath = path.join(root, "src/lib/agentWebhooks/delivery.ts");
  delete require.cache[deliveryPath];
  let posts = 0;
  const row = {
    id: "delivery-1",
    event: "comment.mention",
    payload: { event: "comment.mention", runId: "run-1" },
    status: "pending",
    attemptCount: 0,
    nextAttemptAt: new Date(0),
    subscriptionId: "subscription-1",
    subscription: {
      id: "subscription-1",
      active: true,
      url: "https://agent.example/webhook",
      secret: "secret",
      agent: { revokedAt: null, userId: 6 },
    },
  };
  const prisma = {
    agentWebhookDelivery: {
      updateMany: async () => ({ count: 1 }),
      findUnique: async () => row,
      update: async ({ data }) => Object.assign(row, data),
    },
  };
  stub("src/lib/prisma.ts", { default: prisma });
  stub("src/lib/flags.ts", { isFeatureEnabled: async () => false });
  stub("src/lib/mcp/webhooks/delivery.ts", {
    postSignedWebhook: async () => {
      posts += 1;
      return { ok: true, statusCode: 200 };
    },
  });
  stub("src/lib/agentWebhooks/queue.ts", {
    queueAgentWebhookDelivery: async () => {},
  });
  const jiti = createJiti(path.join(root, `tests/agent-runs-delivery-${++loadId}.cjs`), {
    alias: { "@": path.join(root, "src") },
    interopDefault: true,
  });
  const { deliverAgentWebhook } = jiti(deliveryPath);

  assert.deepEqual(await deliverAgentWebhook(row.id), { status: "skipped" });
  assert.equal(row.status, "cancelled");
  assert.equal(posts, 0);
});

function loadService({ rows, validateAuth, sessionUser } = {}) {
  const servicePath = path.join(root, "src/lib/agentRuns/service.ts");
  delete require.cache[servicePath];
  const stopEvents = [];
  const published = [];
  const agentRuns = rows ?? [];
  const db = {
    user: {
      findUnique: async ({ where }) =>
        where.id === 6 ? { id: 6, displayName: "Valentin" } : null,
    },
    agentRun: {
      findFirst: async ({ where }) =>
        agentRuns.find(
          (run) =>
            run.id === where.id &&
            (where.agentId
              ? run.agentId === where.agentId
              : run.ownerId === where.agent?.userId),
        ) ?? null,
      updateMany: async ({ where, data }) => {
        const matches = agentRuns.filter(
          (run) =>
            run.id === where.id &&
            statusMatches(run.status, where.status) &&
            (where.lastActivityAt === undefined ||
              run.lastActivityAt === where.lastActivityAt),
        );
        matches.forEach((run) => Object.assign(run, data));
        return { count: matches.length };
      },
    },
  };
  const prisma = {
    user: db.user,
    $transaction: async (callback) => callback(db),
  };
  stub("src/lib/prisma.ts", { default: prisma });
  stub("src/lib/agentWebhooks/outbox.ts", {
    persistAgentRunStoppedWebhook: async (_tx, input) => {
      stopEvents.push(input);
      return "stop-delivery";
    },
    publishAgentWebhookDeliveries: async (ids) => published.push(...ids),
  });
  stub("src/lib/flags.ts", { isFeatureEnabled: async () => true });
  stub("src/lib/mcp/auth.ts", {
    validateMcpAuth: async (request) => validateAuth?.(request) ?? null,
  });
  stub("src/lib/auth/getSessionUser.ts", {
    getSessionUser: async () => sessionUser ?? null,
  });
  const jiti = createJiti(path.join(root, `tests/agent-runs-service-${++loadId}.cjs`), {
    alias: { "@": path.join(root, "src") },
    interopDefault: true,
  });
  return { service: jiti(servicePath), stopEvents, published };
}

function runRow(overrides = {}) {
  return {
    id: "run-1",
    ownerId: 6,
    agentId: "agent-1",
    taskId: 42,
    chatSessionId: null,
    trigger: "MENTION",
    status: "ACTIVE",
    createdAt: new Date("2026-09-04T10:00:00.000Z"),
    lastActivityAt: new Date("2026-09-04T10:00:00.000Z"),
    stoppedById: null,
    task: {
      id: 42,
      projectId: 15,
      ticketNumber: "HTPR-42",
      title: "Run lifecycle",
    },
    ...overrides,
  };
}

const browserPrincipal = {
  userId: 6,
  agentId: null,
  displayName: "Valentin",
  source: "browser",
};

test("GET lazily marks an inactive run stale with a guarded write", async () => {
  const row = runRow();
  const { service } = loadService({ rows: [row] });

  const result = await service.readAgentRun(
    browserPrincipal,
    row.id,
    new Date("2026-09-04T10:05:01.000Z"),
  );

  assert.equal(result.status, "stale");
  assert.equal(row.status, "STALE");
});

test("stop is idempotent, records a human stopper, and emits once", async () => {
  const row = runRow({ status: "STALE" });
  const { service, stopEvents, published } = loadService({ rows: [row] });
  const stoppedAt = new Date("2026-09-04T10:07:00.000Z");

  const first = await service.stopAgentRun(browserPrincipal, row.id, stoppedAt);
  const second = await service.stopAgentRun(browserPrincipal, row.id, stoppedAt);

  assert.equal(first.status, "stopped");
  assert.equal(second.status, "stopped");
  assert.equal(row.stoppedById, 6);
  assert.equal(stopEvents.length, 1);
  assert.equal(stopEvents[0].runId, row.id);
  assert.deepEqual(published, ["stop-delivery"]);
});

test("a different agent cannot read or stop another agent's run", async () => {
  const row = runRow();
  const { service, stopEvents } = loadService({ rows: [row] });
  const otherAgent = {
    userId: 6,
    agentId: "agent-2",
    displayName: "Other agent",
    source: "agent",
  };

  assert.equal(await service.readAgentRun(otherAgent, row.id), null);
  assert.equal(await service.stopAgentRun(otherAgent, row.id), null);
  assert.equal(row.status, "ACTIVE");
  assert.equal(stopEvents.length, 0);
});

test("a presented invalid bearer never falls back to a browser session", async () => {
  let bearerChecks = 0;
  const { service } = loadService({
    validateAuth: async () => {
      bearerChecks += 1;
      return null;
    },
    sessionUser: { userId: 6 },
  });
  const request = {
    headers: new Headers({ authorization: "Bearer invalid" }),
    nextUrl: new URL("https://app.hypertask.ai/api/mcp/agents/runs/run-1"),
  };

  assert.equal(await service.authenticateAgentRunRequest(request), null);
  assert.equal(bearerChecks, 1);
});

test("browser stop requests require the app origin", () => {
  const { service } = loadService();
  const request = (origin) => ({
    headers: new Headers({ origin }),
    nextUrl: new URL("https://app.hypertask.ai/api/mcp/agents/runs/run-1/stop"),
  });

  assert.equal(
    service.browserMutationIsSameOrigin(request("https://app.hypertask.ai")),
    true,
  );
  assert.equal(
    service.browserMutationIsSameOrigin(request("https://attacker.example")),
    false,
  );
});

test("the migration enforces one nonterminal run and exactly one context", () => {
  const migration = require("node:fs").readFileSync(
    path.join(
      root,
      "src/prisma/migrations/20260904130000_add_agent_runs/migration.sql",
    ),
    "utf8",
  );
  assert.match(migration, /num_nonnulls\("taskId", "chatSessionId"\) = 1/);
  assert.match(migration, /"trigger" = 'CHAT' AND "chatSessionId" IS NOT NULL/);
  assert.match(
    migration,
    /"trigger" IN \('MENTION', 'ASSIGNED'\) AND "taskId" IS NOT NULL/,
  );
  assert.match(migration, /AgentRun_nonterminal_task_key[\s\S]*WHERE[\s\S]*'ACTIVE', 'STALE'/);
  assert.match(migration, /AgentRun_nonterminal_chat_key[\s\S]*WHERE[\s\S]*'ACTIVE', 'STALE'/);
  assert.match(migration, /AgentRun_stoppedById_idx[\s\S]*\("stoppedById"\)/);
});

test("run event discovery is hidden and rejected when the flag is off", () => {
  const jiti = createJiti(path.join(root, `tests/agent-runs-events-${++loadId}.cjs`), {
    alias: { "@": path.join(root, "src") },
    interopDefault: true,
  });
  const events = jiti(path.join(root, "src/lib/agentWebhooks/events.ts"));
  const hidden = events.availableAgentWebhookEvents(false);

  assert.equal(hidden.includes("run.created"), false);
  assert.equal(events.parseAgentWebhookEvents(["run.created"], hidden).ok, false);
  assert.equal(events.availableAgentWebhookEventDefinitions(false)["run.created"], undefined);
});

test("the MCP webhook tool accepts chat and lifecycle event names", () => {
  const jiti = createJiti(path.join(root, `tests/agent-runs-schema-${++loadId}.cjs`), {
    alias: { "@": path.join(root, "src") },
    interopDefault: true,
  });
  const { AgentWebhookInputSchema } = jiti(
    path.join(root, "src/lib/mcp-server/validations/webhook.validation.ts"),
  );

  const parsed = AgentWebhookInputSchema.parse({
    action: "configure",
    agent_id: "self",
    events: ["chat.message", "run.created", "run.prompted", "run.stopped"],
  });
  assert.deepEqual(parsed.events, [
    "chat.message",
    "run.created",
    "run.prompted",
    "run.stopped",
  ]);
});

test("flag-off webhook updates preserve hidden run subscriptions", async () => {
  const managementPath = path.join(root, "src/lib/agentWebhooks/management.ts");
  delete require.cache[managementPath];
  const existing = {
    id: "subscription-1",
    agentId: "agent-1",
    projectId: null,
    url: "https://agent.example/webhook",
    secret: "whsec_existing",
    events: ["run.created"],
    active: true,
    createdAt: new Date("2026-09-04T10:00:00.000Z"),
    updatedAt: new Date("2026-09-04T10:00:00.000Z"),
    lastDeliveryAt: null,
    lastDeliveryOk: null,
  };
  let persisted;
  const transaction = {
    $executeRaw: async () => 1,
    agentWebhookSubscription: {
      findUnique: async () => existing,
      upsert: async ({ update }) => {
        persisted = { ...existing, ...update };
        return persisted;
      },
    },
  };
  stub("src/lib/prisma.ts", {
    default: {
      agent: { findFirst: async () => ({ id: "agent-1" }) },
      $transaction: async (callback) => callback(transaction),
    },
  });
  stub("src/lib/flags.ts", { isFeatureEnabled: async () => false });
  stub("src/lib/mcp/webhooks/ssrfGuard.ts", {
    assertSafeWebhookTarget: async () => ({ ok: true }),
  });
  stub("src/utils/controllers/agents/boardMembers.ts", {
    isAgentOnBoard: async () => true,
  });
  stub("src/utils/controllers/projects/getAllIncludes.ts", {
    getProjectWhere: () => ({}),
  });
  stub("src/lib/agentWebhooks/outbox.ts", {});
  const jiti = createJiti(
    path.join(root, `tests/agent-runs-management-${++loadId}.cjs`),
    {
      alias: { "@": path.join(root, "src") },
      interopDefault: true,
    },
  );
  const { upsertAgentWebhook } = jiti(managementPath);

  const result = await upsertAgentWebhook({
    userId: 6,
    agentId: "agent-1",
    body: { active: false },
  });

  assert.deepEqual(persisted.events, ["run.created"]);
  assert.deepEqual(result.subscription.events, []);
  assert.equal(result.subscription.active, false);
});
