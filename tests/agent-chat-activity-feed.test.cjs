const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
let loadId = 0;

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
    path.join(root, `tests/agent-chat-activity-feed-${++loadId}.cjs`),
    { alias: { "@": path.join(root, "src") }, interopDefault: true },
  )(path.join(root, relativePath));
}

const feed = load("src/lib/agents/chatActivityFeed.ts");

const task = {
  id: 42,
  ticketNumber: "HTPR-42",
  title: "Passive activity",
  url: "/detail/project-15/42",
};

function message(id, createdAt, role = "human") {
  return { id, role, content: id, createdAt };
}

function activity(id, createdAt, overrides = {}) {
  return {
    id,
    kind: "event",
    type: "action",
    text: id,
    link: null,
    createdAt,
    task,
    ...overrides,
  };
}

test("feed ordering is deterministic and run starts win equal timestamps", () => {
  const merged = feed.mergeAgentChatFeed(
    [message("message-2", "2026-09-04T10:02:00.000Z")],
    [
      activity("activity-2", "2026-09-04T10:02:00.000Z"),
      activity("run-1", "2026-09-04T10:02:00.000Z"),
      activity("activity-1", "2026-09-04T10:01:00.000Z"),
    ],
  );

  assert.deepEqual(
    merged.map(({ id }) => id),
    ["activity-1", "run-1", "activity-2", "message-2"],
  );
  assert.equal(feed.lastAgentChatMessage(merged).id, "message-2");
});

test("adjacent ticket events group before filtering so hidden chat keeps boundaries", () => {
  const merged = feed.mergeAgentChatFeed(
    [message("message-1", "2026-09-04T10:02:00.000Z")],
    [
      activity("activity-1", "2026-09-04T10:01:00.000Z"),
      activity("activity-2", "2026-09-04T10:03:00.000Z"),
    ],
  );

  const all = feed.displayAgentChatFeed(merged, "all");
  assert.deepEqual(
    all.map(({ kind }) => kind),
    ["event-group", "message", "event-group"],
  );

  const activityOnly = feed.displayAgentChatFeed(merged, "activity");
  assert.equal(activityOnly.length, 2);
  assert.deepEqual(
    activityOnly.map(({ events }) => events.map(({ id }) => id)),
    [["activity-1"], ["activity-2"]],
  );
  assert.deepEqual(
    feed.displayAgentChatFeed(merged, "chat").map(({ id }) => id),
    ["message-1"],
  );
});

test("activity context is opt-in, bounded, normalized, and limited to useful facts", () => {
  assert.equal(
    feed.asksForAgentActivity("What are you doing right now?"),
    true,
  );
  assert.equal(feed.asksForAgentActivity("What are you working on?"), true);
  assert.equal(feed.asksForAgentActivity("How are you doing?"), false);
  assert.equal(feed.asksForAgentActivity("Please review HTPR-42"), false);

  const rows = [
    activity("thought", "2026-09-04T10:00:00.000Z", { type: "thought" }),
    activity("action-1", "2026-09-04T10:01:00.000Z", {
      text: "Opened   pull request\nfor review",
    }),
    activity("error-1", "2026-09-04T10:02:00.000Z", {
      type: "error",
      text: "x".repeat(600),
    }),
    activity("question", "2026-09-04T10:03:00.000Z", { type: "elicitation" }),
  ];
  const context = feed.activityContextMessages(rows, 2);

  assert.equal(context.length, 2);
  assert.deepEqual(JSON.parse(context[0].content), {
    ticket: "HTPR-42",
    status: "Opened pull request for review",
  });
  assert.equal(JSON.parse(context[1].content).status.length, 500);
  assert.deepEqual(
    context.map(({ role }) => role),
    ["activity", "activity"],
  );
  assert.deepEqual(feed.activityContextMessages(rows, 0), []);
  assert.deepEqual(feed.activityContextMessages(rows, -1), []);
});

test("server projection scopes queries before limits and emits safe chronological rows", async () => {
  const queries = {};
  const projectWhere = { OR: [{ ownerId: 6 }], teamId: { not: null } };
  const db = {
    agentRun: {
      findMany: async (query) => {
        queries.runs = query;
        return [
          {
            id: "run-1",
            createdAt: new Date("2026-09-04T10:00:00.000Z"),
            task: {
              id: 42,
              projectId: 15,
              uniqueIndex: 42,
              ticketNumber: "HTPR-42",
              title: "Passive activity",
            },
          },
        ];
      },
    },
    agentRunActivity: {
      findMany: async (query) => {
        queries.activities = query;
        const base = {
          runId: "run-1",
          options: null,
          selectedValue: null,
          selectedLabel: null,
          selectedAt: null,
          selectedById: null,
          run: {
            task: {
              id: 42,
              projectId: 15,
              uniqueIndex: 42,
              ticketNumber: "HTPR-42",
              title: "Passive activity",
            },
          },
        };
        return [
          {
            ...base,
            id: "unsafe",
            type: "ACTION",
            text: "Opened PR",
            link: "javascript:alert(1)",
            createdAt: new Date("2026-09-04T10:01:00.000Z"),
          },
          {
            ...base,
            id: "response",
            type: "RESPONSE",
            text: "Normal reply",
            link: null,
            createdAt: new Date("2026-09-04T10:02:00.000Z"),
          },
          {
            ...base,
            id: "safe",
            type: "ACTION",
            text: "Review passed",
            link: "https://github.com/hypertask-ai/hypertask/pull/290",
            createdAt: new Date("2026-09-04T10:03:00.000Z"),
          },
        ];
      },
    },
  };
  stub("src/lib/prisma.ts", { default: db });
  stub("src/utils/controllers/projects/getAllIncludes.ts", {
    getProjectWhere: (userId) => {
      assert.equal(userId, 6);
      return projectWhere;
    },
  });
  const server = load("src/lib/agents/agentChatActivity.ts");

  const rows = await server.listAgentChatActivity(
    { agentId: "agent-1", sessionId: "session-1", userId: 6, limit: 10 },
    db,
  );

  assert.deepEqual(queries.runs.where, {
    agentId: "agent-1",
    task: { is: { project: projectWhere } },
  });
  assert.deepEqual(queries.activities.where, {
    type: { not: "RESPONSE" },
    run: {
      is: {
        agentId: "agent-1",
        OR: [
          {
            chatSessionId: "session-1",
            taskId: null,
            chatSession: {
              is: { userId: 6, agentId: "agent-1" },
            },
          },
          { task: { is: { project: projectWhere } } },
        ],
      },
    },
  });
  assert.equal(queries.runs.take, 10);
  assert.equal(queries.activities.take, 10);
  assert.deepEqual(
    rows.map(({ id }) => id),
    ["run-run-1", "activity-unsafe", "activity-safe"],
  );
  assert.equal(rows[1].link, null);
  assert.equal(
    rows[2].link,
    "https://github.com/hypertask-ai/hypertask/pull/290",
  );
  assert.equal(rows[0].text, "Started HTPR-42");

  await server.listAgentChatActivity(
    { agentId: "agent-1", sessionId: "session-1", userId: 6, limit: NaN },
    db,
  );
  assert.equal(queries.runs.take, 200);
  assert.equal(queries.activities.take, 200);
});
