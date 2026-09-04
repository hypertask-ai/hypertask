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

function load(relativePath) {
  return createJiti(
    path.join(root, `tests/agent-run-activities-${++loadId}.cjs`),
    { alias: { "@": path.join(root, "src") }, interopDefault: true },
  )(path.join(root, relativePath));
}

const model = load("src/lib/agentRuns/model.ts");
const persistence = load("src/lib/agentRuns/persistence.ts");

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
      title: "Run activities",
      userId: 6,
    },
    chatSession: null,
    ...overrides,
  };
}

function activityRow(overrides = {}) {
  return {
    id: "activity-1",
    runId: "run-1",
    type: "THOUGHT",
    text: "Checking the task",
    link: null,
    options: null,
    idempotencyKey: "activity-key",
    selectedValue: null,
    selectedLabel: null,
    selectedAt: null,
    selectedById: null,
    createdAt: new Date("2026-09-04T10:01:00.000Z"),
    ...overrides,
  };
}

function matchesRun(run, where) {
  const status = where.status;
  const statusMatches =
    !status ||
    (typeof status === "string"
      ? run.status === status
      : status.in.includes(run.status));
  const clockMatches =
    !where.lastActivityAt || run.lastActivityAt <= where.lastActivityAt.lte;
  return (
    run.id === where.id &&
    (!where.agentId || run.agentId === where.agentId) &&
    (where.taskId === undefined || run.taskId === where.taskId) &&
    (where.chatSessionId === undefined ||
      run.chatSessionId === where.chatSessionId) &&
    (!where.agent || run.ownerId === where.agent.userId) &&
    statusMatches &&
    clockMatches
  );
}

function fakeDatabase(initialRuns = [], initialActivities = []) {
  const runs = initialRuns;
  const activities = initialActivities;
  const messages = [];
  const sessionUpdates = [];
  const db = {
    runs,
    activities,
    messages,
    sessionUpdates,
    agentRun: {
      findFirst: async ({ where, select }) => {
        const run = runs.find((candidate) => matchesRun(candidate, where));
        if (!run) return null;
        if (select?.activities) {
          return {
            activities: activities
              .filter(({ runId }) => runId === run.id)
              .sort(
                (a, b) =>
                  a.createdAt - b.createdAt || a.id.localeCompare(b.id),
              ),
          };
        }
        return run;
      },
      updateMany: async ({ where, data }) => {
        const matching = runs.filter((run) => matchesRun(run, where));
        matching.forEach((run) => Object.assign(run, data));
        return { count: matching.length };
      },
    },
    agentRunActivity: {
      create: async ({ data }) => {
        if (
          data.idempotencyKey &&
          activities.some(
            (row) =>
              row.runId === data.runId &&
              row.idempotencyKey === data.idempotencyKey,
          )
        ) {
          throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
        }
        const row = activityRow({
          ...data,
          options: data.options ?? null,
          selectedValue: null,
          selectedLabel: null,
          selectedAt: null,
          selectedById: null,
        });
        activities.push(row);
        return row;
      },
      findUnique: async ({ where }) => {
        if (where.id) return activities.find(({ id }) => id === where.id) ?? null;
        const key = where.runId_idempotencyKey;
        return (
          activities.find(
            (row) =>
              row.runId === key.runId &&
              row.idempotencyKey === key.idempotencyKey,
          ) ?? null
        );
      },
      findFirst: async ({ where }) =>
        activities.find(
          (row) => row.id === where.id && row.runId === where.runId,
        ) ?? null,
      updateMany: async ({ where, data }) => {
        const matching = activities.filter(
          (row) =>
            row.id === where.id &&
            row.runId === where.runId &&
            row.type === where.type &&
            (where.selectedAt !== null || row.selectedAt === null),
        );
        matching.forEach((row) => Object.assign(row, data));
        return { count: matching.length };
      },
    },
    chatMessage: {
      create: async ({ data }) => {
        const message = {
          id: `message-${messages.length + 1}`,
          createdAt: new Date(),
          ...data,
        };
        messages.push(message);
        return message;
      },
    },
    chatSession: {
      update: async (input) => {
        sessionUpdates.push(input);
        return input;
      },
    },
  };
  db.$transaction = async (callback) => callback(db);
  return db;
}

