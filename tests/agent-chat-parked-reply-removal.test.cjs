// Retired parked replies must stay absent while legacy stored notices stay hidden.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { createJiti } = require("jiti");

process.env.NEXT_PUBLIC_BASEURL = "https://app.hypertask.ai";

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(
  path.join(root, "tests/agent-chat-parked-reply-entry.cjs"),
  { interopDefault: true, alias: { "@": path.join(root, "src") } },
);
const model = jiti(path.join(root, "src/lib/agentRuns/model.ts"));

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

// One database stub for the whole file: each route hands the proxy its own
// tables by setting `db`. Re-stubbing the module per test does not reach a
// route that an earlier jiti instance already resolved.
let db = null;
stubModule("src/lib/prisma.ts", {
  default: new Proxy({}, { get: (_target, key) => db[key] }),
});

let routeLoad = 0;

/**
 * Load the send route with a database that records every write. `deliveryIds`
 * is what the webhook outbox hands back: an empty list is the parked agent.
 */
function loadMessageRoute({
  deliveryIds = [],
  heartbeatAt = null,
  activeWebhook = false,
  pollingEnabled = true,
} = {}) {
  const writes = [];
  const updates = [];
  const broadcasts = [];
  let sequence = 0;
  const create = async (model, { data }) => {
    const row = {
      id: `${model}-${++sequence}`,
      ...data,
      createdAt: new Date("2026-09-09T10:00:00Z"),
    };
    writes.push({ model, data });
    return row;
  };
  const prisma = {
    chatSession: {
      findFirst: async () => ({
        id: "session-1",
        userId: 6,
        agentId: "agent-parked",
        agent: { runtimeType: "EXTERNAL" },
      }),
    },
    user: { findUnique: async () => ({ displayName: "Valentin" }) },
    member_Team: { findMany: async () => [] },
    chatSessionParticipant: {
      upsert: async () => ({ draft: null, lastReadAt: null, joinedAt: new Date() }),
    },
    $transaction: async (operation) =>
      operation({
        $queryRaw: async () => [{ heartbeatAt }],
        agentWebhookSubscription: {
          findUnique: async () => (activeWebhook ? { active: true } : null),
        },
        chatMessage: {
          create: (args) => create("chatMessage", args),
          update: async (args) => {
            updates.push(args);
            return {};
          },
        },
        chatSession: { update: async () => ({}) },
        chatSessionParticipant: { updateMany: async () => ({ count: 1 }) },
      }),
  };

  db = prisma;
  stubModule("src/lib/auth/getSessionUser.ts", {
    getSessionUser: async () => ({ userId: 6 }),
  });
  stubModule("src/lib/agentWebhooks/outbox.ts", {
    persistAgentRunTriggerWebhooks: async () => deliveryIds,
    publishAgentWebhookDeliveries: async () => {},
  });
  stubModule("src/lib/agents/visibility.ts", {
    accessibleAgentWhere: () => ({}),
  });
  stubModule("src/lib/agents/chatBroadcast.ts", {
    broadcastChatSession: async (sessionId, alsoUserIds) =>
      broadcasts.push({ sessionId, alsoUserIds }),
  });
  stubModule("src/lib/realtime/server.ts", {
    AGENT_CHAT_EVENT: "agent-chat",
    broadcast: async () => {},
    userChannel: (userId) => `user-${userId}`,
  });
  stubModule("src/lib/flags.ts", {
    AGENT_CHAT_BRIEF_FLAG: "htpr-6155-chat-agent-brief",
    isFeatureEnabled: async (key) => {
      if (key === "htpr-6553-agent-chat-polling") return pollingEnabled;
      assert.notEqual(key, "htpr-6322-agent-chat-parked-reply");
      return false;
    },
  });
  stubModule("src/lib/agents/chatBrief.ts", {
    buildAgentChatBrief: async () => null,
  });

  const routePath = path.join(
    root,
    "src/app/api/agent-chat/[sessionId]/messages/route.ts",
  );
  delete require.cache[routePath];
  const route = createJiti(
    path.join(root, `tests/agent-chat-parked-reply-route-${++routeLoad}.cjs`),
    { alias: { "@": path.join(root, "src") }, interopDefault: true },
  )(routePath);
  return { route, writes, updates, broadcasts };
}

