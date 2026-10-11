const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const flagKey = "htpr-7064-inbox-remind-returns";
const fallbackFlagKey = "htpr-7061-remind-without-inbox";
let entryId = 0;

function matchesWhere(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (key === "AND") return value.every((part) => matchesWhere(row, part));
    if (key === "OR") return value.some((part) => matchesWhere(row, part));
    if (key === "NOT") return !matchesWhere(row, value);
    if (value && typeof value === "object") {
      if ("not" in value) return row[key] !== value.not;
      if ("in" in value) return value.in.includes(row[key]);
      if ("every" in value) return row[key].every((part) => matchesWhere(part, value.every));
      return row[key] != null && matchesWhere(row[key], value);
    }
    return row[key] === value;
  });
}

function fixture({ enabled = true, fallbackEnabled = true, existing = true, muted = false, siblings = false, taskStatus = "Normal" } = {}) {
  let access = true;
  const rows = existing ? [{
    id: 10, userId: 7, agentId: null, taskId: 99, projectId: 15,
    type: "TaskMovedToInbox", status: "Normal", seen: true, archivedAt: null,
    fromUserId: 7, fromAgentId: null, createdAt: new Date("2026-10-10T11:00:00Z"),
  }] : [];
  if (siblings) rows.unshift({ ...rows[0], id: 9, createdAt: new Date("2026-10-10T10:00:00Z") });
  const calls = { created: [], updated: [], flags: [], snoozes: [], scheduled: [] };
  let saved;
  let now = new Date();
  const remindAt = new Date(now.getTime() + 180_000);
  const assignment = { snoozeUntil: null };
  const projectWhere = {
    AND: [
      { OR: [{ members: { some: { userId: 7, agentId: null } } }, { ownerId: 7 }] },
      { projectMutes: { none: { userId: 7 } } },
    ],
  };
  const database = {
    $transaction: async (callback) => callback(database),
    $executeRaw: async () => {},
    $queryRaw: async (strings) => {
      assert.match(strings.join("?"), /r\."remindAt" <= now\(\)/);
      if (!saved || saved.status !== "Normal" || saved.remindAt > now) return [];
      saved.status = "Archive";
      return [{ ...saved }];
    },
    reminder: {
      findMany: async () => saved ? [saved] : [],
      create: async ({ data }) => (saved = { id: 1, status: "Normal", createdAt: now, ...data }),
      updateMany: async ({ where, data }) => {
        if (!saved || !matchesWhere(saved, where)) return { count: 0 };
        Object.assign(saved, data);
        return { count: 1 };
      },
    },
    notification: {
      updateMany: async ({ where, data }) => {
        for (const row of rows.filter((row) => matchesWhere(row, where))) Object.assign(row, data);
      },
      findMany: async ({ where, orderBy, distinct, take }) => {
        assert.equal(where.userId, 7);
        assert.equal(where.taskId, 99);
        assert.equal(where.projectId, 15);
        assert.deepEqual(where.project, projectWhere);
        assert.deepEqual(orderBy, { createdAt: "desc" });
        assert.deepEqual(distinct, ["type"]);
        assert.equal(take, 1);
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
          id: 99, projectId: 15, status: { not: "Deleted" }, project: projectWhere,
          notifications: { none: { userId: 7 } },
        });
        assert.deepEqual(select, { id: true });
        return access && !muted && rows.length === 0 ? { id: 99 } : null;
      },
    },
    assignees: {
      updateMany: async ({ where, data }) => {
        assert.deepEqual(where, { userId: 7, taskId: 99, agentId: null });
        calls.snoozes.push(data);
        Object.assign(assignment, data);
        return { count: 1 };
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
    HTPR_7064_INBOX_REMIND_RETURNS_FLAG: flagKey,
    HTPR_7061_REMIND_WITHOUT_INBOX_FLAG: fallbackFlagKey,
    MY_TASKS_SNOOZE_FLAG: "htpr-6461-my-tasks-snooze",
    isFeatureEnabled: async (key, userId) => {
      calls.flags.push({ key, userId });
      if (key === flagKey) return enabled;
      if (key === fallbackFlagKey) return fallbackEnabled;
      return key === "htpr-6461-my-tasks-snooze";
    },
  });
  stub("src/utils/controllers/tasks/assertTaskAccess.ts", { userCanAccessTask: async () => access });
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
  for (const relativePath of [
    "src/pages/api/queues/inboxReminder.ts",
    "src/utils/controllers/reminders/invokeReminder.ts",
    "src/utils/controllers/tasks/myTasksSnooze.ts",
  ]) delete require.cache[path.join(root, relativePath)];
  const jiti = require("jiti")(path.join(root, `tests/jiti-remind-7064-${++entryId}.cjs`), {
    interopDefault: true, alias: { "@": path.join(root, "src") }, cache: false,
  });
  const handler = jiti(path.join(root, "src/pages/api/queues/inboxReminder.ts")).default;
  const { default: invokeReminder, invokeDueReminder } = jiti(path.join(root, "src/utils/controllers/reminders/invokeReminder.ts"));
  const { visibleUserInboxWhere } = jiti(path.join(root, "src/utils/controllers/notifications/visibleInboxScope.ts"));
  const scope = visibleUserInboxWhere(7);
  return {
    rows, calls, assignment, remindAt,
    visible: () => rows.filter((row) => matchesWhere({ ...row, task: { status: taskStatus, Reminders: saved ? [saved] : [] } }, scope)),
    async schedule() {
      const response = { statusCode: 0, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
      await handler({ headers: {}, body: { taskId: 99, userId: 7, projectId: 15, remindAt: remindAt.toISOString() } }, response);
      return response;
    },
    fire: () => invokeDueReminder(calls.scheduled[0]),
    fireCondition: () => invokeReminder(calls.scheduled[0]),
    advance: () => { now = remindAt; },
    revokeAccess: () => { access = false; },
  };
}

