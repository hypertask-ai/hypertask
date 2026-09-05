// HTPR-6006: the confirmation boundary. Each test maps to one promise the
// ticket makes: chat cannot act without confirmation, cannot widen permissions,
// cannot create a second ticket, and cannot reach another user's conversation.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
let loadId = 0;

function stub(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

function load(relativePath) {
  return createJiti(
    path.join(root, `tests/agent-chat-ticket-proposal-${++loadId}.cjs`),
    { alias: { "@": path.join(root, "src") }, interopDefault: true },
  )(path.join(root, relativePath));
}

// --- mutable test state -----------------------------------------------------
let flagEnabled = true;
let agentRole = "write";
let projectAccess = {
  project: { id: 15, title: "Product", uniqueIdentifier: "HTPR", teamId: "t1" },
  error: null,
};
let sectionAccess = {
  section: { id: 4309, section_title: "Bugs", projectId: 15 },
  error: null,
};
let sessionRow = null;
let proposalRow = null;
let createdMessages = [];
let createdProposals = [];
let createTaskCalls = [];
let nextTaskId = 900;
let archivedTaskIds = [];

function baseProposal(overrides = {}) {
  return {
    id: "prop-1",
    status: "PENDING",
    outcome: "Rename the login button",
    ticketTitle: "Rename the login button",
    targetProjectId: 15,
    targetProjectTitle: "Product",
    targetSectionId: 4309,
    targetSectionTitle: "Bugs",
    failureMessage: null,
    taskId: null,
    confirmedAt: null,
    task: null,
    ...overrides,
  };
}

/** Enough of Prisma's `where` to make updateMany a real conditional write. */
function matches(row, where) {
  for (const [key, value] of Object.entries(where)) {
    if (key === "OR") {
      if (!value.some((branch) => matches(row, branch))) return false;
      continue;
    }
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if ("in" in value && !value.in.includes(row[key])) return false;
      if ("lt" in value) {
        if (row[key] === null || !(row[key] < value.lt)) return false;
      }
      continue;
    }
    if (row[key] !== value) return false;
  }
  return true;
}

const prisma = {
  chatSession: { findFirst: async () => sessionRow },
  chatMessage: {
    findFirst: async () => ({ id: "human-1" }),
    findUnique: async () => null,
    create: async ({ data }) => {
      const row = { id: `msg-${createdMessages.length + 1}`, ...data,
        role: data.role, content: data.content, createdAt: new Date() };
      createdMessages.push(row);
      return row;
    },
  },
  chatTicketProposal: {
    findFirst: async () => proposalRow,
    // The relation Prisma would join once taskId is attached.
    findUnique: async () =>
      proposalRow && proposalRow.taskId
        ? {
            ...proposalRow,
            task: {
              ticketNumber: "HTPR-9001",
              projectId: 15,
              uniqueIndex: 9001,
              status: "Normal",
            },
          }
        : proposalRow,
    create: async ({ data }) => {
      createdProposals.push(data);
      return baseProposal(data);
    },
    updateMany: async ({ where, data }) => {
      if (!proposalRow || !matches(proposalRow, where)) return { count: 0 };
      Object.assign(proposalRow, data);
      return { count: 1 };
    },
    update: async ({ data }) => {
      Object.assign(proposalRow, data);
      return proposalRow;
    },
  },
  task: {
    update: async ({ where }) => {
      archivedTaskIds.push(where.id);
      return { id: where.id };
    },
  },
  $transaction: async (fn) =>
    fn({
      chatMessage: prisma.chatMessage,
      chatTicketProposal: prisma.chatTicketProposal,
      chatSession: { update: async () => null },
    }),
};

stub("src/lib/prisma.ts", { default: prisma });
stub("src/lib/auth/getSessionUser.ts", {
  getSessionUser: async () => ({ userId: 6 }),
});
stub("src/lib/agents/visibility.ts", { accessibleAgentWhere: () => ({}) });
stub("src/lib/flags.ts", {
  AGENT_CHAT_TICKET_CONFIRM_FLAG: "htpr-6006-chat-confirm-ticket",
  isFeatureEnabled: async () => flagEnabled,
});
stub("src/lib/realtime/server.ts", {
  AGENT_CHAT_EVENT: "agent-chat:changed",
  broadcast: async () => null,
  userChannel: (userId) => `user-${userId}`,
});
stub("src/lib/mcp/auth.ts", {
  checkMcpRateLimit: async () => null,
  validateMcpAuth: async () => ({ agentId: "agent-1", user: { id: 6 } }),
});
stub("src/lib/mcp/agents/scopes.ts", {
  getAgentRole: async () => agentRole,
  requireRole: async () =>
    agentRole === "read"
      ? Response.json(
          { success: false, error: "insufficient_scope" },
          { status: 403 },
        )
      : null,
});
stub("src/lib/mcp/tasks/services.ts", {
  validateProjectAccess: async () => projectAccess,
  getSectionForTask: async () => sectionAccess,
});
stub("src/utils/controllers/tasks/createTaskCore.ts", {
  createTaskCore: async (options) => {
    createTaskCalls.push(options);
    return { task: { id: ++nextTaskId, ticketNumber: "HTPR-9001" }, description: null };
  },
});
stub("src/lib/agents/agentChatActivity.ts", { listAgentChatActivity: async () => [] });
stub("src/lib/agents/chatActivityFeed.ts", {
  activityContextMessages: () => [],
  asksForAgentActivity: () => false,
});

