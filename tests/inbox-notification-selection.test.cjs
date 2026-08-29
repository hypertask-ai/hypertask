const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});
const { getInboxNotifications } = jiti(
  path.join(root, "src/utils/controllers/notifications/getAll.ts"),
);
const { visibleUserInboxWhere } = jiti(
  path.join(
    root,
    "src/utils/controllers/notifications/visibleInboxScope.ts",
  ),
);

test("the visible Inbox scope intentionally requires a live task", () => {
  const where = visibleUserInboxWhere(6);

  assert.equal(where.userId, 6);
  assert.ok(Array.isArray(where.AND));
  assert.deepEqual(where.AND[0].OR, [
    { task: { status: "Normal" } },
    { task: { status: "Archive" }, returnedFromReminders: true },
  ]);
});

// Minimal Prisma-where evaluator covering only the operators
// visibleUserInboxWhere actually emits (AND/OR/NOT, `in`, `not`, `every`,
// and the `task`/`Reminders` relation filters). This runs the real,
// unmodified where clause against fixture rows instead of re-describing its
// logic, so a regression in the clause itself fails the test.
function fieldMatches(value, condition) {
  if (condition && typeof condition === "object" && !Array.isArray(condition)) {
    if ("in" in condition) return condition.in.includes(value);
    if ("not" in condition) return value !== condition.not;
    return whereMatches(condition, value);
  }
  return value === condition;
}

function whereMatches(where, row) {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => {
    if (key === "AND") return condition.every((clause) => whereMatches(clause, row));
    if (key === "OR") return condition.some((clause) => whereMatches(clause, row));
    if (key === "NOT") return !whereMatches(condition, row);
    if (key === "task") {
      if (row.task == null) return false;
      return whereMatches(condition, row.task);
    }
    if (key === "Reminders") {
      const reminders = row.Reminders ?? [];
      return reminders.every((reminder) => whereMatches(condition.every, reminder));
    }
    return fieldMatches(row[key], condition);
  });
}

function baseNotification(overrides = {}) {
  return {
    status: "Normal",
    archivedAt: null,
    userId: 6,
    agentId: null,
    fromUserId: 9,
    fromAgentId: null,
    type: "TaskReminder",
    returnedFromReminders: null,
    task: { status: "Normal", Reminders: [] },
    ...overrides,
  };
}

test("HTPR-5683: a reminder returned onto an archived task stays visible", () => {
  const where = visibleUserInboxWhere(6);
  const row = baseNotification({
    returnedFromReminders: true,
    task: { status: "Archive", Reminders: [] },
  });

  assert.equal(whereMatches(where, row), true);
});

test("an archived task without a returned reminder stays hidden", () => {
  const where = visibleUserInboxWhere(6);
  const row = baseNotification({
    returnedFromReminders: null,
    task: { status: "Archive", Reminders: [] },
  });

  assert.equal(whereMatches(where, row), false);
});

test("a deleted task is never resurrected, even with returnedFromReminders", () => {
  const where = visibleUserInboxWhere(6);
  const row = baseNotification({
    returnedFromReminders: true,
    task: { status: "Deleted", Reminders: [] },
  });

  assert.equal(whereMatches(where, row), false);
});

test("a live task with a still-pending reminder stays hidden", () => {
  const where = visibleUserInboxWhere(6);
  const row = baseNotification({
    task: { status: "Normal", Reminders: [{ status: "Normal" }] },
  });

  assert.equal(whereMatches(where, row), false);
});

test("Inbox relations load only for database-selected response rows", async () => {
  let selectionQuery;
  let notificationArgs;
  const expected = [{ id: 9 }, { id: 3 }];
  const client = {
    $queryRaw: async (query) => {
      selectionQuery = query;
      return expected;
    },
    notification: {
      findMany: async (args) => {
        notificationArgs = args;
        return expected;
      },
    },
  };

  const result = await getInboxNotifications(6, client);

  assert.deepEqual(result, expected);
  assert.deepEqual(notificationArgs.where.AND[0], { id: { in: [9, 3] } });
  assert.equal(notificationArgs.where.AND[1].userId, 6);
  assert.equal(notificationArgs.where.AND[1].status, "Normal");
  assert.deepEqual(notificationArgs.orderBy, [
    { createdAt: "desc" },
    { id: "desc" },
  ]);
  assert.equal(notificationArgs.relationLoadStrategy, "join");
  assert.ok(notificationArgs.include.task);
  assert.ok(notificationArgs.include.fromAgent);

  const sql = (Array.isArray(selectionQuery.sql)
    ? selectionQuery.sql.join("?")
    : selectionQuery.sql
  ).replace(/\s+/g, " ");
  assert.match(
    sql,
    /DISTINCT ON \(n\."taskId", n\."notification_inviteId"\)/,
  );
  assert.match(sql, /INNER JOIN "Task"/);
  assert.match(sql, /n\."createdAt" DESC, n\.id DESC/);
  assert.match(sql, /t\."status" = 'Normal'/);
  // HTPR-5683: the raw-SQL selection query mirrors visibleUserInboxWhere's
  // archived-task-plus-returned-reminder exception.
  assert.match(sql, /t\."status" = 'Archive'::"Status"/);
  assert.match(sql, /n\."returnedFromReminders" = true/);
  assert.match(sql, /NOT EXISTS \(/);
});

test("an empty Inbox selection skips the deep relation query", async () => {
  let loaded = false;
  const result = await getInboxNotifications(6, {
    $queryRaw: async () => [],
    notification: {
      findMany: async () => {
        loaded = true;
        return [];
      },
    },
  });

  assert.deepEqual(result, []);
  assert.equal(loaded, false);
});