const agentPrincipal = {
  userId: 6,
  agentId: "agent-1",
  displayName: "Run agent",
  source: "agent",
};
const browserPrincipal = {
  userId: 6,
  agentId: null,
  displayName: "Valentin",
  source: "browser",
};

function activityInput(overrides = {}) {
  return {
    type: "THOUGHT",
    text: "Checking the task",
    link: null,
    options: null,
    ...overrides,
  };
}

test("activity input accepts typed rows and rejects invalid type-specific fields", () => {
  assert.deepEqual(
    model.parseAgentRunActivityInput({
      type: "elicitation",
      text: "Choose a board",
      options: [
        { value: "product", label: "Product" },
        { value: "docs", label: "Docs" },
      ],
    }),
    {
      type: "ELICITATION",
      text: "Choose a board",
      link: null,
      options: [
        { value: "product", label: "Product" },
        { value: "docs", label: "Docs" },
      ],
    },
  );
  assert.throws(
    () =>
      model.parseAgentRunActivityInput({
        type: "thought",
        text: "Unsafe link",
        link: "javascript:alert(1)",
      }),
    model.AgentRunActivityInputError,
  );
  assert.throws(
    () =>
      model.parseAgentRunActivityInput({
        type: "elicitation",
        text: "Missing choices",
      }),
    /options are required for elicitation activities/,
  );
  assert.throws(
    () =>
      model.parseAgentRunActivityInput({
        type: "elicitation",
        text: "Duplicate",
        options: [
          { value: "same", label: "First" },
          { value: "same", label: "Second" },
        ],
      }),
    /option values must be unique/,
  );
});

test("persistence reactivates stale runs without moving a newer heartbeat backward", async () => {
  const newer = new Date("2026-09-04T10:04:00.000Z");
  const run = runRow({ status: "STALE", lastActivityAt: newer });
  const db = fakeDatabase([run]);

  await persistence.persistAgentRunActivity(db, {
    ...activityInput(),
    id: "activity-2",
    runId: run.id,
    agentId: run.agentId,
    context: { taskId: run.taskId, chatSessionId: null },
    idempotencyKey: null,
    createdAt: new Date("2026-09-04T10:03:00.000Z"),
  });

  assert.equal(run.status, "ACTIVE");
  assert.equal(run.lastActivityAt, newer);
  assert.equal(db.activities.length, 1);
});

test("persistence rejects a late activity after a run stops", async () => {
  const run = runRow({ status: "STOPPED" });
  const db = fakeDatabase([run]);
  await assert.rejects(
    persistence.persistAgentRunActivity(db, {
      ...activityInput(),
      id: "activity-2",
      runId: run.id,
      agentId: run.agentId,
      context: { taskId: run.taskId, chatSessionId: null },
      idempotencyKey: null,
      createdAt: new Date(),
    }),
    model.AgentRunNotActiveError,
  );
  assert.equal(db.activities.length, 0);
});

function loadService({ runs = [], activities = [] } = {}) {
  const db = fakeDatabase(runs, activities);
  const commentCalls = [];
  const webhookEvents = [];
  const published = [];
  const broadcasts = [];
  stub("src/lib/prisma.ts", { default: db });
  stub("src/lib/flags.ts", { isFeatureEnabled: async () => true });
  stub("src/lib/mcp/auth.ts", { validateMcpAuth: async () => null });
  stub("src/lib/auth/getSessionUser.ts", { getSessionUser: async () => null });
  stub("src/lib/agentWebhooks/outbox.ts", {
    persistAgentRunStoppedWebhook: async () => null,
    persistAgentWebhookEvent: async (_tx, event) => {
      webhookEvents.push(event);
      return "delivery-1";
    },
    publishAgentWebhookDeliveries: async (ids) => published.push(...ids),
  });
  stub("src/utils/helperFunctions/toStoredHtml.ts", {
    toStoredHtml: (text) => `<p>${text}</p>`,
  });
  stub("src/lib/realtime/server.ts", {
    AGENT_CHAT_EVENT: "agent-chat:changed",
    userChannel: (id) => `user-${id}`,
    broadcast: async (...args) => broadcasts.push(args),
    broadcastTaskComment: async (...args) => broadcasts.push(args),
  });
  stub("src/utils/controllers/comments/createCommentService.ts", {
    createCommentService: async (input) => {
      commentCalls.push(input);
      if (input.agentRunActivity) {
        await persistence.persistAgentRunActivity(db, input.agentRunActivity);
      }
      if (input.agentRunSelection) {
        await persistence.persistAgentRunSelection(db, input.agentRunSelection);
      }
      return { id: commentCalls.length, text: input.text };
    },
  });
  const servicePath = "src/lib/agentRuns/service.ts";
  delete require.cache[path.join(root, servicePath)];
  return {
    service: load(servicePath),
    db,
    commentCalls,
    webhookEvents,
    published,
    broadcasts,
  };
}

