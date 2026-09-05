const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

process.env.NEXT_PUBLIC_BASEURL = "https://app.hypertask.ai";

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/agent-chat-brief-entry.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { buildAgentChatBrief } = jiti(
  path.join(root, "src/lib/agents/chatBrief.ts"),
);

let routeEntry = 0;
function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

function loadMessageRoute({ flagEnabled, brief, briefError = null }) {
  const deliveries = [];
  let briefCalls = 0;
  const prisma = {
    chatSession: {
      findFirst: async () => ({
        id: "session-1",
        agentId: "agent-dev-2",
        user: { displayName: "Valentin" },
        agent: { runtimeType: "EXTERNAL" },
      }),
    },
    $transaction: async (operation) =>
      operation({
        chatMessage: {
          create: async ({ data }) => ({
            id: "message-1",
            ...data,
            createdAt: at("2026-09-05T12:00:00Z"),
          }),
        },
        chatSession: { update: async () => ({}) },
      }),
  };

  stubModule("src/lib/prisma.ts", { default: prisma });
  stubModule("src/lib/auth/getSessionUser.ts", {
    getSessionUser: async () => ({ userId: 6 }),
  });
  stubModule("src/lib/agentWebhooks/outbox.ts", {
    persistAgentRunTriggerWebhooks: async (_tx, input) => {
      deliveries.push(input);
      return [];
    },
    publishAgentWebhookDeliveries: async () => {},
  });
  stubModule("src/lib/realtime/server.ts", {
    AGENT_CHAT_EVENT: "agent-chat",
    broadcast: async () => {},
    userChannel: (userId) => `user-${userId}`,
  });
  stubModule("src/lib/agents/visibility.ts", { accessibleAgentWhere: () => ({}) });
  stubModule("src/lib/flags.ts", {
    AGENT_CHAT_BRIEF_FLAG: "htpr-6155-chat-agent-brief",
    isFeatureEnabled: async () => flagEnabled,
  });
  stubModule("src/lib/agents/chatBrief.ts", {
    buildAgentChatBrief: async (input) => {
      briefCalls += 1;
      if (briefError) throw briefError;
      assert.deepEqual(input, { userId: 6, agentId: "agent-dev-2" });
      return brief;
    },
  });

  const routePath = path.join(
    root,
    "src/app/api/agent-chat/[sessionId]/messages/route.ts",
  );
  delete require.cache[routePath];
  const routeJiti = createJiti(
    path.join(root, `tests/agent-chat-brief-route-${++routeEntry}.cjs`),
    {
      alias: { "@": path.join(root, "src") },
      interopDefault: true,
    },
  );
  return {
    ...routeJiti(routePath),
    deliveries,
    briefCalls: () => briefCalls,
  };
}

const at = (value) => new Date(value);
const sections = [
  { section_title: "In Progress", isDone: false },
  { section_title: "QA", isDone: true },
];

function task({
  id,
  ticketNumber,
  title,
  section = "In Progress",
  status = "Normal",
  assignees = [],
}) {
  return {
    id,
    uniqueIndex: Number(ticketNumber.split("-")[1]),
    ticketNumber,
    title,
    section,
    status,
    projectId: 15,
    project: { section: sections },
    assignees,
  };
}

const agentAssignee = {
  agent: { displayName: "Dev 2" },
  user: { displayName: "Valentin" },
};
const humanAssignee = {
  agent: null,
  user: { displayName: "QA Person" },
};

