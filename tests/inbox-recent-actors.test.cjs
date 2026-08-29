const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});
const {
  buildRecentInboxActors,
  normalizeInboxActorActivityRows,
} = jiti(
  path.join(root, "src/utils/controllers/notifications/recentActors.ts"),
);

const activity = ({
  taskId,
  type = "Comment",
  fromAgentId = null,
  fromUserId = null,
  createdAt,
}) => ({
  taskId,
  type,
  fromAgentId,
  fromUserId,
  _max: { createdAt: new Date(createdAt) },
});

test("database-reduced actor rows keep their newest timestamps", () => {
  const result = normalizeInboxActorActivityRows([
    {
      taskId: 10,
      type: "Comment",
      fromAgentId: "agent-a",
      fromUserId: 6,
      createdAt: new Date("2026-08-17T13:00:00Z"),
    },
    {
      taskId: 10,
      type: "Mentioned",
      fromAgentId: null,
      fromUserId: 7,
      createdAt: new Date("2026-08-17T12:00:00Z"),
    },
  ]);

  assert.deepEqual(result, [
    activity({ taskId: 10, fromAgentId: "agent-a", fromUserId: 6, createdAt: "2026-08-17T13:00:00Z" }),
    activity({ taskId: 10, type: "Mentioned", fromUserId: 7, createdAt: "2026-08-17T12:00:00Z" }),
  ]);
});

test("recent Inbox actors keep the two newest distinct people per task", () => {
  const result = buildRecentInboxActors({
    activity: [
      activity({ taskId: 10, fromUserId: 6, createdAt: "2026-08-17T10:00:00Z" }),
      activity({ taskId: 10, fromAgentId: "agent-a", createdAt: "2026-08-17T12:00:00Z" }),
      activity({ taskId: 10, fromUserId: 7, createdAt: "2026-08-17T11:00:00Z" }),
      activity({ taskId: 10, fromAgentId: "agent-a", createdAt: "2026-08-17T09:00:00Z" }),
      activity({ taskId: 11, fromUserId: 6, createdAt: "2026-08-17T08:00:00Z" }),
    ],
    agentsById: new Map([
      ["agent-a", { displayName: "Speed Engineer", photoURL: "agent.png" }],
    ]),
    usersById: new Map([
      [6, { displayName: "Valentin", photoURL: null }],
      [7, { displayName: "Abdul", photoURL: "abdul.png" }],
    ]),
  });

  assert.deepEqual(result, {
    10: [
      { displayName: "Speed Engineer", photoURL: "agent.png" },
      { displayName: "Abdul", photoURL: "abdul.png" },
    ],
    11: [{ displayName: "Valentin", photoURL: null }],
  });
});

test("recent Inbox actors skip missing profiles and actorless rows", () => {
  const result = buildRecentInboxActors({
    activity: [
      activity({ taskId: 10, fromAgentId: "missing", createdAt: "2026-08-17T12:00:00Z" }),
      activity({ taskId: 10, createdAt: "2026-08-17T11:00:00Z" }),
      activity({ taskId: null, fromUserId: 6, createdAt: "2026-08-17T10:00:00Z" }),
    ],
    agentsById: new Map(),
    usersById: new Map([[6, { displayName: "Valentin", photoURL: null }]]),
  });

  assert.deepEqual(result, { 10: [] });
});

test("a deleted agent falls back to the co-populated human actor", () => {
  const result = buildRecentInboxActors({
    activity: [
      activity({
        taskId: 10,
        fromAgentId: "deleted-agent",
        fromUserId: 6,
        createdAt: "2026-08-17T12:00:00Z",
      }),
    ],
    agentsById: new Map(),
    usersById: new Map([
      [6, { displayName: "Valentin", photoURL: "valentin.png" }],
    ]),
  });

  assert.deepEqual(result, {
    10: [{ displayName: "Valentin", photoURL: "valentin.png" }],
  });
});
