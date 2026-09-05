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
    agent: {
      user: {
        id: 6,
        email: "agent-owner@example.com",
        displayName: "Persisted agent owner",
        photoURL: null,
      },
    },
    task: {
      id: 42,
      projectId: 15,
      ticketNumber: "HTPR-42",
      title: "Run activities",
      userId: 6,
    },
    taskStatus: "Normal",
    projectStatus: "Normal",
    projectOwnerId: 6,
    projectMemberIds: [],
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
    responseCommentId: null,
    selectionCommentId: null,
    commentAgentWebhookDeliveryIds: [],
    commentBoardWebhookDeliveryIds: [],
    commentNotificationsProcessingAt: null,
    commentNotificationDeliveryKeys: [],
    commentMentionsAttemptedAt: null,
    commentFcmAttemptedAt: null,
    commentEmailsAttemptedAt: null,
    commentNotificationsCompletedAt: null,
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

function matchesTaskAccess(run, where) {
  if (!where) return true;
  if (where.status?.not && run.taskStatus === where.status.not) return false;

  const projectWhere = where.project;
  if (!projectWhere) return true;
  if (projectWhere.status?.not && run.projectStatus === projectWhere.status.not) {
    return false;
  }
  if (!projectWhere.OR) return true;

  return projectWhere.OR.some(
    (condition) =>
      condition.ownerId === run.projectOwnerId ||
      (condition.members?.some?.userId !== undefined &&
        run.projectMemberIds.includes(condition.members.some.userId)),
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
          const direction = select.activities.orderBy[0].createdAt === "desc" ? -1 : 1;
          return {
            activities: activities
              .filter(({ runId }) => runId === run.id)
              .sort(
                (a, b) =>
                  direction *
                  (a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
              )
              .slice(0, select.activities.take),
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
      findMany: async ({ where, orderBy, take }) => {
        const runWhere = where.run;
        const matchingRunIds = new Set(
          runs
            .filter(
              (run) =>
                run.taskId === runWhere.taskId &&
                run.ownerId === runWhere.agent.userId &&
                matchesTaskAccess(run, runWhere.task),
            )
            .map(({ id }) => id),
        );
        const direction = orderBy[0].createdAt === "desc" ? -1 : 1;
        return activities
          .filter(
            ({ runId, type }) =>
              matchingRunIds.has(runId) &&
              (!where.type?.not || type !== where.type.not),
          )
          .sort(
            (a, b) =>
              direction *
              (a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
          )
          .slice(0, take);
      },
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
      update: async ({ where, data }) => {
        const activity = activities.find(({ id }) => id === where.id);
        if (!activity) throw new Error("Activity not found");
        Object.assign(activity, data);
        return activity;
      },
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
    user: {
      findUnique: async ({ where }) =>
        where.id === 6
          ? {
              id: 6,
              email: "valentin@example.com",
              displayName: "Persisted selector",
              photoURL: null,
            }
          : null,
    },
    chatMessage: {
      findFirst: async () => messages.at(-1) ?? { id: "human-1", role: "human" },
      createMany: async ({ data }) => {
        const created = data.filter((row) => !messages.some((item) => item.replyToMessageId === row.replyToMessageId));
        messages.push(...created.map((row, index) => ({ id: `message-${messages.length + index + 1}`, ...row })));
        return { count: created.length };
      },
      create: async ({ data }) => {
        if (data.replyToMessageId && messages.some((item) => item.replyToMessageId === data.replyToMessageId)) {
          throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
        }
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
      findFirst: async ({ where }) => where.userId !== 6 ? null : ({
        id: where.id,
        messages: messages.filter((message) => message.sessionId === where.id).slice(-1).reverse(),
        agentRuns: runs.filter((run) => run.chatSessionId === where.id && ["ACTIVE", "STALE"].includes(run.status)).slice(-1),
      }),
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
  assert.deepEqual(
    model.parseAgentRunActivityInput({
      type: "thought",
      text: "Nullable fields",
      link: null,
      options: null,
    }),
    {
      type: "THOUGHT",
      text: "Nullable fields",
      link: null,
      options: null,
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

function loadService({
  runs = [],
  activities = [],
  featureEnabled = () => true,
  commentFailureAfterPersistence = false,
} = {}) {
  const db = fakeDatabase(runs, activities);
  const commentCalls = [];
  let failCommentAfterPersistence = commentFailureAfterPersistence;
  const webhookEvents = [];
  const published = [];
  const broadcasts = [];
  const flagChecks = [];
  stub("src/lib/prisma.ts", { default: db });
  stub("src/lib/flags.ts", {
    isFeatureEnabled: async (key) => {
      flagChecks.push(key);
      return featureEnabled(key);
    },
  });
  stub("src/lib/mcp/auth.ts", { validateMcpAuth: async () => null });
  stub("src/lib/auth/getSessionUser.ts", { getSessionUser: async () => null });
  stub("src/utils/controllers/projects/getAllIncludes.ts", {
    projectContentAccessWhere: (userId) => ({
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    }),
  });
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
      const commentId = commentCalls.length;
      if (input.agentRunActivity) {
        const activity = await persistence.persistAgentRunActivity(
          db,
          input.agentRunActivity,
        );
        activity.responseCommentId = commentId;
      }
      if (input.agentRunSelection) {
        await persistence.persistAgentRunSelection(db, input.agentRunSelection);
        const activity = db.activities.find(
          ({ id }) => id === input.agentRunSelection.activityId,
        );
        activity.selectionCommentId = commentId;
      }
      if (failCommentAfterPersistence) {
        failCommentAfterPersistence = false;
        throw new Error("post-commit comment side effect failed");
      }
      const activityId =
        input.agentRunActivity?.id ??
        input.agentRunSelection?.activityId ??
        input.agentRunReplayComment?.activityId;
      const activity = db.activities.find(({ id }) => id === activityId);
      if (activity && !activity.commentNotificationsCompletedAt) {
        activity.commentNotificationsCompletedAt = new Date();
      }
      return { id: commentId, text: input.text };
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
    flagChecks,
  };
}

function loadChatTurn() {
  const createdAt = new Date("2026-09-04T10:00:00.000Z");
  const run = runRow({
    taskId: null, task: null, trigger: "CHAT", chatSessionId: "chat-1",
    chatSession: { id: "chat-1", agentId: "agent-1", userId: 6 }, lastActivityAt: createdAt,
  });
  const harness = loadService({ runs: [run] });
  harness.db.messages.push({ id: "human-1", sessionId: "chat-1", role: "human", content: "hello", isDelivered: true, createdAt });
  return { ...harness, run };
}

test("chat Stop and timeout persist one outcome against late replies", async () => {
  const stopped = loadChatTurn();
  assert.equal(await stopped.service.stopAgentChatTurn({ ...browserPrincipal, userId: 7 }, "chat-1"), null);
  assert.ok(await stopped.service.stopAgentChatTurn(browserPrincipal, "chat-1"));
  assert.equal(stopped.run.status, "STOPPED");
  assert.equal(stopped.db.messages.at(-1).content, model.AGENT_CHAT_STOPPED_MESSAGE);

  const racing = loadChatTurn();
  const [, response] = await Promise.allSettled([
    racing.service.readAgentChatTurn(browserPrincipal, "chat-1", new Date("2026-09-04T10:05:00.000Z")), racing.service.createAgentRunActivity(agentPrincipal, racing.run.id, activityInput({ type: "RESPONSE", text: "late" }), null),
  ]);
  assert.equal(response.status, "rejected");
  assert.equal(racing.db.messages.filter((message) => message.replyToMessageId === "human-1").length, 1);
  assert.equal(racing.db.messages.at(-1).content, model.AGENT_CHAT_TIMEOUT_MESSAGE);
});

test("activity behavior requires the parent and ticket feature flags", async () => {
  const activityFlagDisabled = loadService({
    featureEnabled: (key) => key !== model.AGENT_RUN_ACTIVITY_FEATURE_FLAG,
  });

  assert.equal(
    await activityFlagDisabled.service.agentRunActivitiesEnabledFor(agentPrincipal),
    false,
  );
  assert.deepEqual(activityFlagDisabled.flagChecks, [
    model.AGENT_RUN_FEATURE_FLAG,
    model.AGENT_RUN_ACTIVITY_FEATURE_FLAG,
  ]);

  const sdkFlagDisabled = loadService({
    featureEnabled: (key) => key !== model.AGENT_SDK_FEATURE_FLAG,
  });
  assert.equal(
    await sdkFlagDisabled.service.agentRunActivitiesEnabledFor(agentPrincipal),
    true,
  );
  assert.equal(
    await sdkFlagDisabled.service.agentRunActivitiesEnabledFor({
      ...agentPrincipal,
      sdk: "typescript",
    }),
    false,
  );
  assert.deepEqual(sdkFlagDisabled.flagChecks, [
    model.AGENT_RUN_FEATURE_FLAG,
    model.AGENT_RUN_ACTIVITY_FEATURE_FLAG,
    model.AGENT_RUN_FEATURE_FLAG,
    model.AGENT_SDK_FEATURE_FLAG,
  ]);

  const parentFlagDisabled = loadService({
    featureEnabled: (key) => key !== model.AGENT_RUN_FEATURE_FLAG,
  });
  assert.equal(
    await parentFlagDisabled.service.agentRunActivitiesEnabledFor(agentPrincipal),
    false,
  );
  assert.deepEqual(parentFlagDisabled.flagChecks, [model.AGENT_RUN_FEATURE_FLAG]);
});

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
      { ...agentPrincipal, agentId: "agent-2" },
      run.id,
    ),
    null,
  );
  assert.equal(
    await harness.service.listAgentRunActivities(
      { ...browserPrincipal, userId: 7 },
      run.id,
    ),
    null,
  );
});

test("activity lists keep the newest 500 rows in chronological order", async () => {
  const run = runRow();
  const activities = Array.from({ length: 502 }, (_, index) =>
    activityRow({
      id: `activity-${String(index).padStart(3, "0")}`,
      createdAt: new Date(index),
    }),
  );
  const harness = loadService({ runs: [run], activities });

  const listed = await harness.service.listAgentRunActivities(browserPrincipal, run.id);

  assert.equal(listed.length, 500);
  assert.equal(listed[0].id, "activity-002");
  assert.equal(listed[499].id, "activity-501");
});

test("task activity refreshes Agent Chat without creating a chat message", async () => {
  const run = runRow();
  const harness = loadService({ runs: [run] });

  await harness.service.createAgentRunActivity(
    agentPrincipal,
    run.id,
    activityInput({ type: "ACTION", text: "Opened PR" }),
    "action-1",
  );

  assert.deepEqual(harness.broadcasts, [
    [42, { originUserId: 6 }],
    ["user-6", "agent-chat:changed", { agentId: "agent-1" }],
  ]);
  assert.equal(harness.db.messages.length, 0);
});

test("task activity feed only returns flag-enabled runs owned by an authorized viewer", async () => {
  const ownedRun = runRow();
  const otherRun = runRow({ id: "run-2", ownerId: 7 });
  const inaccessibleRun = runRow({ id: "run-3", projectOwnerId: 7 });
  const activities = [
    activityRow(),
    activityRow({ id: "activity-2", runId: otherRun.id }),
    activityRow({ id: "activity-3", runId: inaccessibleRun.id }),
    activityRow({ id: "activity-4", type: "RESPONSE" }),
  ];
  const harness = loadService({
    runs: [ownedRun, otherRun, inaccessibleRun],
    activities,
  });

  assert.deepEqual(
    await harness.service.listTaskAgentRunActivities(6, 42),
    [model.serializeAgentRunActivity(activities[0])],
  );

  const disabled = loadService({
    runs: [ownedRun],
    activities: [activities[0]],
    featureEnabled: (key) => key !== model.AGENT_RUN_ACTIVITY_FEATURE_FLAG,
  });
  assert.deepEqual(
    await disabled.service.listTaskAgentRunActivities(6, 42),
    [],
  );
});

test("only the matching agent creates an idempotent task response and visible comment", async () => {
  const run = runRow({ status: "STALE" });
  const harness = loadService({ runs: [run] });
  const input = activityInput({ type: "RESPONSE", text: "Done" });
  const requestingAgent = {
    ...agentPrincipal,
    userId: 7,
    displayName: "Requesting principal",
  };

  const first = await harness.service.createAgentRunActivity(
    requestingAgent,
    run.id,
    input,
    "response-1",
  );
  const replay = await harness.service.createAgentRunActivity(
    requestingAgent,
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
  assert.equal(harness.commentCalls.length, 2);
  assert.equal(harness.commentCalls[0].text, "<p>Done</p>");
  assert.equal(harness.commentCalls[0].creatorId, run.agent.user.id);
  assert.deepEqual(harness.commentCalls[0].currentUser, run.agent.user);
  assert.equal(harness.commentCalls[0].accessUserId, requestingAgent.userId);
  assert.deepEqual(harness.commentCalls[1].currentUser, run.agent.user);
  assert.equal(harness.commentCalls[1].agentRunReplayComment.id, 1);
  assert.equal(harness.commentCalls[0].agentRunActivity.runId, run.id);
  assert.equal(run.status, "ACTIVE");
  assert.equal(harness.broadcasts.length, 0);
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

test("a task response retry resumes side effects after its comment commits", async () => {
  const run = runRow();
  const harness = loadService({
    runs: [run],
    commentFailureAfterPersistence: true,
  });
  const input = activityInput({ type: "RESPONSE", text: "Done" });

  await assert.rejects(
    harness.service.createAgentRunActivity(
      agentPrincipal,
      run.id,
      input,
      "response-retry",
    ),
    /post-commit comment side effect failed/,
  );
  const replay = await harness.service.createAgentRunActivity(
    agentPrincipal,
    run.id,
    input,
    "response-retry",
  );

  assert.equal(replay.duplicate, true);
  assert.equal(harness.db.activities.length, 1);
  assert.equal(harness.db.activities[0].responseCommentId, 1);
  assert.equal(harness.commentCalls.length, 2);
  assert.equal(harness.commentCalls[1].agentRunReplayComment.id, 1);
});

test("legacy task activities without comment links keep duplicate-only replay", async () => {
  const run = runRow();
  const response = activityRow({
    type: "RESPONSE",
    text: "Done",
    idempotencyKey: "legacy-response",
  });
  const selection = activityRow({
    id: "activity-2",
    type: "ELICITATION",
    options: [{ value: "yes", label: "Yes" }],
    selectedValue: "yes",
    selectedLabel: "Yes",
    selectedAt: new Date("2026-09-04T10:02:00.000Z"),
    selectedById: 6,
  });
  const harness = loadService({ runs: [run], activities: [response, selection] });

  const responseReplay = await harness.service.createAgentRunActivity(
    agentPrincipal,
    run.id,
    activityInput({ type: "RESPONSE", text: "Done" }),
    "legacy-response",
  );
  const selectionReplay = await harness.service.selectAgentRunActivity(
    browserPrincipal,
    run.id,
    selection.id,
    "yes",
  );

  assert.equal(responseReplay.duplicate, true);
  assert.equal(selectionReplay.duplicate, true);
  assert.equal(harness.commentCalls.length, 0);
  assert.equal(harness.broadcasts.length, 0);
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
  assert.equal(harness.broadcasts.length, 1);
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
  assert.equal(harness.commentCalls.length, 2);
  assert.equal(harness.commentCalls[0].text, "<p>Docs</p>");
  assert.equal(harness.commentCalls[1].agentRunReplayComment.id, 1);
  assert.equal(
    harness.commentCalls[1].currentUser.displayName,
    "Persisted selector",
  );
  assert.equal(harness.broadcasts.length, 0);
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

test("a task selection retry resumes side effects after its comment commits", async () => {
  const run = runRow();
  const elicitation = activityRow({
    type: "ELICITATION",
    options: [{ value: "yes", label: "Yes" }],
  });
  const harness = loadService({
    runs: [run],
    activities: [elicitation],
    commentFailureAfterPersistence: true,
  });

  await assert.rejects(
    harness.service.selectAgentRunActivity(
      browserPrincipal,
      run.id,
      elicitation.id,
      "yes",
    ),
    /post-commit comment side effect failed/,
  );
  const replay = await harness.service.selectAgentRunActivity(
    browserPrincipal,
    run.id,
    elicitation.id,
    "yes",
  );

  assert.equal(replay.duplicate, true);
  assert.equal(elicitation.selectionCommentId, 1);
  assert.equal(harness.commentCalls.length, 2);
  assert.equal(harness.commentCalls[1].agentRunReplayComment.id, 1);
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
  assert.equal(harness.broadcasts.length, 1);
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
  const replayMigration = require("node:fs").readFileSync(
    path.join(
      root,
      "src/prisma/migrations/20260904184500_add_agent_run_activity_comment_replay/migration.sql",
    ),
    "utf8",
  );
  assert.match(replayMigration, /ADD COLUMN "responseCommentId" INTEGER/);
  assert.match(replayMigration, /"commentAgentWebhookDeliveryIds" TEXT\[\]/);
  assert.match(
    replayMigration,
    /"commentNotificationsProcessingAt" TIMESTAMP\(3\)/,
  );
  assert.match(replayMigration, /"commentNotificationDeliveryKeys" TEXT\[\]/);
  assert.match(replayMigration, /"commentMentionsAttemptedAt" TIMESTAMP\(3\)/);
  assert.match(replayMigration, /"commentFcmAttemptedAt" TIMESTAMP\(3\)/);
  assert.match(replayMigration, /"commentEmailsAttemptedAt" TIMESTAMP\(3\)/);
  assert.match(replayMigration, /"commentNotificationsCompletedAt" TIMESTAMP\(3\)/);
  assert.match(replayMigration, /AgentRunActivity_selectionCommentId_fkey/);
});

function loadAtomicCommentService(
  prisma,
  persistAgentWebhookEvent,
  updateTaskSingle,
  broadcastTaskComment,
  publishAgentWebhookDeliveries,
  publishBoardWebhookDeliveries,
  sendDataOnlyFcm,
  processMentionsFromCommentText,
  extractTaskReferencesFromCommentText,
  sendEmailNotification = async () => true,
) {
  const noop = async () => {};
  const modules = {
    "src/lib/prisma.ts": { default: prisma },
    "src/utils/controllers/notifications/IdsToSendNotificationsTo.ts": {
      default: async () => [],
    },
    "src/lib/realtime/server.ts": {
      broadcastBoardChange: noop,
      broadcastInboxChange: noop,
      broadcastTaskComment,
    },
    "src/utils/controllers/notifications/creation-service/check-reminder_create-notification.ts":
      { default: noop },
    "src/utils/controllers/notifications/agentActionRecipients.ts": {
      includeSenderInRecipients: () => false,
      shouldNotifyTaskOwnerForComment: () => false,
    },
    "src/pages/api/queues/FAST/generateSummary.ts": { default: noop },
    "src/utils/controllers/tasks/single.ts": { updateTaskSingle },
    "src/utils/controllers/turbopuffer/turbopufferHelper.ts": {
      upsertCommentToTurbopuffer: noop,
    },
    "src/utils/controllers/comments/processMentions.ts": {
      getMentionedUserIdsFromCommentText: () => [],
      getMentionedAgentIdsFromCommentText: () => [],
      processMentionsFromCommentText,
    },
    "src/utils/controllers/comments/extractTaskReferences.ts": {
      extractTaskReferencesFromCommentText,
    },
    "src/utils/controllers/tasks/addRelatedTasks.ts": {
      addRelatedTasks: async () => ({ status: 200 }),
    },
    "src/utils/controllers/FCM/index.ts": { sendDataOnlyFcm },
    "src/utils/controllers/notifications/shouldNotify.ts": {
      shouldNotify: async () => true,
    },
    "src/utils/controllers/notifications/sendNotification.ts": {
      sendEmailNotification,
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
      publishAgentWebhookDeliveries,
    },
    "src/lib/mcp/webhooks/outbox.ts": {
      persistBoardWebhookEvents: async () => [],
      publishBoardWebhookDeliveries,
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
    totalComments: 0,
    lastCommentAt: null,
    updatedAt: new Date("2026-09-04T10:00:00.000Z"),
    project: { team: {}, owner: { devices: [] } },
  };
  const activities = [elicitation];
  const comments = [];
  const webhookWrites = [];
  const publishedAgentWebhookIds = [];
  const publishedBoardWebhookIds = [];
  const fcmCalls = [];
  const mentionCalls = [];
  const emailCalls = [];
  const commentRecipientUserIds = [];
  const taskCommentBroadcasts = [];
  const runCommentCompletionOrder = [];
  const sideEffectOrder = [];
  const draftDeleteWheres = [];
  const updateTaskCalls = [];
  let assigneeLookupCalls = 0;
  let leaseRenewals = 0;
  let draftDeleteCalls = 0;
  let taskReferenceParseCalls = 0;
  let failure = "comment";
  let releaseHeldMention;
  let markMentionProcessingStarted;
  const mentionProcessingStarted = new Promise((resolve) => {
    markMentionProcessingStarted = resolve;
  });

  const tx = {
    $queryRaw: async () => [{ id: task.id }],
    task: {
      findFirst: async () => task,
      update: async ({ data }) => {
        if (failure === "task") throw new Error("task update failed");
        if (data.totalComments) {
          task.totalComments += data.totalComments.increment;
        }
        if (data.updatedByUserIds) {
          task.updatedByUserIds.push(data.updatedByUserIds.push);
        }
        Object.assign(task, {
          ...(data.lastCommentAt ? { lastCommentAt: data.lastCommentAt } : {}),
          ...(data.updatedAt ? { updatedAt: data.updatedAt } : {}),
        });
        return task;
      },
    },
    agentRun: {
      updateMany: async ({ where, data }) => {
        if (!matchesRun(run, where)) return { count: 0 };
        Object.assign(run, data);
        return { count: 1 };
      },
      findFirst: async ({ where }) => (matchesRun(run, where) ? run : null),
    },
    agentRunActivity: {
      findUnique: async ({ where }) =>
        activities.find(({ id }) => id === where.id) ?? null,
      findUniqueOrThrow: async ({ where }) => {
        const activity = activities.find(({ id }) => id === where.id);
        if (!activity) throw new Error("Activity not found");
        return activity;
      },
      create: async ({ data }) => {
        const activity = activityRow({
          ...data,
          options: data.options ?? null,
        });
        activities.push(activity);
        return activity;
      },
      update: async ({ where, data }) => {
        const activity = activities.find(({ id }) => id === where.id);
        if (!activity) throw new Error("Activity not found");
        Object.assign(activity, data);
        return activity;
      },
      updateMany: async ({ where, data }) => {
        if (
          where.commentNotificationsCompletedAt === null ||
          where.commentNotificationsProcessingAt ||
          where.commentMentionsAttemptedAt === null ||
          where.commentFcmAttemptedAt === null ||
          where.commentEmailsAttemptedAt === null
        ) {
          const activity = activities.find(({ id }) => id === where.id);
          if (
            !activity ||
            (where.commentNotificationsCompletedAt === null &&
              activity.commentNotificationsCompletedAt !== null) ||
            (where.commentMentionsAttemptedAt === null &&
              activity.commentMentionsAttemptedAt !== null) ||
            (where.commentFcmAttemptedAt === null &&
              activity.commentFcmAttemptedAt !== null) ||
            (where.commentEmailsAttemptedAt === null &&
              activity.commentEmailsAttemptedAt !== null)
          ) {
            return { count: 0 };
          }
          if (where.OR) {
            const canClaim = where.OR.some((condition) => {
              const processing = condition.commentNotificationsProcessingAt;
              return processing === null
                ? activity.commentNotificationsProcessingAt === null
                : activity.commentNotificationsProcessingAt <= processing.lte;
            });
            if (!canClaim) {
              if (failure === "lease-release-race") {
                activity.commentNotificationsProcessingAt = null;
              }
              return { count: 0 };
            }
          } else if (
            where.commentNotificationsProcessingAt &&
            activity.commentNotificationsProcessingAt?.getTime() !==
              where.commentNotificationsProcessingAt.getTime()
          ) {
            return { count: 0 };
          }
          if (
            !where.OR &&
            data.commentNotificationsProcessingAt instanceof Date
          ) {
            leaseRenewals += 1;
          }
          if (data.commentNotificationDeliveryKeys?.push) {
            activity.commentNotificationDeliveryKeys.push(
              data.commentNotificationDeliveryKeys.push,
            );
          } else {
            Object.assign(activity, data);
          }
          if (data.commentNotificationsCompletedAt) {
            runCommentCompletionOrder.push("complete");
          }
          return { count: 1 };
        }
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
          id: comments.length + 1,
          createdAt: new Date(),
          ...data,
        };
        comments.push(comment);
        return comment;
      },
      findFirst: async ({ where }) => {
        const linkedActivityId =
          where.OR?.[0]?.agentRunResponseActivity?.is?.id ??
          where.OR?.[1]?.agentRunSelectionActivity?.is?.id;
        const linkedActivity = activities.find(
          ({ id }) => id === linkedActivityId,
        );
        return (
          comments.find(
            (comment) =>
              comment.id === where.id &&
              comment.taskId === where.taskId &&
              comment.creatorId === where.creatorId &&
              (comment.agentId ?? null) === where.agentId &&
              Boolean(linkedActivityId) &&
              (linkedActivity?.responseCommentId === comment.id ||
                linkedActivity?.selectionCommentId === comment.id),
          ) ?? null
        );
      },
    },
    assignees: {
      findMany: async ({ where }) => {
        assigneeLookupCalls += 1;
        return where.agentId === null
          ? commentRecipientUserIds.map((userId) => ({ userId }))
          : [];
      },
    },
  };
  const prisma = {
    ...tx,
    drafts: {
      deleteMany: async ({ where }) => {
        draftDeleteCalls += 1;
        draftDeleteWheres.push(where);
        return { count: 0 };
      },
    },
    follower: { findMany: async () => [] },
    notification: {
      findFirst: async () => null,
      create: async (input) => input,
    },
    subscribedDevices: { findMany: async () => [] },
    user: {
      findFirst: async () => {
        if (failure === "post-commit" || failure === "parallel-race") {
          throw new Error("post-commit side effect failed");
        }
        return { id: 6, displayName: "Valentin" };
      },
      findMany: async ({ where }) =>
        where.id.in.map((id) => ({
          id,
          email: `user-${id}@example.com`,
          displayName: `User ${id}`,
          UserSetting: { notification: true },
        })),
    },
    $transaction: async (callback) => {
      const runSnapshot = { ...run };
      const taskSnapshot = {
        ...task,
        updatedByUserIds: [...task.updatedByUserIds],
      };
      const activityRows = [...activities];
      const activitySnapshots = activityRows.map((activity) => ({ ...activity }));
      const commentCount = comments.length;
      const webhookCount = webhookWrites.length;
      try {
        return await callback(tx);
      } catch (error) {
        Object.assign(run, runSnapshot);
        Object.assign(task, taskSnapshot);
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
    async (...args) => {
      updateTaskCalls.push(args);
      return { status: 200, json: {} };
    },
    async (...args) => {
      taskCommentBroadcasts.push(args);
      runCommentCompletionOrder.push("broadcast");
    },
    async (ids) => {
      publishedAgentWebhookIds.push([...ids]);
      sideEffectOrder.push("agent webhook");
    },
    async (ids) => {
      publishedBoardWebhookIds.push([...ids]);
      sideEffectOrder.push("board webhook");
    },
    async (...args) => {
      fcmCalls.push(args);
      sideEffectOrder.push("fcm");
      if (failure === "fcm-partial") {
        await args[7].markDelivered("device-1");
        throw new Error("FCM handoff failed");
      }
      if (failure === "fcm") throw new Error("FCM handoff failed");
    },
    async (params) => {
      mentionCalls.push(params);
      sideEffectOrder.push("mentions");
      if (failure === "mentions-partial") {
        await params.deliveryProgress.mark("email:user", 7);
        throw new Error("mention handoff failed");
      }
      if (failure === "mentions") {
        throw new Error("mention handoff failed");
      }
      if (failure === "parallel-race") {
        markMentionProcessingStarted();
        await new Promise((resolve) => {
          releaseHeldMention = resolve;
        });
      }
    },
    () => {
      taskReferenceParseCalls += 1;
      return [];
    },
    async (_type, body) => {
      emailCalls.push(body.userId);
      return failure !== "email-partial" || body.userId !== 8;
    },
  );
  return {
    run,
    task,
    elicitation,
    activities,
    comments,
    webhookWrites,
    publishedAgentWebhookIds,
    publishedBoardWebhookIds,
    fcmCalls,
    mentionCalls,
    emailCalls,
    taskCommentBroadcasts,
    runCommentCompletionOrder,
    sideEffectOrder,
    draftDeleteWheres,
    updateTaskCalls,
    getAssigneeLookupCalls: () => assigneeLookupCalls,
    getLeaseRenewals: () => leaseRenewals,
    getDraftDeleteCalls: () => draftDeleteCalls,
    getTaskReferenceParseCalls: () => taskReferenceParseCalls,
    waitForMentionProcessing: () => mentionProcessingStarted,
    releaseMentionProcessing: () => releaseHeldMention(),
    createCommentService,
    setCommentRecipientUserIds: (userIds) => {
      commentRecipientUserIds.splice(0, commentRecipientUserIds.length, ...userIds);
    },
    setFailure: (value) => {
      failure = value;
    },
  };
}

test("activity comments and selection prompts roll back as one transaction", async () => {
  const harness = atomicCommentHarness();
  const originalHeartbeat = harness.run.lastActivityAt;
  const originalTaskUpdatedAt = harness.task.updatedAt;
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

  harness.setFailure("task");
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
    /task update failed/,
  );
  assert.equal(harness.activities.length, 1);
  assert.equal(harness.comments.length, 0);

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
  assert.equal(harness.elicitation.selectionCommentId, null);
  assert.equal(harness.comments.length, 0);
  assert.equal(harness.webhookWrites.length, 0);
  assert.equal(harness.run.lastActivityAt, originalHeartbeat);
  assert.equal(harness.task.totalComments, 0);
  assert.equal(harness.task.updatedAt, originalTaskUpdatedAt);
  assert.equal(harness.updateTaskCalls.length, 0);
});

test("first activity comments broadcast before notification completion", async () => {
  const harness = atomicCommentHarness();
  harness.setFailure(null);

  await harness.createCommentService({
    text: "<p>Yes</p>",
    creatorId: 6,
    taskId: 42,
    ownerId: 6,
    currentUser: { id: 6, displayName: "Valentin" },
    accessUserId: 6,
    agentRunSelection: {
      runId: "run-1",
      agentId: "agent-1",
      activityId: harness.elicitation.id,
      context: { taskId: 42, chatSessionId: null },
      option: { value: "yes", label: "Yes" },
      selectedById: 6,
      selectedAt: new Date("2026-09-04T10:03:00.000Z"),
    },
  });

  assert.deepEqual(harness.taskCommentBroadcasts, [
    [42, { originUserId: 6 }],
  ]);
  assert.deepEqual(harness.runCommentCompletionOrder, [
    "broadcast",
    "complete",
  ]);
  assert.equal(harness.getLeaseRenewals(), 3);
});

test("activity replay rejects a comment linked to another activity", async () => {
  const harness = atomicCommentHarness();
  harness.setFailure(null);
  const input = {
    text: "<p>Yes</p>",
    creatorId: 6,
    taskId: 42,
    ownerId: 6,
    currentUser: { id: 6, displayName: "Valentin" },
    accessUserId: 6,
  };
  await harness.createCommentService({
    ...input,
    agentRunSelection: {
      runId: "run-1",
      agentId: "agent-1",
      activityId: harness.elicitation.id,
      context: { taskId: 42, chatSessionId: null },
      option: { value: "yes", label: "Yes" },
      selectedById: 6,
      selectedAt: new Date("2026-09-04T10:03:00.000Z"),
    },
  });

  await assert.rejects(
    harness.createCommentService({
      ...input,
      agentRunReplayComment: {
        id: harness.comments[0].id,
        activityId: "another-activity",
        agentWebhookDeliveryIds: [],
        boardWebhookDeliveryIds: [],
        notificationsCompletedAt: null,
      },
    }),
    /Run activity comment not found/,
  );
});

test("failed activity mention handoffs remain retryable", async () => {
  const harness = atomicCommentHarness();
  harness.setFailure("mentions");
  const input = {
    text: "<p>Yes</p>",
    creatorId: 6,
    taskId: 42,
    ownerId: 6,
    currentUser: { id: 6, displayName: "Valentin" },
    accessUserId: 6,
  };

  await assert.rejects(
    harness.createCommentService({
      ...input,
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
    /mention handoff failed/,
  );
  assert.equal(harness.elicitation.commentMentionsAttemptedAt, null);
  assert.equal(harness.elicitation.commentNotificationsCompletedAt, null);
  assert.equal(harness.elicitation.commentNotificationsProcessingAt, null);

  harness.setFailure(null);
  await harness.createCommentService({
    ...input,
    text: "<p>Stale replay text</p>",
    agentRunReplayComment: {
      id: harness.comments[0].id,
      activityId: harness.elicitation.id,
      agentWebhookDeliveryIds:
        harness.elicitation.commentAgentWebhookDeliveryIds,
      boardWebhookDeliveryIds:
        harness.elicitation.commentBoardWebhookDeliveryIds,
      notificationsCompletedAt: null,
    },
  });
  assert.ok(harness.elicitation.commentMentionsAttemptedAt instanceof Date);
  assert.ok(
    harness.elicitation.commentNotificationsCompletedAt instanceof Date,
  );
  assert.equal(
    harness.sideEffectOrder.filter((effect) => effect === "mentions").length,
    2,
  );
  assert.equal(harness.mentionCalls[1].text, "<p>Yes</p>");
  assert.equal(harness.comments.length, 1);
});

test("activity retries skip completed mention recipient handoffs", async () => {
  const harness = atomicCommentHarness();
  harness.setFailure("mentions-partial");
  const input = {
    text: "<p>Yes</p>",
    creatorId: 6,
    taskId: 42,
    ownerId: 6,
    currentUser: { id: 6, displayName: "Valentin" },
    accessUserId: 6,
  };

  await assert.rejects(
    harness.createCommentService({
      ...input,
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
    /mention handoff failed/,
  );
  assert.deepEqual(harness.elicitation.commentNotificationDeliveryKeys, [
    "mention:email:user:7",
  ]);

  harness.setFailure(null);
  await harness.createCommentService({
    ...input,
    agentRunReplayComment: {
      id: harness.comments[0].id,
      activityId: harness.elicitation.id,
      agentWebhookDeliveryIds: [],
      boardWebhookDeliveryIds: [],
      notificationsCompletedAt: null,
    },
  });
  assert.equal(
    harness.mentionCalls[1].deliveryProgress.has("email:user", 7),
    true,
  );
  assert.equal(
    harness.elicitation.commentNotificationDeliveryKeys.filter(
      (key) => key === "mention:email:user:7",
    ).length,
    1,
  );
});

test("activity retries skip completed FCM device handoffs", async () => {
  const harness = atomicCommentHarness();
  harness.setFailure("fcm-partial");
  const input = {
    text: "<p>Yes</p>",
    creatorId: 6,
    taskId: 42,
    ownerId: 6,
    currentUser: { id: 6, displayName: "Valentin" },
    accessUserId: 6,
  };

  await assert.rejects(
    harness.createCommentService({
      ...input,
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
    /FCM handoff failed/,
  );
  assert.deepEqual(harness.elicitation.commentNotificationDeliveryKeys, [
    "fcm:device-1",
  ]);

  harness.setFailure(null);
  await harness.createCommentService({
    ...input,
    agentRunReplayComment: {
      id: harness.comments[0].id,
      activityId: harness.elicitation.id,
      agentWebhookDeliveryIds: [],
      boardWebhookDeliveryIds: [],
      notificationsCompletedAt: null,
    },
  });
  assert.equal(harness.fcmCalls[1][7].deliveredDeviceIds.has("device-1"), true);
  assert.equal(
    harness.elicitation.commentNotificationDeliveryKeys.filter(
      (key) => key === "fcm:device-1",
    ).length,
    1,
  );
});

test("activity retries send comment email only to failed recipients", async () => {
  const harness = atomicCommentHarness();
  harness.setCommentRecipientUserIds([7, 8]);
  harness.setFailure("email-partial");
  const input = {
    text: "<p>Yes</p>",
    creatorId: 6,
    taskId: 42,
    ownerId: 6,
    currentUser: { id: 6, displayName: "Valentin" },
    accessUserId: 6,
  };

  await assert.rejects(
    harness.createCommentService({
      ...input,
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
    /Comment email delivery failed/,
  );
  assert.deepEqual(harness.emailCalls, [7, 8]);
  assert.deepEqual(harness.elicitation.commentNotificationDeliveryKeys, [
    "email:7",
  ]);

  harness.setFailure(null);
  await harness.createCommentService({
    ...input,
    agentRunReplayComment: {
      id: harness.comments[0].id,
      activityId: harness.elicitation.id,
      agentWebhookDeliveryIds: [],
      boardWebhookDeliveryIds: [],
      notificationsCompletedAt: null,
    },
  });
  assert.deepEqual(harness.emailCalls, [7, 8, 8]);
  assert.deepEqual(harness.elicitation.commentNotificationDeliveryKeys, [
    "email:7",
    "email:8",
  ]);
});

test("activity notification leases stay claimed until parallel work settles", async () => {
  const harness = atomicCommentHarness();
  harness.setFailure("parallel-race");
  let settled = false;
  const outcome = harness
    .createCommentService({
      text: "<p>Yes</p>",
      creatorId: 6,
      taskId: 42,
      ownerId: 6,
      currentUser: { id: 6, displayName: "Valentin" },
      accessUserId: 6,
      agentRunSelection: {
        runId: "run-1",
        agentId: "agent-1",
        activityId: harness.elicitation.id,
        context: { taskId: 42, chatSessionId: null },
        option: { value: "yes", label: "Yes" },
        selectedById: 6,
        selectedAt: new Date("2026-09-04T10:03:00.000Z"),
      },
    })
    .then(
      () => {
        settled = true;
        return null;
      },
      (error) => {
        settled = true;
        return error;
      },
    );

  await harness.waitForMentionProcessing();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.ok(
    harness.elicitation.commentNotificationsProcessingAt instanceof Date,
  );

  harness.releaseMentionProcessing();
  const error = await outcome;
  assert.match(error.message, /post-commit side effect failed/);
  assert.equal(harness.elicitation.commentNotificationsProcessingAt, null);
});

test("activity comments commit once across replay without consuming drafts", async () => {
  const harness = atomicCommentHarness();
  const originalTaskUpdatedAt = harness.task.updatedAt;
  const commentInput = {
    text: "<p>Yes</p>",
    creatorId: 6,
    taskId: 42,
    ownerId: 6,
    currentUser: { id: 6, displayName: "Valentin" },
    accessUserId: 6,
  };
  harness.setFailure("post-commit");

  await assert.rejects(
    harness.createCommentService({
      ...commentInput,
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
    /post-commit side effect failed/,
  );
  const [comment] = harness.comments;

  assert.equal(harness.elicitation.selectionCommentId, comment.id);
  assert.deepEqual(harness.elicitation.commentAgentWebhookDeliveryIds, [
    "delivery-1",
  ]);
  assert.deepEqual(harness.elicitation.commentBoardWebhookDeliveryIds, []);
  assert.equal(harness.comments.length, 1);
  assert.equal(harness.task.totalComments, 1);
  assert.deepEqual(harness.task.updatedByUserIds, [6]);
  assert.notEqual(harness.task.updatedAt, originalTaskUpdatedAt);
  assert.deepEqual(harness.publishedAgentWebhookIds, []);
  assert.deepEqual(harness.publishedBoardWebhookIds, []);
  assert.deepEqual(harness.sideEffectOrder, ["mentions"]);
  assert.ok(harness.elicitation.commentMentionsAttemptedAt instanceof Date);
  assert.equal(harness.fcmCalls.length, 0);
  assert.equal(harness.taskCommentBroadcasts.length, 0);
  assert.equal(harness.updateTaskCalls.length, 0);
  assert.equal(harness.getDraftDeleteCalls(), 0);
  assert.equal(harness.getTaskReferenceParseCalls(), 1);

  harness.setFailure("lease-release-race");
  harness.elicitation.commentNotificationsProcessingAt = new Date();
  const assigneeLookupsBeforeConcurrentReplay = harness.getAssigneeLookupCalls();
  const draftDeletesBeforeConcurrentReplay = harness.getDraftDeleteCalls();
  const taskReferenceParsesBeforeConcurrentReplay =
    harness.getTaskReferenceParseCalls();
  await assert.rejects(
    harness.createCommentService({
      ...commentInput,
      agentRunReplayComment: {
        id: comment.id,
        activityId: harness.elicitation.id,
        agentWebhookDeliveryIds: ["delivery-1"],
        boardWebhookDeliveryIds: [],
        notificationsCompletedAt: null,
      },
    }),
    model.AgentRunActivityInProgressError,
  );
  assert.equal(harness.fcmCalls.length, 0);
  assert.deepEqual(harness.sideEffectOrder, ["mentions"]);
  assert.equal(
    harness.getAssigneeLookupCalls(),
    assigneeLookupsBeforeConcurrentReplay,
  );
  assert.equal(harness.getDraftDeleteCalls(), draftDeletesBeforeConcurrentReplay);
  assert.equal(
    harness.getTaskReferenceParseCalls(),
    taskReferenceParsesBeforeConcurrentReplay,
  );
  assert.equal(harness.elicitation.commentNotificationsProcessingAt, null);
  assert.equal(harness.taskCommentBroadcasts.length, 0);

  harness.setFailure("fcm");
  await assert.rejects(
    harness.createCommentService({
      ...commentInput,
      agentRunReplayComment: {
        id: comment.id,
        activityId: harness.elicitation.id,
        agentWebhookDeliveryIds: ["delivery-1"],
        boardWebhookDeliveryIds: [],
        notificationsCompletedAt: null,
      },
    }),
    /FCM handoff failed/,
  );
  assert.equal(harness.elicitation.commentFcmAttemptedAt, null);
  assert.equal(harness.elicitation.commentEmailsAttemptedAt, null);
  assert.equal(harness.elicitation.commentNotificationsCompletedAt, null);
  assert.equal(harness.elicitation.commentNotificationsProcessingAt, null);
  assert.equal(harness.fcmCalls.length, 1);
  assert.equal(harness.taskCommentBroadcasts.length, 0);

  harness.setFailure(null);
  const replay = await harness.createCommentService({
    ...commentInput,
    agentRunReplayComment: {
      id: comment.id,
      activityId: harness.elicitation.id,
      agentWebhookDeliveryIds: ["delivery-1"],
      boardWebhookDeliveryIds: [],
      notificationsCompletedAt: null,
    },
  });
  assert.equal(replay.id, comment.id);
  assert.ok(harness.elicitation.commentFcmAttemptedAt instanceof Date);
  assert.ok(harness.elicitation.commentEmailsAttemptedAt instanceof Date);
  assert.ok(
    harness.elicitation.commentNotificationsCompletedAt instanceof Date,
  );
  assert.deepEqual(harness.sideEffectOrder, [
    "mentions",
    "agent webhook",
    "board webhook",
    "fcm",
    "agent webhook",
    "board webhook",
    "fcm",
  ]);
  assert.equal(harness.comments.length, 1);
  assert.equal(harness.task.totalComments, 1);
  assert.deepEqual(harness.publishedAgentWebhookIds, [
    ["delivery-1"],
    ["delivery-1"],
  ]);
  assert.deepEqual(harness.publishedBoardWebhookIds, [[], []]);
  assert.equal(harness.fcmCalls.length, 2);
  assert.deepEqual(harness.taskCommentBroadcasts, [
    [42, { originUserId: 6 }],
  ]);
  assert.deepEqual(harness.runCommentCompletionOrder, ["broadcast", "complete"]);
  assert.equal(
    harness.sideEffectOrder.filter((effect) => effect === "mentions").length,
    1,
  );
  assert.equal(harness.getDraftDeleteCalls(), 0);
  assert.equal(harness.getTaskReferenceParseCalls(), 3);

  harness.setFailure(null);
  await harness.createCommentService({
    ...commentInput,
    agentRunReplayComment: {
      id: comment.id,
      activityId: harness.elicitation.id,
      agentWebhookDeliveryIds: ["delivery-1"],
      boardWebhookDeliveryIds: [],
      notificationsCompletedAt: harness.elicitation.commentNotificationsCompletedAt,
    },
  });
  assert.equal(harness.fcmCalls.length, 2);
  assert.equal(harness.publishedAgentWebhookIds.length, 3);
  assert.equal(harness.getDraftDeleteCalls(), 0);
  assert.equal(harness.getTaskReferenceParseCalls(), 3);
  assert.equal(harness.updateTaskCalls.length, 0);
  assert.equal(harness.taskCommentBroadcasts.length, 1);
});

test("mention processing stops when a delivery checkpoint loses its lease", async () => {
  const followerCalls = [];
  const emailCalls = [];
  const mentionCalls = [];
  stub("src/lib/configs/taskDetail.config.ts", {
    default: { urls: { templates: { mention: () => "" } } },
  });
  stub("src/utils/controllers/comments/mentionRecipients.ts", {
    shouldSkipMentionRecipient: () => false,
  });
  stub("src/utils/helperFunctions/multiPages/multipages.functions.ts", {
    extractTipTapContent: () => ({ mentions: ["7", "8"], agentMentions: [] }),
    stripBlockquoteContent: (text) => text,
  });
  stub("src/utils/controllers/notifications/sendMentionEmail.ts", {
    sendMentionEmail: async (...args) => {
      emailCalls.push(args);
      return true;
    },
  });
  stub("src/lib/prisma.ts", {
    default: {
      task: {
        findUnique: async () => ({ title: "Task", uniqueIndex: 42 }),
      },
      agent: { findUnique: async () => ({ displayName: "Agent" }) },
      user: { findUnique: async () => ({ displayName: "User" }) },
    },
  });
  stub("src/utils/controllers/projects/getProjectMembers.ts", {
    getProjectMembers: async () => ({ members: [] }),
  });
  stub("src/utils/controllers/comments/resolveMentions.ts", {
    injectMentionSpans: (text) => text,
  });
  stub("src/utils/htmlEscape.ts", { escapeHtml: (value) => value });
  stub("src/utils/controllers/followers/createFollowerService.ts", {
    createFollowerService: async (input) => {
      followerCalls.push(input.userId);
      return { status: 201 };
    },
  });
  stub("src/lib/auth/session.ts", {
    SESSION_COOKIE: "session",
    signSession: () => "signed",
  });
  const axiosPath = require.resolve("axios");
  require.cache[axiosPath] = {
    id: axiosPath,
    filename: axiosPath,
    loaded: true,
    exports: {
      default: {
        post: async (...args) => mentionCalls.push(args),
      },
    },
  };
  const processorPath = "src/utils/controllers/comments/processMentions.ts";
  delete require.cache[path.join(root, processorPath)];
  const { processMentionsFromCommentText } = load(processorPath);

  await assert.rejects(
    processMentionsFromCommentText({
      text: "mentions",
      commentId: 1,
      taskId: 42,
      projectId: 15,
      mentionedBy: 6,
      fromAgentId: "agent-1",
      failOnError: true,
      deliveryProgress: {
        has: () => false,
        beforeDelivery: async () => {},
        mark: async () => {
          throw new Error("notification lease lost");
        },
      },
    }),
    /notification lease lost/,
  );
  assert.deepEqual(followerCalls, [7]);
  assert.deepEqual(emailCalls, []);
  assert.deepEqual(mentionCalls, []);
});

test("activity routes expose notification lease contention as retryable", async () => {
  const message = "Run activity comment notifications are still processing";
  stub("src/lib/mcp/auth.ts", { checkMcpRateLimit: async () => null });
  stub("src/lib/agentRuns/service.ts", {
    agentRunActivitiesEnabledFor: async () => true,
    authenticateAgentRunRequest: async (request) => ({
      userId: 6,
      agentId: request.url.endsWith("/select") ? null : "agent-1",
      displayName: "Requester",
      source: request.url.endsWith("/select") ? "browser" : "agent",
    }),
    browserMutationIsSameOrigin: () => true,
    createAgentRunActivity: async () => {
      throw new model.AgentRunActivityInProgressError(message);
    },
    listAgentRunActivities: async () => [],
    selectAgentRunActivity: async () => {
      throw new model.AgentRunActivityInProgressError(message);
    },
  });

  const createRoute = load(
    "src/app/api/mcp/agents/runs/[id]/activities/route.ts",
  );
  const createResponse = await createRoute.POST(
    new Request("http://localhost/api/mcp/agents/runs/run-1/activities", {
      method: "POST",
      body: JSON.stringify({ type: "response", text: "Done" }),
    }),
    { params: Promise.resolve({ id: "run-1" }) },
  );
  assert.equal(createResponse.status, 503);
  assert.equal(createResponse.headers.get("Retry-After"), "1");
  assert.deepEqual(await createResponse.json(), {
    success: false,
    error: message,
    retryable: true,
  });

  const selectRoute = load(
    "src/app/api/mcp/agents/runs/[id]/activities/[activityId]/select/route.ts",
  );
  const selectResponse = await selectRoute.POST(
    new Request(
      "http://localhost/api/mcp/agents/runs/run-1/activities/activity-1/select",
      { method: "POST", body: JSON.stringify({ value: "yes" }) },
    ),
    {
      params: Promise.resolve({ id: "run-1", activityId: "activity-1" }),
    },
  );
  assert.equal(selectResponse.status, 503);
  assert.equal(selectResponse.headers.get("Retry-After"), "1");
  assert.deepEqual(await selectResponse.json(), {
    success: false,
    error: message,
    retryable: true,
  });
});