function fakeDb() {
  const calls = { current: null, recentTickets: null, recentComments: null, prs: null };
  const current = task({
    id: 6155,
    ticketNumber: "HTPR-6155",
    title: "Give Agent Chat real work context",
    assignees: [agentAssignee, humanAssignee],
  });
  const completed = task({
    id: 6100,
    ticketNumber: "HTPR-6100",
    title: "Completed context work",
    section: "QA",
    assignees: [agentAssignee],
  });
  const archived = task({
    id: 6099,
    ticketNumber: "HTPR-6099",
    title: "Archived context work",
    status: "Archive",
    assignees: [humanAssignee],
  });

  return {
    calls,
    db: {
      assignees: {
        findFirst: async (query) => {
          calls.current = query;
          return { task: current };
        },
      },
      comment: {
        findMany: async (query) => {
          if (query.distinct) {
            calls.recentTickets = query;
            return [
              { id: 30, createdAt: at("2026-09-05T10:00:00Z"), task: completed },
              { id: 29, createdAt: at("2026-09-04T10:00:00Z"), task: archived },
            ];
          }
          calls.recentComments = query;
          return [
            {
              id: 31,
              createdAt: at("2026-09-05T11:00:00Z"),
              commentText: "Shipped the bounded brief.",
              text: "<p>Shipped the bounded brief.</p>",
              task: completed,
            },
          ];
        },
      },
      taskPullRequest: {
        findMany: async (query) => {
          calls.prs = query;
          return [
            {
              id: "pr-1",
              number: 53,
              title: "HTPR-6100 context work",
              url: "https://github.com/hypertask-ai/agent-worker/pull/53",
              repositoryOwner: "hypertask-ai",
              repositoryName: "agent-worker",
              lifecycle: "open",
              checkState: "passing",
              updatedAt: at("2026-09-05T12:00:00Z"),
              task: completed,
            },
          ];
        },
      },
    },
  };
}

function assertAccessScoped(taskWhere) {
  assert.equal(taskWhere.deletedAt, null);
  assert.equal(taskWhere.project.teamId.not, null);
  assert.ok(Array.isArray(taskWhere.project.OR));
}

test("brief names current and recent work, open PRs, comments, links, assignees, and outcomes", async () => {
  const { db, calls } = fakeDb();
  const brief = await buildAgentChatBrief({ userId: 6, agentId: "agent-dev-2", db });

  assert.deepEqual(brief.currentTicket, {
    ticketNumber: "HTPR-6155",
    title: "Give Agent Chat real work context",
    section: "In Progress",
    outcome: "open",
    assignees: ["Dev 2", "QA Person"],
    url: "https://app.hypertask.ai/detail/project-15/6155",
  });
  assert.deepEqual(
    brief.recentTickets.map(({ ticketNumber, outcome, url }) => ({
      ticketNumber,
      outcome,
      url,
    })),
    [
      {
        ticketNumber: "HTPR-6100",
        outcome: "completed",
        url: "https://app.hypertask.ai/detail/project-15/6100",
      },
      {
        ticketNumber: "HTPR-6099",
        outcome: "archived",
        url: "https://app.hypertask.ai/detail/project-15/6099",
      },
    ],
  );
  assert.deepEqual(brief.openPullRequests, [
    {
      number: 53,
      title: "HTPR-6100 context work",
      url: "https://github.com/hypertask-ai/agent-worker/pull/53",
      repository: "hypertask-ai/agent-worker",
      checkState: "passing",
      ticket: {
        ticketNumber: "HTPR-6100",
        title: "Completed context work",
        url: "https://app.hypertask.ai/detail/project-15/6100",
      },
    },
  ]);
  assert.deepEqual(brief.recentComments, [
    {
      text: "Shipped the bounded brief.",
      createdAt: "2026-09-05T11:00:00.000Z",
      ticket: {
        ticketNumber: "HTPR-6100",
        title: "Completed context work",
        url: "https://app.hypertask.ai/detail/project-15/6100",
      },
    },
  ]);

  assert.equal(calls.current.where.agentId, "agent-dev-2");
  assert.equal(calls.current.where.task.section, "In Progress");
  assert.equal(calls.current.take, undefined);
  assert.deepEqual(calls.current.orderBy, [{ assignedAt: "desc" }, { id: "desc" }]);
  assert.equal(calls.recentTickets.take, 10);
  assert.deepEqual(calls.recentTickets.distinct, ["taskId"]);
  assert.equal(calls.recentTickets.where.taskId.not, 6155);
  assert.deepEqual(calls.recentTickets.orderBy, [
    { createdAt: "desc" },
    { id: "desc" },
  ]);
  assert.equal(calls.recentComments.take, 5);
  assert.equal(calls.prs.take, 10);
  assert.equal(calls.prs.where.lifecycle, "open");
  assert.equal(calls.prs.where.task.assignees.some.agentId, "agent-dev-2");

  assertAccessScoped(calls.current.where.task);
  assertAccessScoped(calls.recentTickets.where.task);
  assertAccessScoped(calls.recentComments.where.task);
  assertAccessScoped(calls.prs.where.task);
});