test("only the owner browser and matching agent can list run activities", async () => {
  const run = runRow();
  const activity = activityRow();
  const harness = loadService({ runs: [run], activities: [activity] });

  assert.deepEqual(
    await harness.service.listAgentRunActivities(browserPrincipal, run.id),
    [model.serializeAgentRunActivity(activity)],
  );
  assert.deepEqual(
    await harness.service.listAgentRunActivities(agentPrincipal, run.id),
    [model.serializeAgentRunActivity(activity)],
  );
  assert.equal(
    await harness.service.listAgentRunActivities(
      { ...browserPrincipal, userId: 7 },
      run.id,
    ),
    null,
  );
});

test("only the matching agent creates an idempotent task response and visible comment", async () => {
  const run = runRow({ status: "STALE" });
  const harness = loadService({ runs: [run] });
  const input = activityInput({ type: "RESPONSE", text: "Done" });

  const first = await harness.service.createAgentRunActivity(
    agentPrincipal,
    run.id,
    input,
    "response-1",
  );
  const replay = await harness.service.createAgentRunActivity(
    agentPrincipal,
    run.id,
    input,
    "response-1",
  );
  const other = await harness.service.createAgentRunActivity(
    { ...agentPrincipal, agentId: "agent-2" },
    run.id,
    input,
    "response-2",
  );

  assert.equal(first.duplicate, false);
  assert.equal(replay.duplicate, true);
  assert.equal(other, null);
  assert.equal(harness.db.activities.length, 1);
  assert.equal(harness.commentCalls.length, 1);
  assert.equal(harness.commentCalls[0].text, "<p>Done</p>");
  assert.equal(harness.commentCalls[0].agentRunActivity.runId, run.id);
  assert.equal(run.status, "ACTIVE");
  await assert.rejects(
    harness.service.createAgentRunActivity(
      agentPrincipal,
      run.id,
      { ...input, text: "Different" },
      "response-1",
    ),
    model.AgentRunActivityConflictError,
  );
});

test("an idempotency unique race replays every non-null service key", async () => {
  const run = runRow();
  const harness = loadService({ runs: [run] });
  const input = activityInput();
  harness.db.agentRunActivity.create = async ({ data }) => {
    harness.db.activities.push(
      activityRow({
        ...data,
        id: "winning-activity",
        options: data.options ?? null,
      }),
    );
    throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
  };

  const result = await harness.service.createAgentRunActivity(
    agentPrincipal,
    run.id,
    input,
    "",
  );

  assert.equal(result.duplicate, true);
  assert.equal(result.activity.id, "winning-activity");
  assert.equal(harness.db.activities.length, 1);
});

test("chat responses store the activity and assistant message together", async () => {
  const run = runRow({
    taskId: null,
    task: null,
    chatSessionId: "session-1",
    chatSession: { id: "session-1", userId: 6, agentId: "agent-1" },
    trigger: "CHAT",
  });
  const harness = loadService({ runs: [run] });

  await harness.service.createAgentRunActivity(
    agentPrincipal,
    run.id,
    activityInput({ type: "RESPONSE", text: "Chat answer" }),
    "chat-response-1",
  );

  assert.equal(harness.db.activities.length, 1);
  assert.deepEqual(
    harness.db.messages.map(({ role, content, sessionId }) => ({
      role,
      content,
      sessionId,
    })),
    [{ role: "assistant", content: "Chat answer", sessionId: "session-1" }],
  );
  assert.equal(harness.db.sessionUpdates.length, 1);
});

