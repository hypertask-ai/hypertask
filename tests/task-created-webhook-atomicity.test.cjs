const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") }, interopDefault: true,
});

const { createTaskWithBoardWebhookOutbox } = jiti(
  path.join(root, "src/lib/mcp/webhooks/taskEvents.ts"),
);

function transactionHarness({ failOutbox = false } = {}) {
  const committedTasks = [];
  const committedDeliveries = [];

  const db = {
    $transaction: async (callback) => {
      const stagedTasks = [];
      const stagedDeliveries = [];
      const tx = {
        task: {
          create: async ({ data }) => {
            const task = {
              id: 41,
              ticketNumber: "HTPR-41",
              projectId: 15,
              title: data.title,
              status: "Normal",
              dueDate: null,
              startDate: null,
              sectionId: 9,
              priority: null,
            };
            stagedTasks.push(task);
            return task;
          },
          findUnique: async ({ where }) =>
            stagedTasks.find((task) => task.id === where.id) ?? null,
        },
        section: {
          findUnique: async () => ({ id: 9, section_title: "Bugs" }),
        },
        webhookSubscription: {
          findMany: async () => [{ id: "subscription-1" }],
        },
        boardWebhookDelivery: {
          create: async ({ data }) => {
            if (failOutbox) throw new Error("outbox unavailable");
            const delivery = { ...data, id: data.id ?? `delivery-${stagedDeliveries.length + 1}` };
            stagedDeliveries.push(delivery);
            return delivery;
          },
        },
      };

      const result = await callback(tx);
      committedTasks.push(...stagedTasks);
      committedDeliveries.push(...stagedDeliveries);
      return result;
    },
  };

  return { db, committedTasks, committedDeliveries };
}

test("task creation commits with its task.created outbox row", async () => {
  const { db, committedTasks, committedDeliveries } = transactionHarness();

  const created = await createTaskWithBoardWebhookOutbox(
    db,
    { userId: 6, agentId: null },
    async (tx) => {
      const task = await tx.task.create({ data: { title: "Atomic task" } });
      return {
        taskId: task.id,
        result: task,
        webhookTask: {
          id: task.id,
          ticketNumber: task.ticketNumber,
          projectId: task.projectId,
          title: task.title,
          status: task.status,
          dueDate: task.dueDate,
          startDate: task.startDate,
          sectionId: task.sectionId,
          section: "Bugs",
          priority: task.priority,
        },
      };
    },
  );

  assert.equal(committedTasks.length, 1);
  assert.equal(committedDeliveries.length, 1);
  assert.equal(created.result.id, committedTasks[0].id);
  assert.equal(typeof created.boardWebhookDeliveryIds[0], "string");
  assert.notEqual(created.boardWebhookDeliveryIds[0], "");
  assert.deepEqual(created.boardWebhookDeliveryIds, [committedDeliveries[0].id]);
  assert.equal(committedDeliveries[0].event, "task.created");
  assert.deepEqual(committedDeliveries[0].payload.data.actor, { userId: 6, agentId: null });
});

test("task creation rolls back when its outbox row cannot be written", async () => {
  const { db, committedTasks, committedDeliveries } = transactionHarness({
    failOutbox: true,
  });

  await assert.rejects(
    createTaskWithBoardWebhookOutbox(
      db,
      { userId: 6, agentId: "agent-1" },
      async (tx) => {
        const task = await tx.task.create({ data: { title: "Must roll back" } });
        return {
          taskId: task.id,
          result: task,
          webhookTask: {
            id: task.id,
            ticketNumber: task.ticketNumber,
            projectId: task.projectId,
            title: task.title,
            status: task.status,
            dueDate: task.dueDate,
            startDate: task.startDate,
            sectionId: task.sectionId,
            section: "Bugs",
            priority: task.priority,
          },
        };
      },
    ),
    /outbox unavailable/,
  );

  assert.deepEqual(committedTasks, []);
  assert.deepEqual(committedDeliveries, []);
});

