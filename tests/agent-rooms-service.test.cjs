const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const agents = [
  { id: "product", displayName: "Product Bot", photoURL: null },
  { id: "dev-2", displayName: "Dev 2", photoURL: null },
  { id: "qa-1", displayName: "QA 1", photoURL: null },
];
let parent;
let turnsUsed;
let exchangeTurns;
let createdMessages;
let createdRuns;
let routedDeliveries;
let handledDeliveries;
let pendingDeliveries;

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

function message(data) {
  const authorAgent = agents.find((agent) => agent.id === data.authorAgentId) ?? null;
  return {
    id: `room-message-${createdMessages.length + 1}`,
    createdAt: data.createdAt ?? new Date("2026-09-18T12:00:00.000Z"),
    stoppedAt: null,
    replyToMessageId: data.replyToMessageId ?? null,
    authorUserId: data.authorUserId ?? null,
    authorAgentId: data.authorAgentId ?? null,
    exchangeId: data.exchangeId,
    botTurnDepth: data.botTurnDepth ?? 0,
    role: data.role,
    content: data.content,
    roomId: data.roomId,
    taskId: data.taskId ?? null,
    authorUser: null,
    authorAgent,
    task: data.taskId
      ? { id: data.taskId, ticketNumber: "HTPR-6557", title: "Agent rooms" }
      : null,
  };
}

const tx = {
  $queryRaw: async () => [
    { id: "room-1", projectId: 15, dailyTurnBudget: 50 },
  ],
  agentRoomMessage: {
    findFirst: async ({ where }) =>
      where.id ? { exchangeId: parent.exchangeId } : null,
    count: async ({ where }) =>
      where.exchangeId ? exchangeTurns : turnsUsed,
    create: async ({ data }) => {
      const created = message(data);
      createdMessages.push(created);
      return created;
    },
    updateMany: async () => ({ count: 1 }),
  },
  agentRoomDelivery: {
    findUnique: async () => ({
      id: "delivery-1",
      handledAt: null,
      message: parent,
    }),
    update: async () => {
      handledDeliveries += 1;
    },
    updateMany: async () => {
      const count = pendingDeliveries;
      pendingDeliveries = 0;
      return { count };
    },
    create: async ({ data }) => {
      routedDeliveries.push(data);
      return data;
    },
    createMany: async ({ data }) => {
      routedDeliveries.push(...data);
      return { count: data.length };
    },
  },
  task: {
    findFirst: async () => ({
      id: 41763,
      ticketNumber: "HTPR-6557",
      title: "Agent rooms",
    }),
  },
  member: {
    findFirst: async () => ({ agentId: "product" }),
    findMany: async () => agents.map((agent) => ({ agent })),
  },
  agentRun: {
    create: async ({ data }) => {
      createdRuns.push(data);
      return data;
    },
  },
  agentRoom: { update: async () => null },
};

const prisma = {
  $transaction: async (operation) => operation(tx),
  agentRoomDelivery: {
    updateMany: async () => {
      handledDeliveries += 1;
      return { count: 1 };
    },
  },
};
stubModule("src/lib/prisma.ts", { default: prisma });

const service = createJiti(path.join(root, "tests/agent-rooms-service-entry.cjs"), {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
})(path.join(root, "src/lib/agents/roomService.ts"));

test.beforeEach(() => {
  parent = {
    id: "human-1",
    roomId: "room-1",
    exchangeId: "exchange-1",
    botTurnDepth: 0,
    stoppedAt: null,
    taskId: 41763,
  };
  turnsUsed = 0;
  exchangeTurns = 0;
  createdMessages = [];
  createdRuns = [];
  routedDeliveries = [];
  handledDeliveries = 0;
  pendingDeliveries = 1;
});