test("one browser selection wins and its retry does not post twice", async () => {
  const run = runRow();
  const elicitation = activityRow({
    type: "ELICITATION",
    options: [
      { value: "product", label: "Product" },
      { value: "docs", label: "Docs" },
    ],
  });
  const harness = loadService({ runs: [run], activities: [elicitation] });

  const first = await harness.service.selectAgentRunActivity(
    browserPrincipal,
    run.id,
    elicitation.id,
    "docs",
  );
  const replay = await harness.service.selectAgentRunActivity(
    browserPrincipal,
    run.id,
    elicitation.id,
    "docs",
  );

  assert.equal(first.duplicate, false);
  assert.equal(replay.duplicate, true);
  assert.equal(elicitation.selectedValue, "docs");
  assert.equal(elicitation.selectedLabel, "Docs");
  assert.equal(elicitation.selectedById, 6);
  assert.equal(harness.commentCalls.length, 1);
  assert.equal(harness.commentCalls[0].text, "<p>Docs</p>");
  assert.equal(
    await harness.service.selectAgentRunActivity(
      agentPrincipal,
      run.id,
      elicitation.id,
      "docs",
    ),
    null,
  );
  await assert.rejects(
    harness.service.selectAgentRunActivity(
      browserPrincipal,
      run.id,
      elicitation.id,
      "product",
    ),
    model.AgentRunSelectionConflictError,
  );
});

test("a stopped run rejects a late elicitation selection", async () => {
  const run = runRow({ status: "STOPPED" });
  const elicitation = activityRow({
    type: "ELICITATION",
    options: [{ value: "yes", label: "Yes" }],
  });
  const harness = loadService({ runs: [run], activities: [elicitation] });

  await assert.rejects(
    harness.service.selectAgentRunActivity(
      browserPrincipal,
      run.id,
      elicitation.id,
      "yes",
    ),
    model.AgentRunNotActiveError,
  );
  assert.equal(elicitation.selectedAt, null);
  assert.equal(harness.commentCalls.length, 0);
});

test("chat selection posts one human message and one select prompt event", async () => {
  const run = runRow({
    taskId: null,
    task: null,
    chatSessionId: "session-1",
    chatSession: { id: "session-1", userId: 6, agentId: "agent-1" },
    trigger: "CHAT",
  });
  const elicitation = activityRow({
    type: "ELICITATION",
    options: [{ value: "yes", label: "Yes" }],
  });
  const harness = loadService({ runs: [run], activities: [elicitation] });

  await harness.service.selectAgentRunActivity(
    browserPrincipal,
    run.id,
    elicitation.id,
    "yes",
  );

  assert.equal(harness.db.messages.length, 1);
  assert.equal(harness.db.messages[0].role, "human");
  assert.equal(harness.webhookEvents.length, 1);
  assert.equal(harness.webhookEvents[0].event, "run.prompted");
  assert.equal(harness.webhookEvents[0].signal, "select");
  assert.deepEqual(harness.webhookEvents[0].selection, {
    activityId: elicitation.id,
    value: "yes",
    label: "Yes",
  });
  assert.deepEqual(harness.published, ["delivery-1"]);
});

test("migration constrains retry keys and elicitation selections", () => {
  const migration = require("node:fs").readFileSync(
    path.join(
      root,
      "src/prisma/migrations/20260904152000_add_agent_run_activities/migration.sql",
    ),
    "utf8",
  );
  assert.match(migration, /UNIQUE INDEX "AgentRunActivity_runId_idempotencyKey_key"/);
  assert.match(migration, /AgentRunActivity_selection_check/);
  assert.match(migration, /AgentRunActivity_options_type_check/);
});

