// HTPR-6322: a message sent to an agent with no runtime listening is answered
// in the thread instead of being left hanging. The line has to be a system
// notice, not an agent reply, and it must never reach the runtime as if
// someone had said it.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
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

let routeLoad = 0;

/**
 * Load the send route with a database that records every write. `deliveryIds`
 * is what the webhook outbox hands back: an empty list is the parked agent.
 */
function loadMessageRoute({ flagEnabled = true, deliveryIds = [] } = {}) {
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

  stubModule("src/lib/prisma.ts", { default: prisma });
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
    isFeatureEnabled: async () => flagEnabled,
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
    flagEnabled: false,
    deliveryIds: [],
  });
  const { body } = await send(route);

  assert.equal(body.delivered, false);
  assert.equal(body.notice, null);
  assert.equal(writes.length, 1);
});

test("the parked line reads as a system notice, and the runtime never sees it", () => {
  assert.equal(
    model.isAgentChatSystemMessage({
      role: "assistant",
      isDelivered: false,
      content: model.AGENT_CHAT_PARKED_MESSAGE,
    }),
    true,
    "the browser shows it as a system line, not as the agent's answer",
  );
  const transcript = fs.readFileSync(
    path.join(
      root,
      "src/app/api/mcp/chat/sessions/[sessionId]/messages/route.ts",
    ),
    "utf8",
  );
  assert.match(
    transcript,
    /content: \{ in: \[\.\.\.AGENT_CHAT_SYSTEM_MESSAGES\] \}/,
    "a reconnecting runtime must not read the parked line as something said to it",
  );
});