test("an agent reply becomes a ticket run note and routes named bots", async () => {
  const result = await service.createAgentRoomReply({
    roomId: "room-1",
    agentId: "product",
    text: "Dev 2, please finish HTPR-6557.",
    replyToMessageId: "human-1",
    now: new Date("2026-09-18T12:00:00.000Z"),
  });

  assert.equal(result.message.botTurnDepth, 1);
  assert.deepEqual(result.routedTo, ["dev-2"]);
  assert.equal(handledDeliveries, 1);
  assert.deepEqual(routedDeliveries, [
    { messageId: "room-message-1", agentId: "dev-2" },
  ]);
  assert.equal(createdRuns.length, 1);
  assert.equal(createdRuns[0].taskId, 41763);
  assert.equal(createdRuns[0].status, "DONE");
  assert.equal(createdRuns[0].activities.create.type, "ACTION");
  assert.equal(
    createdRuns[0].activities.create.text,
    "Dev 2, please finish HTPR-6557.",
  );
});

test("the third bot turn records the reply but does not route a fourth", async () => {
  parent.botTurnDepth = 2;
  exchangeTurns = 2;
  const result = await service.createAgentRoomReply({
    roomId: "room-1",
    agentId: "dev-2",
    text: "QA 1, please take another look.",
    replyToMessageId: "human-1",
  });

  assert.equal(result.message.botTurnDepth, 3);
  assert.equal(result.turnLimitReached, true);
  assert.deepEqual(result.routedTo, []);
  assert.deepEqual(routedDeliveries, []);
  assert.equal(
    createdMessages.at(-1).content,
    service.AGENT_ROOM_TURN_LIMIT_MESSAGE,
  );
});

test("the last daily turn closes pending handoffs and adds a transcript marker", async () => {
  turnsUsed = 49;
  const result = await service.createAgentRoomReply({
    roomId: "room-1",
    agentId: "product",
    text: "Dev 2, continue tomorrow.",
    replyToMessageId: "human-1",
  });

  assert.deepEqual(result.routedTo, []);
  assert.equal(pendingDeliveries, 0);
  assert.equal(
    createdMessages.at(-1).content,
    service.AGENT_ROOM_DAILY_BUDGET_MESSAGE,
  );
});

test("the daily room budget refuses another bot turn before writing", async () => {
  turnsUsed = 50;
  await assert.rejects(
    service.createAgentRoomReply({
      roomId: "room-1",
      agentId: "product",
      text: "Dev 2, continue.",
      replyToMessageId: "human-1",
    }),
    (error) =>
      error instanceof service.AgentRoomError &&
      error.status === 429 &&
      error.message === "Daily room turn budget reached",
  );
  assert.equal(createdMessages.length, 0);
  assert.equal(createdRuns.length, 0);
});

test("a capped room refuses a human message instead of leaving it pending", async () => {
  turnsUsed = 50;
  await assert.rejects(
    service.createHumanAgentRoomMessage({
      roomId: "room-1",
      userId: 42,
      text: "Start another exchange.",
    }),
    (error) =>
      error instanceof service.AgentRoomError &&
      error.status === 429 &&
      error.message === "Daily room turn budget reached",
  );
  assert.equal(createdMessages.length, 0);
  assert.deepEqual(routedDeliveries, []);
});

test("mark handled acknowledges only the addressed agent delivery", async () => {
  assert.equal(
    await service.markAgentRoomMessageHandled({
      messageId: "human-1",
      agentId: "product",
    }),
    true,
  );
  assert.equal(handledDeliveries, 1);
});

test("stop ends a pending turn and records the stop in the transcript", async () => {
  assert.equal(
    await service.stopAgentRoomTurn({
      roomId: "room-1",
      messageId: "human-1",
      now: new Date("2026-09-18T12:01:00.000Z"),
    }),
    true,
  );
  assert.equal(createdMessages.length, 1);
  assert.equal(createdMessages[0].content, service.AGENT_ROOM_STOPPED_MESSAGE);
});

test("stop does not add a marker after delivery is already complete", async () => {
  pendingDeliveries = 0;
  assert.equal(
    await service.stopAgentRoomTurn({
      roomId: "room-1",
      messageId: "human-1",
    }),
    false,
  );
  assert.equal(createdMessages.length, 0);
});