function loadAtomicCommentService(prisma, persistAgentWebhookEvent) {
  const noop = async () => {};
  const modules = {
    "src/lib/prisma.ts": { default: prisma },
    "src/utils/controllers/notifications/IdsToSendNotificationsTo.ts": {
      default: async () => [],
    },
    "src/lib/realtime/server.ts": {
      broadcastBoardChange: noop,
      broadcastInboxChange: noop,
    },
    "src/utils/controllers/notifications/creation-service/check-reminder_create-notification.ts":
      { default: noop },
    "src/utils/controllers/notifications/agentActionRecipients.ts": {
      includeSenderInRecipients: () => false,
      shouldNotifyTaskOwnerForComment: () => false,
    },
    "src/pages/api/queues/FAST/generateSummary.ts": { default: noop },
    "src/utils/controllers/tasks/single.ts": { updateTaskSingle: noop },
    "src/utils/controllers/turbopuffer/turbopufferHelper.ts": {
      upsertCommentToTurbopuffer: noop,
    },
    "src/utils/controllers/comments/processMentions.ts": {
      getMentionedUserIdsFromCommentText: () => [],
      getMentionedAgentIdsFromCommentText: () => [],
      processMentionsFromCommentText: noop,
    },
    "src/utils/controllers/comments/extractTaskReferences.ts": {
      extractTaskReferencesFromCommentText: () => [],
    },
    "src/utils/controllers/tasks/addRelatedTasks.ts": {
      addRelatedTasks: async () => ({ status: 200 }),
    },
    "src/utils/controllers/FCM/index.ts": { sendDataOnlyFcm: noop },
    "src/utils/controllers/notifications/shouldNotify.ts": {
      shouldNotify: async () => true,
    },
    "src/utils/controllers/notifications/sendNotification.ts": {
      sendEmailNotification: noop,
    },
    "src/pages/api/queues/FAST/generateCommentSummary.ts": { default: noop },
    "src/utils/controllers/projects/getAllIncludes.ts": {
      taskWriteAccessWhere: () => ({}),
    },
    "src/lib/ai/hyperAiConfirmation.ts": {
      recordHyperAiCommentOrigin: noop,
    },
    "src/lib/agentWebhooks/outbox.ts": {
      persistAgentRunTriggerWebhooks: async () => [],
      persistAgentTaskRunPromptWebhooks: async () => [],
      persistAgentWebhookEvent,
      persistAgentWebhookEvents: async () => [],
      publishAgentWebhookDeliveries: noop,
    },
    "src/lib/mcp/webhooks/outbox.ts": {
      persistBoardWebhookEvents: async () => [],
      publishBoardWebhookDeliveries: noop,
    },
    "src/lib/configs/general.config.ts": {
      generalConfig: { hyperAiId: 332 },
    },
    "src/utils/helperFunctions/normalizeRichTextStructure.ts": {
      normalizeRichTextStructure: (text) => text,
    },
    "src/utils/controllers/comments/agentInvocationCorrelation.ts": {
      buildAgentInvocationSelector: () => null,
      claimPendingAgentInvocation: async () => null,
      DirectReplyAlreadyHandledError: class extends Error {},
    },
    "src/utils/controllers/comments/inboundEmailReceipt.ts": {
      claimInboundEmailProcessing: noop,
      completeInboundEmailProcessing: noop,
      findInboundEmailReceipt: async () => null,
      recordInboundEmailComment: noop,
      releaseInboundEmailProcessing: noop,
      requireInboundEmailComment: () => null,
    },
  };
  for (const [relativePath, exports] of Object.entries(modules)) {
    stub(relativePath, exports);
  }
  const servicePath = "src/utils/controllers/comments/createCommentService.ts";
  delete require.cache[path.join(root, servicePath)];
  return load(servicePath).createCommentService;
}

