// HTPR-6322: a message sent to an agent with no runtime listening is answered
// in the thread instead of being left hanging. The line has to be a system
// notice, not an agent reply, and it must never reach the runtime as if
// someone had said it.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
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
  flag = model.AGENT_CHAT_PARKED_REPLY_FLAG,
  flagEnabled = true,
  deliveryIds = [],
} = {}) {
  const writes = [];
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
        chatMessage: { create: (args) => create("chatMessage", args) },
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
    // Keyed, so a notice gated on the wrong flag fails here instead of
    // passing because some other flag happened to be on.
    isFeatureEnabled: async (key) => (key === flag ? flagEnabled : false),
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
  return { route, writes, broadcasts };
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

test("a message nobody is listening for is answered in the thread", async () => {
  const { route, writes } = loadMessageRoute({ deliveryIds: [] });
  const { response, body } = await send(route);

  assert.equal(response.status, 200);
  assert.equal(body.delivered, false);
  const notices = writes.filter(({ data }) => data.role === "assistant");
  assert.equal(notices.length, 1, "exactly one parked line per unanswered message");
  assert.equal(writes.length, 2, "written inside the same transaction as the human message");
  const [notice] = notices;
  assert.equal(notice.data.role, "assistant");
  assert.equal(notice.data.isDelivered, false);
  assert.equal(notice.data.content, model.AGENT_CHAT_PARKED_MESSAGE);
  assert.equal(notice.data.replyToMessageId, "chatMessage-1");
  assert.doesNotMatch(
    JSON.stringify(notice.data),
    /author(User|Agent)Id/,
    "a system notice is not signed by the agent or by the person who wrote it",
  );
  assert.equal(body.notice.role, "system");
  assert.equal(body.notice.content, model.AGENT_CHAT_PARKED_MESSAGE);
});

test("a message a runtime did receive is left for that runtime to answer", async () => {
  const { route, writes } = loadMessageRoute({ deliveryIds: ["delivery-1"] });
  const { body } = await send(route);

  assert.equal(body.delivered, true);
  assert.equal(body.notice, null);
  assert.equal(writes.length, 1, "only the human message is written");
});

test("with the flag off the thread keeps today's behaviour", async () => {
  const { route, writes } = loadMessageRoute({
    flag: model.AGENT_CHAT_PARKED_REPLY_FLAG,
    flagEnabled: false,
    deliveryIds: [],
  });
  const { body } = await send(route);

  assert.equal(body.delivered, false);
  assert.equal(body.notice, null);
  assert.equal(writes.length, 1);
});

test("the parked line reads as a system notice", () => {
  assert.equal(
    model.isAgentChatSystemMessage({
      role: "assistant",
      isDelivered: false,
      content: model.AGENT_CHAT_PARKED_MESSAGE,
    }),
    true,
    "the browser shows it as a system line, not as the agent's answer",
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
function loadHistoryRoute({ flagEnabled }) {
  const counts = [];
  // Newest first: the route reads descending and flips, like Prisma would.
  const rows = [
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
      findFirst: async () => ({ id: "session-1", agentId: "agent-parked" }),
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
      findUnique: async () => ({ active: false, events: [] }),
    },
  };
  stubModule("src/lib/auth/getSessionUser.ts", {
    getSessionUser: async () => ({ userId: 6 }),
  });
  stubModule("src/lib/flags.ts", {
    AGENT_CHAT_TICKET_CONFIRM_FLAG: "htpr-6006-chat-confirm-ticket",
    isFeatureEnabled: async (key) =>
      key === model.AGENT_CHAT_PARKED_REPLY_FLAG ? flagEnabled : false,
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

async function readHistory(flagEnabled) {
  const { route, counts } = loadHistoryRoute({ flagEnabled });
  const response = await route.GET(
    new Request("https://app.hypertask.ai/api/agent-chat/session-1"),
    { params: Promise.resolve({ sessionId: "session-1" }) },
  );
  return { body: await response.json(), counts };
}

test("a reader inside the rollout sees the parked line", async () => {
  const { body } = await readHistory(true);
  assert.equal(body.success, true);
  assert.deepEqual(
    body.messages.map(({ role }) => role),
    ["human", "system"],
  );
  assert.equal(body.awaiting, false, "the thread is answered, not waiting");
});

test("a reader outside the rollout keeps today's thread", async () => {
  const { body, counts } = await readHistory(false);
  assert.equal(body.success, true);
  assert.deepEqual(
    body.messages.map(({ role }) => role),
    ["human"],
    "the notice is stored in a shared thread, so it is hidden per reader",
  );
  assert.equal(body.awaiting, true, "for them the message is still unanswered");
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