test("brief keeps the required history inside the UTF-8 payload cap", async () => {
  const long = "🧠".repeat(1000);
  const current = task({
    id: 6155,
    ticketNumber: "HTPR-6155",
    title: long,
    assignees: Array.from({ length: 3 }, (_, index) => ({
      agent: { displayName: `${index}-${long}` },
      user: { displayName: long },
    })),
  });
  const recent = Array.from({ length: 10 }, (_, index) =>
    task({
      id: 6100 - index,
      ticketNumber: `HTPR-${6100 - index}`,
      title: long,
      assignees: current.assignees,
    }),
  );
  const db = {
    assignees: { findFirst: async () => ({ task: current }) },
    comment: {
      findMany: async (query) =>
        query.distinct
          ? recent.map((recentTask, index) => ({
              id: 100 - index,
              createdAt: at("2026-09-05T10:00:00Z"),
              task: recentTask,
            }))
          : recent.slice(0, 5).map((recentTask, index) => ({
              id: 200 - index,
              createdAt: at("2026-09-05T11:00:00Z"),
              commentText: long,
              text: `<p>${long}</p>`,
              task: recentTask,
            })),
    },
    taskPullRequest: {
      findMany: async () =>
        recent.map((recentTask, index) => ({
          id: `pr-${index}`,
          number: index + 1,
          title: long,
          url: `https://github.com/${long}`,
          repositoryOwner: long,
          repositoryName: long,
          checkState: long,
          updatedAt: at("2026-09-05T12:00:00Z"),
          task: recentTask,
        })),
    },
  };

  const brief = await buildAgentChatBrief({ userId: 6, agentId: "agent-dev-2", db });

  assert.equal(brief.recentTickets.length, 10);
  assert.equal(brief.recentComments.length, 5);
  assert.ok(brief.openPullRequests.length < 10);
  assert.ok(Buffer.byteLength(JSON.stringify(brief), "utf8") <= 12000);
});

async function sendMessage(route) {
  return route.POST(
    {
      headers: new Headers(),
      json: async () => ({ text: "What are you working on?" }),
    },
    { params: Promise.resolve({ sessionId: "session-1" }) },
  );
}

test("message send includes the brief only when its server flag is enabled", async () => {
  const brief = {
    currentTicket: { ticketNumber: "HTPR-6155" },
    recentTickets: [],
    openPullRequests: [],
    recentComments: [],
  };
  const enabled = loadMessageRoute({ flagEnabled: true, brief });
  assert.equal((await sendMessage(enabled)).status, 200);
  assert.equal(enabled.briefCalls(), 1);
  assert.deepEqual(enabled.deliveries[0].agentBrief, brief);

  const disabled = loadMessageRoute({ flagEnabled: false, brief });
  assert.equal((await sendMessage(disabled)).status, 200);
  assert.equal(disabled.briefCalls(), 0);
  assert.equal("agentBrief" in disabled.deliveries[0], false);
});

test("message send keeps the exact legacy payload when enrichment fails", async () => {
  const route = loadMessageRoute({
    flagEnabled: true,
    brief: null,
    briefError: new Error("brief unavailable"),
  });
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal((await sendMessage(route)).status, 200);
  } finally {
    console.error = originalError;
  }

  assert.equal(route.briefCalls(), 1);
  assert.equal("agentBrief" in route.deliveries[0], false);
  assert.deepEqual(route.deliveries[0].chat, {
    sessionId: "session-1",
    messageId: "message-1",
    text: "What are you working on?",
    userName: "Valentin",
  });
});
