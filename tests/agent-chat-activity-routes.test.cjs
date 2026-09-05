const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const chatClientSource = fs.readFileSync(
  path.join(root, "src/app/agents/chat/AgentChatClient.tsx"),
  "utf8",
);
let loadId = 0;
let flagEnabled = true;
let activityCalls = [];
let activityRows = [];
let messageRows = [];

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
    path.join(root, `tests/agent-chat-activity-routes-${++loadId}.cjs`),
    { alias: { "@": path.join(root, "src") }, interopDefault: true },
  )(path.join(root, relativePath));
}

const prisma = {
  chatSession: {
    findFirst: async ({ select }) => ({
      id: "session-1",
      agentId: "agent-1",
      userId: 6,
      ...(select.user ? { user: { displayName: "Valentin" } } : {}),
    }),
  },
  chatMessage: {
    findMany: async () => messageRows,
  },
  agentWebhookSubscription: {
    findUnique: async () => ({ active: true, events: ["chat.message"] }),
  },
};

stub("src/lib/prisma.ts", { default: prisma });
stub("src/lib/auth/getSessionUser.ts", {
  getSessionUser: async () => ({ userId: 6 }),
});
stub("src/lib/agents/visibility.ts", { accessibleAgentWhere: () => ({}) });
stub("src/lib/flags.ts", {
  AGENT_CHAT_TICKET_CONFIRM_FLAG: "htpr-6006-chat-confirm-ticket",
  isFeatureEnabled: async (key, userId) => {
    assert.equal(userId, 6);
    // The history route also reads the ticket-confirmation flag; only the
    // activity flag is under test here.
    if (key === "htpr-6006-chat-confirm-ticket") return false;
    assert.equal(key, "htpr-6094-agent-activity-rows");
    return flagEnabled;
  },
});
stub("src/lib/agents/agentChatActivity.ts", {
  listAgentChatActivity: async (input) => {
    activityCalls.push(input);
    return activityRows;
  },
});
stub("src/lib/mcp/auth.ts", {
  checkMcpRateLimit: async () => null,
  validateMcpAuth: async () => ({
    agentId: "agent-1",
    user: { id: 6, displayName: "Agent" },
  }),
});
stub("src/lib/realtime/server.ts", {
  AGENT_CHAT_EVENT: "agent-chat:changed",
  broadcast: async () => null,
  userChannel: (userId) => `user-${userId}`,
});

const browserRoute = load("src/app/api/agent-chat/[sessionId]/route.ts");
const mcpRoute = load(
  "src/app/api/mcp/chat/sessions/[sessionId]/messages/route.ts",
);

function browserRequest() {
  return new Request("https://app.hypertask.ai/api/agent-chat/session-1");
}

function mcpRequest() {
  return new Request(
    "https://app.hypertask.ai/api/mcp/chat/sessions/session-1/messages",
  );
}

function routeContext() {
  return { params: Promise.resolve({ sessionId: "session-1" }) };
}

function chatMessage(index, content = `message-${index}`) {
  return {
    id: `message-${index}`,
    role: index % 2 === 0 ? "assistant" : "human",
    content,
    createdAt: new Date(Date.UTC(2026, 8, 4, 12, 0, index)),
  };
}

function activity(index, type = "action") {
  return {
    id: `activity-${index}`,
    kind: "event",
    type,
    text: `status-${index}`,
    link: null,
    createdAt: new Date(Date.UTC(2026, 8, 4, 10, 0, index)).toISOString(),
    task: {
      id: 42,
      ticketNumber: "HTPR-42",
      title: "Passive activity",
      url: "/detail/project-15/42",
    },
  };
}

test("browser history keeps normal messages intact and returns activity separately", async () => {
  flagEnabled = true;
  activityCalls = [];
  activityRows = [activity(1)];
  messageRows = [chatMessage(2), chatMessage(1)];

  const response = await browserRoute.GET(browserRequest(), routeContext());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(
    body.messages.map(({ id }) => id),
    ["message-1", "message-2"],
  );
  assert.deepEqual(body.activity, activityRows);
  assert.equal(body.awaiting, false);
  assert.deepEqual(activityCalls, [
    { agentId: "agent-1", sessionId: "session-1", userId: 6 },
  ]);
});

test("browser history does not query or expose activity while the server flag is off", async () => {
  flagEnabled = false;
  activityCalls = [];
  activityRows = [activity(1)];
  messageRows = [chatMessage(1)];

  const response = await browserRoute.GET(browserRequest(), routeContext());
  const body = await response.json();

  assert.deepEqual(body.activity, []);
  assert.equal(body.awaiting, true);
  assert.deepEqual(activityCalls, []);
});

test("MCP adds at most ten activity facts only for an explicit activity question", async () => {
  flagEnabled = true;
  activityCalls = [];
  activityRows = Array.from({ length: 12 }, (_, index) => activity(index));
  activityRows[11].createdAt = "2026-09-04T14:00:00.000Z";
  messageRows = Array.from({ length: 50 }, (_, index) =>
    chatMessage(50 - index, index === 0 ? "What are you doing?" : undefined),
  );
  messageRows[0] = {
    ...messageRows[0],
    role: "human",
    content: "What are you doing?",
  };

  const response = await mcpRoute.GET(mcpRequest(), routeContext());
  const body = await response.json();

  assert.equal(body.messages.length, 50);
  const context = body.messages.filter(({ kind }) => kind === "event");
  assert.equal(context.length, 10);
  assert.equal(context.every(({ role }) => role === "assistant"), true);
  assert.equal(
    body.messages.filter(({ kind }) => kind !== "event").length,
    40,
  );
  assert.equal(JSON.parse(context[0].content).ticket, "HTPR-42");
  assert.deepEqual(body.messages.at(-1), {
    id: "message-50",
    role: "human",
    content: "What are you doing?",
    createdAt: "2026-09-04T12:00:50.000Z",
  });
  assert.deepEqual(activityCalls, [
    { agentId: "agent-1", sessionId: "session-1", userId: 6 },
  ]);
});

test("ordinary MCP transcript reads preserve all normal messages without activity work", async () => {
  flagEnabled = true;
  activityCalls = [];
  activityRows = [activity(1)];
  messageRows = [chatMessage(1, "Please review HTPR-42")];

  const response = await mcpRoute.GET(mcpRequest(), routeContext());
  const body = await response.json();

  assert.deepEqual(
    body.messages.map(({ id, role, content }) => ({ id, role, content })),
    [{ id: "message-1", role: "human", content: "Please review HTPR-42" }],
  );
  assert.deepEqual(activityCalls, []);
});

test("activity-enabled chats poll uncached without overlapping requests", () => {
  const polling = chatClientSource.slice(
    chatClientSource.indexOf("const replyPollDeadline"),
    chatClientSource.indexOf("// Realtime nudge"),
  );

  assert.match(chatClientSource, /const ACTIVITY_POLL_MS = 5000/);
  assert.match(
    chatClientSource,
    /fetch\(`\/api\/agent-chat\/\$\{loadSessionId\}`,[\s\S]*?cache: "no-store"/,
  );
  assert.match(polling, /await loadMessages\(session\.id\)/);
  assert.match(polling, /timer = setTimeout\(poll, delay\)/);
  assert.doesNotMatch(polling, /setInterval/);
  assert.match(polling, /if \(!replyPollActive && !activityRowsEnabled\) return;/);
  assert.match(polling, /Date\.now\(\) < replyPollDeadline/);
});