async function send(route, text = "are you there?") {
  const response = await route.POST(
    new Request("https://app.hypertask.ai/api/agent-chat/session-1/messages", {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
    { params: Promise.resolve({ sessionId: "session-1" }) },
  );
  return { response, body: await response.json() };
}

test("a message with no connected runtime stays unanswered", async () => {
  const { route, writes, updates, broadcasts } = loadMessageRoute();
  const { response, body } = await send(route);

  assert.equal(response.status, 200);
  assert.equal(body.delivered, false);
  assert.equal(body.notice, null);
  assert.equal(writes.length, 1, "only the human turn is stored");
  assert.equal(writes[0].data.role, "human");
  assert.equal(writes[0].data.isDelivered, true);
  assert.equal(writes[0].data.content, "are you there?");
  assert.equal(writes[0].data.replyToMessageId, undefined);
  assert.deepEqual(updates, []);
  assert.deepEqual(broadcasts, [{ sessionId: "session-1", alsoUserIds: [6] }]);
});

test("a webhook runtime keeps the existing delivery path", async () => {
  const { route, writes, updates } = loadMessageRoute({
    deliveryIds: ["delivery-1"],
    activeWebhook: true,
    heartbeatAt: new Date(),
  });
  const { body } = await send(route);

  assert.equal(body.delivered, true);
  assert.equal(body.notice, null);
  assert.equal(writes.length, 1, "only the human message is written");
  assert.equal(updates.length, 0, "webhook messages remain delivered at creation");
});

test("a fresh polling runtime queues an undelivered message without a parked notice", async () => {
  const { route, writes, updates } = loadMessageRoute({ heartbeatAt: new Date() });
  const { body } = await send(route);

  assert.equal(body.delivered, true);
  assert.equal(body.notice, null);
  assert.equal(writes.length, 1, "only the human message is written");
  assert.deepEqual(updates, [
    {
      where: { id: "chatMessage-1" },
      data: { isDelivered: false },
    },
  ]);
});

test("an expired heartbeat does not queue a message or post a reply", async () => {
  const { route, writes, updates } = loadMessageRoute({
    heartbeatAt: new Date(Date.now() - 2 * 60 * 1000),
  });
  const { body } = await send(route);
  assert.equal(body.delivered, false);
  assert.equal(body.notice, null);
  assert.equal(writes.length, 1);
  assert.deepEqual(updates, []);
});

test("legacy parked rows remain recognized for runtime exclusion", () => {
  assert.equal(
    model.isAgentChatSystemMessage({
      role: "assistant",
      isDelivered: false,
      content: model.AGENT_CHAT_PARKED_MESSAGE,
    }),
    true,
    "the runtime recognizes it as a system row to exclude",
  );
});

/** The runtime's own read of the thread, with the query it builds recorded. */
function loadTranscriptRoute() {
  const queries = [];
  const prisma = {
    chatSession: {
      findFirst: async () => ({
        id: "session-1",
        agentId: "agent-parked",
        userId: 6,
        user: { displayName: "Valentin" },
      }),
    },
    chatMessage: {
      findMany: async (args) => {
        queries.push(args);
        return [
          {
            id: "chatMessage-1",
            role: "human",
            content: "are you there?",
            createdAt: new Date("2026-09-09T10:00:00Z"),
          },
        ];
      },
    },
  };
  db = prisma;
  stubModule("src/lib/mcp/auth.ts", {
    validateMcpAuth: async () => ({
      agentId: "agent-parked",
      user: { id: 6, displayName: "Valentin" },
    }),
    checkMcpRateLimit: async () => null,
  });
  stubModule("src/lib/flags.ts", {
    AGENT_CHAT_TICKET_CONFIRM_FLAG: "htpr-6006-chat-confirm-ticket",
    isFeatureEnabled: async () => false,
  });
  stubModule("src/lib/agents/agentChatActivity.ts", {
    listAgentChatActivity: async () => [],
  });
  stubModule("src/lib/agents/chatActivityFeed.ts", {
    activityContextMessages: () => [],
    asksForAgentActivity: () => false,
  });
  stubModule("src/lib/agents/chatTicketProposal.ts", {
    chatTicketProposalSelect: {},
    serializeChatTicketProposal: () => null,
  });
  stubModule("src/lib/agents/visibility.ts", {
    accessibleAgentWhere: () => ({}),
  });
  stubModule("src/lib/realtime/server.ts", {
    AGENT_CHAT_EVENT: "agent-chat",
    broadcast: async () => {},
    userChannel: (userId) => `user-${userId}`,
  });

  const routePath = path.join(
    root,
    "src/app/api/mcp/chat/sessions/[sessionId]/messages/route.ts",
  );
  delete require.cache[routePath];
  const route = createJiti(
    path.join(root, `tests/agent-chat-parked-reply-mcp-${++routeLoad}.cjs`),
    { alias: { "@": path.join(root, "src") }, interopDefault: true },
  )(routePath);
  return { route, queries };
}

test("the runtime's own transcript never carries the parked line", async () => {
  const { route, queries } = loadTranscriptRoute();
  const response = await route.GET(
    new Request(
      "https://app.hypertask.ai/api/mcp/chat/sessions/session-1/messages",
    ),
    { params: Promise.resolve({ sessionId: "session-1" }) },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(queries.length, 1, "the transcript is read once");
  const excluded = queries[0].where.NOT?.content?.in ?? [];
  for (const content of model.AGENT_CHAT_SYSTEM_MESSAGES) {
    assert.ok(
      excluded.includes(content),
      `a reconnecting runtime must not read "${content}" as something said to it`,
    );
  }
});

/**
 * The browser's read of the thread. Two rows are stored: the human message
 * and, after it, the parked notice the send path wrote.
 */
function loadHistoryRoute({
  heartbeatAt = null,
  subscription = { active: false, events: [] },
  pollingEnabled = true,
  extraRows = [],
} = {}) {
  const counts = [];
  // Newest first: the route reads descending and flips, like Prisma would.
  const rows = [
    ...extraRows,
    {
      id: "chatMessage-2",
      role: "assistant",
      content: model.AGENT_CHAT_PARKED_MESSAGE,
      isDelivered: false,
      createdAt: new Date("2026-09-09T10:00:01Z"),
    },
    {
      id: "chatMessage-1",
      role: "human",
      content: "are you there?",
      isDelivered: true,
      createdAt: new Date("2026-09-09T10:00:00Z"),
    },
  ];
  db = {
    chatSession: {
      findFirst: async () => ({
        id: "session-1",
        agentId: "agent-parked",
        // chatAccess evaluates the shared-chat flag against the agent owner.
        agent: { userId: 6, heartbeatAt },
      }),
    },
    chatMessage: {
      findMany: async () => rows,
      count: async (args) => {
        counts.push(args);
        return 0;
      },
    },
    member_Team: { findMany: async () => [] },
    chatSessionParticipant: {
      upsert: async () => ({
        draft: null,
        lastReadAt: null,
        joinedAt: new Date("2026-09-09T10:00:00Z"),
      }),
      findMany: async () => [],
    },
    agentWebhookSubscription: {
      findUnique: async () => subscription,
    },
  };
  stubModule("src/lib/auth/getSessionUser.ts", {
    getSessionUser: async () => ({ userId: 6 }),
  });
  stubModule("src/lib/flags.ts", {
    AGENT_CHAT_TICKET_CONFIRM_FLAG: "htpr-6006-chat-confirm-ticket",
    SHARED_AGENT_CHAT_FLAG: "htpr-6002-shared-agent-chat",
    isFeatureEnabled: async (key) => {
      if (key === "htpr-6002-shared-agent-chat") return true;
      if (key === "htpr-6553-agent-chat-polling") return pollingEnabled;
      assert.notEqual(key, "htpr-6322-agent-chat-parked-reply");
      return false;
    },
  });
  stubModule("src/lib/agents/agentChatActivity.ts", {
    listAgentChatActivity: async () => [],
  });
  stubModule("src/lib/agents/chatTicketProposal.ts", {
    chatTicketProposalSelect: {},
    serializeChatTicketProposal: () => null,
  });
  stubModule("src/lib/agentRuns/service.ts", {
    readAgentChatTurn: async () => null,
  });
  stubModule("src/lib/agents/visibility.ts", {
    accessibleAgentWhere: () => ({}),
  });

  const routePath = path.join(root, "src/app/api/agent-chat/[sessionId]/route.ts");
  delete require.cache[routePath];
  const route = createJiti(
    path.join(root, `tests/agent-chat-parked-reply-get-${++routeLoad}.cjs`),
    { alias: { "@": path.join(root, "src") }, interopDefault: true },
  )(routePath);
  return { route, counts };
}

async function readHistory(availability = {}) {
  const { route, counts } = loadHistoryRoute(availability);
  const response = await route.GET(
    new Request("https://app.hypertask.ai/api/agent-chat/session-1"),
    { params: Promise.resolve({ sessionId: "session-1" }) },
  );
  return { body: await response.json(), counts };
}

test("the page reports a fresh heartbeat as polling chat", async () => {
  const { body } = await readHistory({ heartbeatAt: new Date() });

  assert.equal(body.chatEnabled, true);
  assert.equal(body.deliveryMode, "polling");
});

test("the page expires polling chat after two minutes", async () => {
  const { body } = await readHistory({
    heartbeatAt: new Date(Date.now() - 2 * 60 * 1000),
  });

  assert.equal(body.chatEnabled, false);
  assert.equal(body.deliveryMode, null);
});

test("the page keeps webhook chat ahead of a fresh heartbeat", async () => {
  const { body } = await readHistory({
    heartbeatAt: new Date(),
    subscription: { active: true, events: ["chat.message"] },
  });

  assert.equal(body.chatEnabled, true);
  assert.equal(body.deliveryMode, "webhook");
});

test("stored parked notices are hidden and excluded from unread for everyone", async () => {
  const { body, counts } = await readHistory();
  assert.equal(body.success, true);
  assert.deepEqual(
    body.messages.map(({ role }) => role),
    ["human"],
    "legacy notices never appear in the returned transcript",
  );
  assert.equal(body.awaiting, true, "the message remains unanswered");
  assert.deepEqual(
    counts[0].where.NOT,
    {
      role: "assistant",
      isDelivered: false,
      content: model.AGENT_CHAT_PARKED_MESSAGE,
    },
    "a hidden row must not bump their unread count either",
  );
});


test("notice matching does not hide quoted human text, delivered replies, or other system notices", async () => {
  const { body } = await readHistory({
    extraRows: [
      { id: "delivered", role: "assistant", isDelivered: true, content: model.AGENT_CHAT_PARKED_MESSAGE },
      { id: "quote", role: "human", isDelivered: true, content: model.AGENT_CHAT_PARKED_MESSAGE },
      { id: "timeout", role: "assistant", isDelivered: false, content: model.AGENT_CHAT_TIMEOUT_MESSAGE },
    ],
  });
  assert.equal(body.success, true);
  assert.deepEqual(body.messages.map(({ id }) => id), ["chatMessage-1", "timeout", "quote", "delivered"]);
  assert.deepEqual(body.messages.map(({ role }) => role), ["human", "system", "human", "assistant"]);
});

test("the flag and its constant are removed from the registry and runtime code", () => {
  const retired = /htpr-6322-agent-chat-parked-reply|AGENT_CHAT_PARKED_REPLY_FLAG/;
  assert.throws(() => assert.doesNotMatch("AGENT_CHAT_PARKED_REPLY_FLAG", retired), "positive control catches a retained reference");
  for (const file of [
    "src/lib/agentRuns/model.ts",
    "src/app/api/agent-chat/[sessionId]/route.ts",
    "src/app/api/agent-chat/[sessionId]/messages/route.ts",
  ]) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), "utf8"), retired, file);
  }
  assert.equal(model.AGENT_CHAT_PARKED_REPLY_FLAG, undefined);
});

test("the flag stays retired, not deleted, so older deployments keep reading it as Off", () => {
  const flags = fs.readFileSync(path.join(root, "src/lib/flags.ts"), "utf8");
  const retiredSet = flags.match(/RETIRED_FEATURE_FLAG_KEYS = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(retiredSet, "RETIRED_FEATURE_FLAG_KEYS exists");
  assert.match(retiredSet[1], /"htpr-6322-agent-chat-parked-reply"/);
  const outside = flags.replace(retiredSet[0], "");
  assert.doesNotMatch(outside, /htpr-6322-agent-chat-parked-reply|AGENT_CHAT_PARKED_REPLY_FLAG/);
  const migrations = path.join(root, "src/prisma/migrations");
  for (const dir of fs.readdirSync(migrations)) {
    const file = path.join(migrations, dir, "migration.sql");
    if (fs.existsSync(file)) assert.doesNotMatch(fs.readFileSync(file, "utf8"), /htpr-6322-agent-chat-parked-reply/, dir);
  }
});