function atomicCommentHarness() {
  const run = runRow();
  const elicitation = activityRow({
    type: "ELICITATION",
    options: [{ value: "yes", label: "Yes" }],
  });
  const task = {
    ...run.task,
    uniqueIndex: 42,
    waitingOnUserId: null,
    updatedByUserIds: [],
    project: { team: {}, owner: { devices: [] } },
  };
  const activities = [elicitation];
  const comments = [];
  const webhookWrites = [];
  let failure = "comment";

  const tx = {
    $queryRaw: async () => [{ id: task.id }],
    task: { findFirst: async () => task },
    agentRun: {
      updateMany: async ({ where, data }) => {
        if (!matchesRun(run, where)) return { count: 0 };
        Object.assign(run, data);
        return { count: 1 };
      },
      findFirst: async ({ where }) => (matchesRun(run, where) ? run : null),
    },
    agentRunActivity: {
      create: async ({ data }) => {
        const activity = activityRow({
          ...data,
          options: data.options ?? null,
        });
        activities.push(activity);
        return activity;
      },
      updateMany: async ({ where, data }) => {
        const activity = activities.find(
          (candidate) =>
            candidate.id === where.id &&
            candidate.runId === where.runId &&
            candidate.type === where.type &&
            candidate.selectedAt === null,
        );
        if (!activity) return { count: 0 };
        Object.assign(activity, data);
        return { count: 1 };
      },
    },
    comment: {
      create: async ({ data }) => {
        if (failure === "comment") throw new Error("comment write failed");
        const comment = {
          id: `comment-${comments.length + 1}`,
          createdAt: new Date(),
          ...data,
        };
        comments.push(comment);
        return comment;
      },
    },
    assignees: { findMany: async () => [] },
  };
  const prisma = {
    ...tx,
    $transaction: async (callback) => {
      const runSnapshot = { ...run };
      const activityRows = [...activities];
      const activitySnapshots = activityRows.map((activity) => ({ ...activity }));
      const commentCount = comments.length;
      const webhookCount = webhookWrites.length;
      try {
        return await callback(tx);
      } catch (error) {
        Object.assign(run, runSnapshot);
        activityRows.forEach((activity, index) =>
          Object.assign(activity, activitySnapshots[index]),
        );
        activities.splice(0, activities.length, ...activityRows);
        comments.length = commentCount;
        webhookWrites.length = webhookCount;
        throw error;
      }
    },
  };
  const createCommentService = loadAtomicCommentService(
    prisma,
    async (_tx, event) => {
      webhookWrites.push(event);
      if (failure === "webhook") throw new Error("selection webhook failed");
      return "delivery-1";
    },
  );
  return {
    run,
    elicitation,
    activities,
    comments,
    webhookWrites,
    createCommentService,
    setFailure: (value) => {
      failure = value;
    },
  };
}

test("activity comments and selection prompts roll back as one transaction", async () => {
  const harness = atomicCommentHarness();
  const originalHeartbeat = harness.run.lastActivityAt;
  const commentInput = {
    creatorId: 6,
    taskId: 42,
    ownerId: 6,
    currentUser: { id: 6, displayName: "Valentin" },
    accessUserId: 6,
  };

  await assert.rejects(
    harness.createCommentService({
      ...commentInput,
      text: "<p>Answer</p>",
      agentId: "agent-1",
      agentRunActivity: {
        ...activityInput({ type: "RESPONSE", text: "Answer" }),
        id: "response-activity",
        runId: "run-1",
        agentId: "agent-1",
        context: { taskId: 42, chatSessionId: null },
        idempotencyKey: "response-key",
        createdAt: new Date("2026-09-04T10:02:00.000Z"),
      },
    }),
    /comment write failed/,
  );
  assert.equal(harness.activities.length, 1);
  assert.equal(harness.run.lastActivityAt, originalHeartbeat);

  harness.setFailure("webhook");
  await assert.rejects(
    harness.createCommentService({
      ...commentInput,
      text: "<p>Yes</p>",
      agentRunSelection: {
        runId: "run-1",
        agentId: "agent-1",
        activityId: harness.elicitation.id,
        context: { taskId: 42, chatSessionId: null },
        option: { value: "yes", label: "Yes" },
        selectedById: 6,
        selectedAt: new Date("2026-09-04T10:03:00.000Z"),
      },
    }),
    /selection webhook failed/,
  );
  assert.equal(harness.elicitation.selectedAt, null);
  assert.equal(harness.comments.length, 0);
  assert.equal(harness.webhookWrites.length, 0);
  assert.equal(harness.run.lastActivityAt, originalHeartbeat);
});