test("an escalation comment rolls back when task.escalated cannot persist", async () => {
  const committedComments = [];
  const committedDeliveries = [];
  const task = {
    id: 41,
    ticketNumber: "HTPR-41",
    projectId: 15,
    title: "Atomic task",
    userId: 6,
    waitingOnUserId: null,
    updatedByUserIds: [],
    uniqueIndex: 41,
    project: { team: {}, owner: { devices: [] } },
  };
  const db = {
    task: { findFirst: async () => task },
    comment: { findFirst: async () => null },
    $transaction: async (callback) => {
      const stagedComments = [];
      const stagedDeliveries = [];
      const tx = {
        $queryRaw: async () => [{ id: task.id }],
        task: { findFirst: async () => task },
        comment: {
          create: async ({ data }) => {
            const comment = { id: 51, createdAt: new Date(0), ...data };
            stagedComments.push(comment);
            return comment;
          },
        },
        webhookSubscription: { findMany: async () => [{ id: "subscription-1" }] },
        boardWebhookDelivery: {
          create: async ({ data }) => {
            if (data.event === "task.escalated") {
              throw new Error("escalation outbox unavailable");
            }
            stagedDeliveries.push(data);
            return data;
          },
        },
      };

      const result = await callback(tx);
      committedComments.push(...stagedComments);
      committedDeliveries.push(...stagedDeliveries);
      return result;
    },
  };

  const stubbedPaths = [
    "src/lib/prisma.ts",
    "src/utils/controllers/FCM/index.ts",
    "src/utils/controllers/comments/processMentions.ts",
    "src/utils/controllers/tasks/single.ts",
    "src/utils/controllers/comments/createCommentService.ts",
  ];
  const originalCache = new Map(Object.entries(require.cache));
  const stubModule = (relativePath, exports) => {
    const filename = path.join(root, relativePath);
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
  };

  try {
    for (const relativePath of stubbedPaths) delete require.cache[path.join(root, relativePath)];
    stubModule("src/lib/prisma.ts", { default: db });
    stubModule("src/utils/controllers/FCM/index.ts", { sendDataOnlyFcm: () => undefined });
    stubModule("src/utils/controllers/comments/processMentions.ts", {
      getMentionedAgentIdsFromCommentText: () => [],
      getMentionedUserIdsFromCommentText: () => [],
      processMentionsFromCommentText: async () => undefined,
    });
    stubModule("src/utils/controllers/tasks/single.ts", { updateTaskSingle: async () => task });
    const serviceJiti = createJiti(
      path.join(root, "tests/task-created-webhook-atomicity-service.cjs"),
      { alias: { "@": path.join(root, "src") }, cache: false, interopDefault: true },
    );
    const { createCommentService } = serviceJiti(
      path.join(root, "src/utils/controllers/comments/createCommentService.ts"),
    );

    await assert.rejects(
      createCommentService({
        text: "Blocked on infrastructure",
        creatorId: 6,
        taskId: task.id,
        ownerId: 6,
        currentUser: { id: 6, displayName: "Bug Dev" },
        processTaskReferences: false,
        trustedCaller: true,
        extraBoardWebhookEvents: [
          {
            event: "task.escalated",
            data: {
              task: {
                id: task.id, ticketNumber: task.ticketNumber,
                projectId: task.projectId, title: task.title,
              },
              reason: "Blocked on infrastructure",
              actor: { userId: 6, agentId: null },
            },
          },
        ],
      }),
      /escalation outbox unavailable/,
    );
  } finally {
    for (const filename of Object.keys(require.cache)) {
      if (!originalCache.has(filename)) delete require.cache[filename];
    }
    for (const [filename, cachedModule] of originalCache) require.cache[filename] = cachedModule;
  }

  assert.deepEqual(committedComments, []);
  assert.deepEqual(committedDeliveries, []);
});
