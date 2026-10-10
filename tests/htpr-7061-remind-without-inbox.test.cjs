const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const flagKey = "htpr-7061-remind-without-inbox";
let entryId = 0;

function fixture({ enabled = true, access = true, muted = false, existing = false } = {}) {
  const rows = existing ? [{ id: 10, userId: 7, taskId: 99, projectId: 15, type: "Comment", status: "Normal", seen: true }] : [];
  const calls = { created: [], updated: [], flags: [], locks: 0, scheduled: [] };
  let saved;
  let now = new Date("2026-10-10T12:00:00Z");
  const remindAt = new Date("2026-10-10T12:04:00Z");
  const projectWhere = {
    AND: [
      { OR: [{ members: { some: { userId: 7, agentId: null } } }, { ownerId: 7 }] },
      { projectMutes: { none: { userId: 7 } } },
    ],
  };
  const database = {
    $transaction: async (callback) => callback(database),
    $executeRaw: async () => { calls.locks += 1; },
    $queryRaw: async (strings) => {
      assert.match(strings.join("?"), /r\."remindAt" <= now\(\)/);
      if (!saved || saved.status !== "Normal" || saved.remindAt > now) return [];
      saved.status = "Archive";
      return [{ ...saved }];
    },
    reminder: {
      findMany: async () => saved ? [saved] : [],
      create: async ({ data }) => (saved = { id: 1, status: "Normal", createdAt: now, ...data }),
      updateMany: async () => ({ count: 0 }),
    },
    notification: {
      updateMany: async ({ data }) => { for (const row of rows) Object.assign(row, data); },
      findMany: async ({ where }) => {
        assert.equal(where.userId, 7);
        assert.equal(where.taskId, 99);
        assert.equal(where.projectId, 15);
        assert.deepEqual(where.project, projectWhere);
        return access && !muted ? rows.slice(-1) : [];
      },
      update: async ({ where, data }) => {
        calls.updated.push({ where, data });
        Object.assign(rows.find((row) => row.id === where.id), data);
      },
      create: async ({ data }) => {
        calls.created.push(data);
        const row = { id: 11, agentId: null, fromAgentId: null, archivedAt: null, ...data };
        rows.push(row);
        return row;
      },
    },
    task: {
      findFirst: async ({ where, select }) => {
        assert.deepEqual(where, {
          id: 99,
          projectId: 15,
          status: { not: "Deleted" },
          project: projectWhere,
          notifications: { none: { userId: 7 } },
        });
        assert.deepEqual(select, { id: true });
        return access && !muted && rows.length === 0 ? { id: 99 } : null;
      },
    },
  };
  function stub(relativePath, exports) {
    const filename = path.join(root, relativePath);
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
  }
  stub("src/lib/prisma.ts", { default: database });
  stub("src/lib/auth/getSessionUser.ts", { getSessionUser: async () => ({ userId: 7 }) });
  stub("src/lib/flags.ts", {
    HTPR_7061_REMIND_WITHOUT_INBOX_FLAG: flagKey,
    MY_TASKS_SNOOZE_FLAG: "htpr-6461-my-tasks-snooze",
    isFeatureEnabled: async (key, userId) => {
      calls.flags.push({ key, userId });
      return key === flagKey && enabled;
    },
  });
  stub("src/utils/controllers/tasks/assertTaskAccess.ts", { userCanAccessTask: async () => access });
  stub("src/utils/controllers/tasks/myTasksSnooze.ts", { syncMyTasksSnoozeFromReminder: async () => {} });
  stub("src/lib/taskCardActions/writeLocks.ts", {
    TASK_INBOX_REMINDER_LOCK_CLASS: 1_446_420_610,
    withTaskInboxWriteLock: async (_taskId, callback) => callback(database),
  });
  stub("src/pages/api/queues/inboxQueue.ts", {
    cancelInboxReminderJob: async () => {},
    cancelInboxReminderRevisionJob: async () => {},
    cancelLegacyInboxReminderJobIfSafe: async () => {},
    scheduleInboxReminderJob: async (reminder) => { calls.scheduled.push({ ...reminder }); },
  });
  stub("src/utils/controllers/notifications/creation-service/check-reminder_create-notification.ts", {
    default: async (_userId, _projectId, _taskId, payload) => database.notification.create({ data: payload }),
  });
  for (const relativePath of ["src/pages/api/queues/inboxReminder.ts", "src/utils/controllers/reminders/invokeReminder.ts"]) {
    delete require.cache[path.join(root, relativePath)];
  }
  const jiti = require("jiti")(path.join(root, `tests/jiti-remind-7061-${++entryId}.cjs`), {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
    cache: false,
  });
  const handler = jiti(path.join(root, "src/pages/api/queues/inboxReminder.ts")).default;
  const { invokeDueReminder } = jiti(path.join(root, "src/utils/controllers/reminders/invokeReminder.ts"));
  const { visibleUserInboxWhere } = jiti(path.join(root, "src/utils/controllers/notifications/visibleInboxScope.ts"));
  return {
    rows, calls, visibleScope: visibleUserInboxWhere(7),
    async schedule(extra = {}) {
      const response = { statusCode: 0, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
      await handler({ headers: {}, body: { taskId: 99, userId: 7, projectId: 15, remindAt: remindAt.toISOString(), ...extra } }, response);
      return response;
    },
    fire: () => invokeDueReminder(calls.scheduled[0]),
    advance: () => { now = remindAt; },
    revokeAccess: () => { access = false; },
  };
}

test("ticket clock payload without remindTask creates a visible TaskReminder only at fire time", async () => {
  const f = fixture();
  assert.equal((await f.schedule()).statusCode, 200);
  assert.equal(f.rows.length, 0);
  assert.equal(await f.fire(), "skipped");
  assert.equal(f.rows.length, 0);
  f.advance();
  assert.equal(await f.fire(), "invoked");
  assert.deepEqual(f.calls.created, [{ userId: 7, taskId: 99, projectId: 15, type: "TaskReminder", status: "Normal", fromUserId: 7, returnedFromReminders: true, seen: false }]);
  const row = f.rows[0];
  for (const key of ["status", "archivedAt", "userId", "agentId"]) {
    assert.equal(row[key], f.visibleScope[key], `new reminder matches Inbox scope: ${key}`);
  }
  assert.equal(f.visibleScope.NOT.type.in.includes(row.type), false, "self-created TaskReminder is not hidden");
  assert.deepEqual(f.calls.flags.at(-1), { key: flagKey, userId: 7 });
  assert.equal(await f.fire(), "skipped");
  assert.equal(f.rows.length, 1);
  assert.equal(f.calls.locks, 4);
});

for (const enabled of [true, false]) {
  test(`existing Inbox item restores unchanged without duplicates with flag ${enabled ? "on" : "off"}`, async () => {
    const f = fixture({ existing: true, enabled });
    await f.schedule();
    assert.equal(f.rows[0].status, "Archive");
    f.advance();
    assert.equal(await f.fire(), "invoked");
    assert.equal(f.rows.length, 1);
    assert.equal(f.calls.created.length, 0);
    assert.deepEqual(f.calls.updated, [{ where: { id: 10 }, data: { status: "Normal", returnedFromReminders: true, seen: false } }]);
  });
}

test("flag off keeps the old no-item behavior", async () => {
  const f = fixture({ enabled: false });
  await f.schedule();
  f.advance();
  assert.equal(await f.fire(), "invoked");
  assert.equal(f.rows.length, 0);
  assert.equal(f.calls.created.length, 0);
});

test("no ticket access rejects scheduling and creates nothing", async () => {
  const f = fixture({ access: false });
  assert.equal((await f.schedule()).statusCode, 403);
  assert.equal(f.calls.scheduled.length, 0);
  assert.equal(f.calls.created.length, 0);
});

test("access revoked before delivery creates nothing", async () => {
  const f = fixture();
  await f.schedule();
  f.revokeAccess();
  f.advance();
  assert.equal(await f.fire(), "invoked");
  assert.equal(f.calls.created.length, 0);
});

test("muted board does not gain a reminder notification", async () => {
  const f = fixture({ muted: true });
  await f.schedule();
  f.advance();
  assert.equal(await f.fire(), "invoked");
  assert.equal(f.calls.created.length, 0);
});

test("legacy remindTask false notification is restored without a second item", async () => {
  const f = fixture();
  await f.schedule({ remindTask: false });
  assert.equal(f.rows.length, 1);
  assert.equal(f.rows[0].status, "Archive");
  f.advance();
  await f.fire();
  assert.equal(f.rows.length, 1);
  assert.equal(f.rows[0].status, "Normal");
  assert.equal(f.rows[0].type, "TaskReminder");
});