for (const taskStatus of ["Normal", "Archive"]) {
  test(`Inbox Remind restores one visible item on a ${taskStatus} task and preserves My Tasks snooze`, async () => {
    const f = fixture({ taskStatus, siblings: true });
    assert.equal((await f.schedule()).statusCode, 200);
    assert.ok(f.rows.every((row) => row.status === "Archive" && row.archivedAt instanceof Date));
    assert.equal(f.visible().length, 0);
    assert.deepEqual(f.assignment.snoozeUntil, f.remindAt);
    assert.equal(await f.fire(), "skipped");
    f.advance();
    assert.equal(await f.fire(), "invoked");
    assert.deepEqual(f.visible().map((row) => row.id), [10]);
    assert.equal(f.rows[1].archivedAt, null);
    assert.equal(f.rows[1].seen, false);
    assert.equal(f.rows[1].returnedFromReminders, true);
    assert.equal(f.assignment.snoozeUntil, null);
    assert.deepEqual(f.calls.snoozes, [{ snoozeUntil: f.remindAt }, { snoozeUntil: null }]);
    assert.equal(f.calls.created.length, 0);
    assert.ok(f.rows[0].archivedAt instanceof Date, "older sibling stays archived");
    assert.deepEqual(f.calls.flags.find(({ key }) => key === flagKey), { key: flagKey, userId: 7 });
    assert.equal(await f.fire(), "skipped");
    assert.equal(f.calls.updated.length, 1);
    assert.equal(f.rows.length, 2);
    assert.equal(f.visible().length, 1);
  });
}

test("flag off retains the archive timestamp and old restore payload", async () => {
  const f = fixture({ enabled: false });
  await f.schedule();
  const archivedAt = f.rows[0].archivedAt;
  f.advance();
  assert.equal(await f.fire(), "invoked");
  assert.deepEqual(f.calls.updated, [{ where: { id: 10 }, data: { status: "Normal", returnedFromReminders: true, seen: false } }]);
  assert.equal(f.rows[0].archivedAt, archivedAt);
  assert.equal(f.visible().length, 0);
  assert.equal(f.rows.length, 1);
  assert.equal(f.assignment.snoozeUntil, null);
});

for (const scenario of ["no access", "muted project"]) {
  test(`${scenario} does not restore or duplicate an archived notification`, async () => {
    const f = fixture({ muted: scenario === "muted project" });
    await f.schedule();
    if (scenario === "no access") f.revokeAccess();
    const before = { ...f.rows[0] };
    f.advance();
    assert.equal(await f.fire(), "invoked");
    assert.deepEqual(f.rows, [before]);
    assert.equal(f.calls.updated.length, 0);
    assert.equal(f.calls.created.length, 0);
    assert.equal(f.visible().length, 0);
  });
}

for (const enabled of [true, false]) {
  test(`7061 no-item fallback still creates one visible reminder with 7064 ${enabled ? "on" : "off"}`, async () => {
    const f = fixture({ existing: false, enabled });
    await f.schedule();
    f.advance();
    assert.equal(await f.fire(), "invoked");
    assert.equal(f.rows.length, 1);
    assert.equal(f.rows[0].type, "TaskReminder");
    assert.equal(f.rows[0].archivedAt, null);
    assert.equal(f.visible().length, 1);
    assert.equal(await f.fire(), "skipped");
    assert.equal(f.calls.created.length, 1);
  });
}

test("7064 does not enable the no-item fallback when the 7061 flag is off", async () => {
  const f = fixture({ existing: false, fallbackEnabled: false });
  await f.schedule();
  f.advance();
  await f.fire();
  assert.equal(f.rows.length, 0);
});

test("condition-triggered reminder also clears archivedAt exactly once", async () => {
  const f = fixture();
  await f.schedule();
  assert.equal(await f.fireCondition(), "invoked");
  assert.equal(f.rows[0].archivedAt, null);
  assert.equal(f.visible().length, 1);
  assert.equal(await f.fireCondition(), "skipped");
  assert.equal(f.calls.updated.length, 1);
  assert.equal(f.calls.created.length, 0);
});
