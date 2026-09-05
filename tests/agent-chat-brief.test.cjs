const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.NEXT_PUBLIC_BASEURL = "https://app.hypertask.ai";

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/agent-chat-brief-entry.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { buildAgentChatBrief } = jiti(
  path.join(root, "src/lib/agents/chatBrief.ts"),
);

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

test("brief keeps the required history inside the total payload cap", async () => {
  const long = "x".repeat(1000);
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
  assert.ok(JSON.stringify(brief).length <= 12000);
});

test("message send gates the brief and falls back to the legacy payload on enrichment errors", () => {
  const route = fs.readFileSync(
    path.join(root, "src/app/api/agent-chat/[sessionId]/messages/route.ts"),
    "utf8",
  );
  assert.match(route, /isFeatureEnabled\(AGENT_CHAT_BRIEF_FLAG, userId\)/);
  assert.match(route, /try\s*\{[\s\S]*buildAgentChatBrief\([\s\S]*\}\s*catch/);
  assert.match(route, /\.\.\.\(agentBrief \? \{ agentBrief \} : \{\}\)/);
});
