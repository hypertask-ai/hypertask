const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

process.env.NEXT_PUBLIC_BASEURL = "https://app.hypertask.ai";

const root = path.resolve(__dirname, "..");
let authContext;
let activeWebhook;
let pendingRows;
let replies;
let rawQueries;

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

function sqlText(args) {
  return Array.isArray(args[0]) ? args[0].join("?") : String(args[0]);
}

const chatMessage = {
  findMany: async () =>
    pendingRows.map((row) => ({
      id: row.id,
      role: "human",
      content: row.text,
      createdAt: new Date("2026-09-17T12:00:00.000Z"),
    })),
  findFirst: async ({ where }) => {
    const row = pendingRows.find(
      (candidate) => candidate.id === where.id && candidate.sessionId === where.sessionId,
    );
    return row ? { id: row.id } : null;
  },
  findUnique: async ({ where }) =>
    replies.find((reply) => reply.replyToMessageId === where.replyToMessageId) ?? null,
  create: async ({ data }) => {
    const reply = {
      id: `reply-${replies.length + 1}`,
      ...data,
      createdAt: new Date("2026-09-17T12:00:04.000Z"),
    };
    replies.push(reply);
    return reply;
  },
};

const tx = {
  $queryRaw: async (...args) => {
    const sql = sqlText(args);
    rawQueries.push(sql);
    if (/FROM "Agent"/.test(sql)) return [{ id: "agent-polling" }];
    if (/WITH pending AS/.test(sql)) {
      const claimed = pendingRows.filter((row) => !row.isDelivered).slice(0, 50);
      claimed.forEach((row) => {
        row.isDelivered = true;
      });
      return claimed.map(({ id, sessionId, text, userName }) => ({
        id,
        sessionId,
        text,
        userName,
      }));
    }
    return [];
  },
  agentWebhookSubscription: {
    findUnique: async () => (activeWebhook ? { active: true } : null),
  },
  chatSession: { update: async () => null },
  chatMessage,
  agentRun: { findFirst: async () => null },
};

const prisma = {
  $transaction: async (operation) => operation(tx),
  chatMessage,
};

stubModule("src/lib/prisma.ts", { default: prisma });
stubModule("src/lib/mcp/auth.ts", {
  checkMcpRateLimit: async () => null,
  validateMcpAuth: async () => authContext,
});
stubModule("src/lib/agents/chatAccess.ts", {
  loadAgentTokenChatSession: async ({ sessionId, agentId }) =>
    sessionId === "session-1" && agentId === "agent-polling"
      ? {
          ok: true,
          agentId,
          session: {
            id: sessionId,
            agentId,
            userId: 6,
            user: { displayName: "Valentin" },
          },
        }
      : { ok: false, status: 404, error: "Session not found" },
});
stubModule("src/lib/flags.ts", {
  AGENT_CHAT_TICKET_CONFIRM_FLAG: "htpr-6006-chat-confirm-ticket",
  isFeatureEnabled: async (key) => key === "htpr-6154-chat-stop-and-timeout",
});
stubModule("src/lib/agents/chatBroadcast.ts", {
  broadcastChatSession: async () => null,
});
stubModule("src/lib/agents/agentChatActivity.ts", {
  listAgentChatActivity: async () => [],
});
stubModule("src/lib/agents/chatActivityFeed.ts", {
  activityContextMessages: () => [],
  asksForAgentActivity: () => false,
});
stubModule("src/lib/mcp/agents/scopes.ts", {
  requireRole: async () => null,
});
stubModule("src/lib/mcp/tasks/services.ts", {
  getSectionForTask: async () => ({ error: null }),
  validateProjectAccess: async () => ({ error: null }),
});
stubModule("src/lib/agents/chatTicketProposal.ts", {
  chatTicketProposalSelect: {},
  parseChatTicketProposal: () => ({ proposal: null, error: null }),
  serializeChatTicketProposal: () => null,
});

const load = (relativePath, entry) =>
  createJiti(path.join(root, `tests/${entry}.cjs`), {
    alias: { "@": path.join(root, "src") },
    interopDefault: true,
  })(path.join(root, relativePath));

const pendingRoute = load(
  "src/app/api/mcp/chat/pending/route.ts",
  "agent-chat-pending-route-entry",
);
const replyRoute = load(
  "src/app/api/mcp/chat/sessions/[sessionId]/messages/route.ts",
  "agent-chat-pending-reply-entry",
);