const mcpRoute = load("src/app/api/mcp/chat/sessions/[sessionId]/messages/route.ts");
const confirmRoute = load(
  "src/app/api/agent-chat/[sessionId]/proposals/[proposalId]/route.ts",
);

function mcpPost(body) {
  return mcpRoute.POST(
    new Request("https://app.hypertask.ai/api/mcp/chat/sessions/s1/messages", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ sessionId: "s1" }) },
  );
}

function confirmPost(action = "confirm") {
  return confirmRoute.POST(
    new Request("https://app.hypertask.ai/api/agent-chat/s1/proposals/prop-1", {
      method: "POST",
      body: JSON.stringify({ action }),
    }),
    { params: Promise.resolve({ sessionId: "s1", proposalId: "prop-1" }) },
  );
}

test.beforeEach(() => {
  flagEnabled = true;
  agentRole = "write";
  projectAccess = {
    project: { id: 15, title: "Product", uniqueIdentifier: "HTPR", teamId: "t1" },
    error: null,
  };
  sectionAccess = {
    section: { id: 4309, section_title: "Bugs", projectId: 15 },
    error: null,
  };
  sessionRow = {
    id: "s1",
    agentId: "agent-1",
    userId: 6,
    agent: { id: "agent-1", displayName: "Dev 5" },
  };
  proposalRow = baseProposal();
  createdMessages = [];
  createdProposals = [];
  createTaskCalls = [];
  archivedTaskIds = [];
});

const proposalBody = {
  text: "I can do that, but it changes code. Shall I open a ticket?",
  replyToMessageId: "human-1",
  proposal: {
    outcome: "Rename the login button",
    ticketTitle: "Rename the login button",
    targetProjectId: 15,
    targetSectionId: 4309,
  },
};

test("a proposal never creates the ticket by itself", async () => {
  const res = await mcpPost(proposalBody);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.message.proposal.status, "PENDING");
  assert.equal(createdProposals.length, 1);
  // The whole point: writing the proposal must not touch the board.
  assert.equal(createTaskCalls.length, 0);
});

test("an agent cannot propose onto a board the chat user cannot reach", async () => {
  projectAccess = {
    project: null,
    error: { status: 403, message: "User does not have permission" },
  };
  const res = await mcpPost(proposalBody);
  assert.equal(res.status, 403);
  // Nothing is stored, so a rejected proposal cannot resurface later.
  assert.equal(createdProposals.length, 0);
  assert.equal(createdMessages.length, 0);
});

test("a read-only agent cannot propose work", async () => {
  agentRole = "read";
  const res = await mcpPost(proposalBody);
  assert.equal(res.status, 403);
  assert.equal(createdProposals.length, 0);
});

test("two clicks on Create ticket create exactly one ticket", async () => {
  const [first, second] = await Promise.all([confirmPost(), confirmPost()]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(createTaskCalls.length, 1);
  assert.equal(archivedTaskIds.length, 0);
  assert.equal(proposalRow.status, "CONFIRMED");
});

test("confirming after board access is revoked fails recoverably", async () => {
  projectAccess = {
    project: null,
    error: { status: 403, message: "User does not have permission" },
  };
  const res = await confirmPost();
  assert.equal(res.status, 403);
  assert.equal(createTaskCalls.length, 0);
  assert.equal(proposalRow.status, "FAILED");
  // FAILED is claimable again, so the user can retry once access returns.
  projectAccess = {
    project: { id: 15, title: "Product", uniqueIdentifier: "HTPR", teamId: "t1" },
    error: null,
  };
  const retry = await confirmPost();
  assert.equal(retry.status, 200);
  assert.equal(createTaskCalls.length, 1);
});

test("the confirmed ticket links back to the conversation", async () => {
  const res = await confirmPost();
  assert.equal(res.status, 200);
  const created = createTaskCalls[0];
  assert.equal(created.title, "Rename the login button");
  assert.match(created.description, /Rename the login button/);
  // The other half of the two-way link; the card carries the ticket number.
  assert.match(created.description, /\/agents\/chat\?agent=agent-1/);
  const body = await res.json();
  assert.equal(body.proposal.task.ticketNumber, "HTPR-9001");
});

test("a proposal in another user's conversation is not found", async () => {
  sessionRow = null;
  const res = await confirmPost();
  assert.equal(res.status, 404);
  assert.equal(createTaskCalls.length, 0);
});

test("dismiss keeps the board untouched and blocks a later confirm", async () => {
  const dismissed = await confirmPost("dismiss");
  assert.equal(dismissed.status, 200);
  assert.equal(proposalRow.status, "DISMISSED");
  const res = await confirmPost();
  assert.equal(res.status, 409);
  assert.equal(createTaskCalls.length, 0);
});