const request = () =>
  new Request("https://app.hypertask.ai/api/mcp/chat/pending", {
    headers: { authorization: "Bearer agent-token" },
  });

async function fetchPending() {
  const response = await pendingRoute.GET(request());
  return { response, body: await response.json() };
}

async function postReply(agentId = "agent-polling") {
  authContext = {
    agentId,
    user: { id: 6, displayName: "Valentin" },
  };
  const response = await replyRoute.POST(
    new Request(
      "https://app.hypertask.ai/api/mcp/chat/sessions/session-1/messages",
      {
        method: "POST",
        body: JSON.stringify({
          text: "Yes, I am here.",
          replyToMessageId: "message-1",
        }),
      },
    ),
    { params: Promise.resolve({ sessionId: "session-1" }) },
  );
  return { response, body: await response.json() };
}

test.beforeEach(() => {
  authContext = {
    agentId: "agent-polling",
    user: { id: 6, displayName: "Valentin" },
  };
  activeWebhook = false;
  pendingRows = [
    {
      id: "message-1",
      sessionId: "session-1",
      text: "Are you there?",
      userName: "Valentin",
      isDelivered: false,
    },
  ];
  replies = [];
  rawQueries = [];
});

test("pending returns the daemon payload and marks each message delivered", async () => {
  const { response, body } = await fetchPending();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    success: true,
    messages: [
      {
        id: "message-1",
        sessionId: "session-1",
        text: "Are you there?",
        userName: "Valentin",
      },
    ],
  });
  assert.equal(pendingRows[0].isDelivered, true);
  assert.match(rawQueries.join("\n"), /FOR UPDATE OF message SKIP LOCKED/);
  assert.match(rawQueries.join("\n"), /SET "isDelivered" = true/);

  const second = await fetchPending();
  assert.deepEqual(second.body.messages, []);
});

test("the fetching agent can reply after pending marks the message delivered", async () => {
  await fetchPending();
  assert.equal(pendingRows[0].isDelivered, true);

  const { response, body } = await postReply();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].replyToMessageId, "message-1");
  assert.equal(replies[0].authorAgentId, "agent-polling");
});

test("the owning agent can reply while the message is still pending", async () => {
  assert.equal(pendingRows[0].isDelivered, false);

  const { response, body } = await postReply();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].authorAgentId, "agent-polling");
});

test("a different agent cannot reply to the pending message", async () => {
  const { response, body } = await postReply("agent-other");

  assert.equal(response.status, 404);
  assert.equal(body.success, false);
  assert.equal(replies.length, 0);
});

test("failed and cancelled turns remain terminal", async () => {
  for (const content of ["Agent did not answer, try again", "Run stopped"]) {
    replies = [{
      id: `terminal-${replies.length + 1}`,
      sessionId: "session-1",
      role: "assistant",
      content,
      isDelivered: false,
      replyToMessageId: "message-1",
      createdAt: new Date(),
    }];

    const { response, body } = await postReply();

    assert.equal(response.status, 409);
    assert.equal(body.success, false);
    assert.match(body.error, /no longer active/);
    assert.equal(replies.length, 1);
  }
});

test("a replied turn returns the stored reply without creating another", async () => {
  replies = [{
    id: "reply-existing",
    sessionId: "session-1",
    role: "assistant",
    content: "Already answered",
    isDelivered: true,
    replyToMessageId: "message-1",
    authorAgentId: "agent-polling",
    createdAt: new Date(),
  }];

  const { response, body } = await postReply();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.duplicate, true);
  assert.equal(replies.length, 1);
});

test("an active webhook agent remains on the webhook path", async () => {
  activeWebhook = true;

  const { body } = await fetchPending();

  assert.deepEqual(body, { success: true, messages: [] });
  assert.equal(pendingRows[0].isDelivered, false);
  assert.equal(rawQueries.some((sql) => /WITH pending AS/.test(sql)), false);
});

test("pending rejects a user token", async () => {
  authContext = { agentId: null, user: { id: 6, displayName: "Valentin" } };

  const { response, body } = await fetchPending();

  assert.equal(response.status, 403);
  assert.equal(body.success, false);
  assert.match(body.error, /agent token/i);
});
