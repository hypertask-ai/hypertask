const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const jitiModule = require("jiti");

const root = path.join(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const jiti = jitiModule.createJiti
  ? jitiModule.createJiti(__filename, {
      interopDefault: true,
      moduleCache: false,
      alias: { "@": path.join(root, "src") },
    })
  : jitiModule(__filename, {
      interopDefault: true,
      cache: false,
      alias: { "@": path.join(root, "src") },
    });

const { buildCalendarVisibleRange, validateCalendarVisibleRange } = jiti(
  path.join(root, "src/lib/calendarSync/range.ts"),
);
const {
  containsUnsafeCalendarIdentity,
  createCalendarReadModelSnapshot,
  isCalendarReadModelSnapshotV1,
  materializeCalendarReadModelSnapshot,
  shouldReplaceCalendarReadModelSnapshot,
} = jiti(path.join(root, "src/lib/calendarSync/contract.ts"));
const { splitAssignees } = jiti(path.join(root, "src/lib/assignees.ts"));
const {
  beginCalendarAccessRevalidation,
  canRenderCalendarProjection,
  intersectAuthorizedCalendarPayload,
  restrictCalendarPayloadToAccess,
  createCalendarHydrationArbiter,
  CalendarAuthorizationFailure,
  isCalendarAuthorizationFailure,
  resolveCalendarAccessProof,
  settleCalendarAccessSuccess,
  settleCalendarAuthorizationFailure,
  settleCalendarLoadFailure,
} = jiti(path.join(root, "src/lib/calendarSync/clientPolicy.ts"));
const { createSerializedLatestWriteQueue } = jiti(
  path.join(root, "src/lib/calendarSync/writeQueue.ts"),
);
const { canRunCalendarStorageOperation } = jiti(
  path.join(root, "src/lib/calendarSync/storageLifecycle.ts"),
);
const { createCalendarReadinessLatch } = jiti(
  path.join(root, "src/hooks/Calendar/useSyncedCalendarReadModel.ts"),
);

const project = {
  id: 15,
  name: "project-15",
  title: "Hypertask Product",
  members: [{ user: { id: 6, displayName: "Valentin", photoURL: null } }],
  labels: [{ id: "label-15", value: "Calendar", projectId: 15 }],
  _count: { tasks: 1 },
};
const anotherProject = {
  id: 16,
  name: "project-16",
  title: "Second board",
  members: [],
  labels: [],
  _count: { tasks: 1 },
};

const calendarTask = ({ id, projectId, title, dueDate, ...overrides }) => ({
  id,
  uniqueIndex: id,
  ticketNumber: `HTPR-${id}`,
  ranking: "A0200",
  section: "In Progress",
  sectionId: 1,
  title,
  projectId,
  status: "Normal",
  userId: 6,
  createdAt: "2026-08-09T08:00:00.000Z",
  updatedAt: "2026-08-09T09:00:00.000Z",
  dueDate,
  startDate: null,
  recurrence: null,
  deletedAt: null,
  waitingOnUserId: null,
  waitingOnUser: null,
  blockingTasks: [],
  agentId: null,
  updatedByUserIds: [],
  project:
    projectId === 15
      ? { id: 15, name: project.name, title: project.title }
      : projectId === 16
        ? { id: 16, name: anotherProject.name, title: anotherProject.title }
        : { id: projectId, name: `project-${projectId}`, title: "Inaccessible" },
  assignees: [],
  priority: null,
  estimate: null,
  taskLabels: [],
  _count: { comments: 0, savedContent: 0 },
  ...overrides,
});

const payloadFor = (range) => ({
  ...range,
  accountId: 6,
  authorizationRevision: "15.16",
  retrievedAt: "2026-08-09T10:00:00.000Z",
  projects: [project, anotherProject],
  tasks: [
    calendarTask({
      id: 100,
      projectId: 15,
      title: "Recurring range task",
      dueDate: new Date(
        Date.parse(range.startIso) + 12 * 60 * 60 * 1_000,
      ).toISOString(),
      recurrence: "weekly",
    }),
    calendarTask({
      id: 101,
      projectId: 16,
      title: "Second board task",
      dueDate: new Date(
        Date.parse(range.endExclusiveIso) - 12 * 60 * 60 * 1_000,
      ).toISOString(),
    }),
    calendarTask({
      id: 102,
      projectId: 999,
      title: "Inaccessible board task",
      dueDate: new Date(
        Date.parse(range.startIso) + 12 * 60 * 60 * 1_000,
      ).toISOString(),
    }),
    calendarTask({
      id: 103,
      projectId: 15,
      title: "Outside requested range",
      dueDate: range.endExclusiveIso,
    }),
    calendarTask({
      id: 104,
      projectId: 15,
      title: "Interval overlapping requested range",
      startDate: new Date(
        Date.parse(range.startIso) + 12 * 60 * 60 * 1_000,
      ).toISOString(),
      dueDate: new Date(
        Date.parse(range.endExclusiveIso) + 12 * 60 * 60 * 1_000,
      ).toISOString(),
    }),
  ],
});

test("visible ranges preserve local day, week, month, and timezone boundaries", () => {
  const anchor = new Date(2026, 7, 9, 12);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const day = buildCalendarVisibleRange({
    anchor,
    view: "day",
    weekStartsOn: "monday",
    timezone,
  });
  const week = buildCalendarVisibleRange({
    anchor,
    view: "week",
    weekStartsOn: "monday",
    timezone,
  });
  const month = buildCalendarVisibleRange({
    anchor,
    view: "month",
    weekStartsOn: "monday",
    timezone,
  });

  assert.equal(day.rangeStart, "2026-08-09");
  assert.equal(day.rangeEndExclusive, "2026-08-10");
  assert.equal(week.rangeStart, "2026-08-03");
  assert.equal(week.rangeEndExclusive, "2026-08-10");
  assert.equal(month.rangeStart, "2026-07-27");
  assert.equal(month.rangeEndExclusive, "2026-09-07");
  assert.ok(validateCalendarVisibleRange(month));
  assert.equal(
    validateCalendarVisibleRange({ ...month, timezone: "Invalid/Timezone" }),
    null,
  );
});

test("calendar snapshots are account, schema, timezone, range, and expiry scoped", () => {
  const range = buildCalendarVisibleRange({
    anchor: new Date(2026, 7, 9, 12),
    view: "week",
    weekStartsOn: "monday",
  });
  const snapshot = createCalendarReadModelSnapshot({
    payload: payloadFor(range),
    savedAt: "2026-08-09T10:00:00.000Z",
  });
  assert.ok(snapshot);
  assert.equal(Object.hasOwn(snapshot, "tasks"), false);
  assert.equal(Object.hasOwn(snapshot, "projects"), false);
  assert.deepEqual(snapshot.taskOrder, [100, 101, 104]);
  assert.equal(
    isCalendarReadModelSnapshotV1(snapshot, {
      accountId: 6,
      range,
      nowMs: Date.parse("2026-08-09T11:00:00.000Z"),
    }),
    true,
  );
  assert.equal(
    isCalendarReadModelSnapshotV1(snapshot, {
      accountId: 7,
      range,
      nowMs: Date.parse("2026-08-09T11:00:00.000Z"),
    }),
    false,
  );
  assert.equal(
    isCalendarReadModelSnapshotV1(
      { ...snapshot, schemaVersion: 3 },
      { accountId: 6, range, nowMs: Date.parse("2026-08-09T11:00:00.000Z") },
    ),
    false,
  );
  assert.equal(
    isCalendarReadModelSnapshotV1(snapshot, {
      accountId: 6,
      range,
      nowMs: Date.parse("2026-08-10T10:00:00.001Z"),
    }),
    false,
  );
  assert.equal(
    isCalendarReadModelSnapshotV1(
      {
        ...snapshot,
        savedAt: "2099-01-01T00:00:00.000Z",
        expiresAt: "2099-01-02T00:00:00.000Z",
      },
      { accountId: 6, range, nowMs: Date.parse("2026-08-09T11:00:00.000Z") },
    ),
    false,
    "legacy client-clock expiry must be rejected",
  );
  assert.equal(
    materializeCalendarReadModelSnapshot(snapshot).tasks[0].recurrence,
    "weekly",
  );
  assert.ok(
    materializeCalendarReadModelSnapshot(snapshot).tasks[0].dueDate instanceof
      Date,
  );

  const blockedPayload = payloadFor(range);
  blockedPayload.tasks[0] = {
    ...blockedPayload.tasks[0],
    waitingOnUserId: 42,
    waitingOnUser: {
      id: 42,
      displayName: "Jacqueline Bolz",
      photoURL: null,
    },
  };
  const blockedSnapshot = createCalendarReadModelSnapshot({
    payload: blockedPayload,
  });
  assert.ok(blockedSnapshot);
  assert.equal(
    materializeCalendarReadModelSnapshot(blockedSnapshot).tasks[0]
      .waitingOnUser.displayName,
    "Jacqueline Bolz",
  );
  assert.equal(
    createCalendarReadModelSnapshot({
      payload: {
        ...blockedPayload,
        tasks: blockedPayload.tasks.map((task, index) =>
          index === 0
            ? { ...task, waitingOnUser: { ...task.waitingOnUser, id: 43 } }
            : task,
        ),
      },
    }),
    null,
  );

  const taskBlockedPayload = payloadFor(range);
  taskBlockedPayload.tasks[0] = {
    ...taskBlockedPayload.tasks[0],
    blockingTasks: [
      {
        id: 1606,
        projectId: 16,
        uniqueIndex: 1606,
        ticketNumber: "INNE-1606",
        title: "Blocking task",
        status: "Normal",
        section: "In Progress",
      },
    ],
  };
  const taskBlockedSnapshot = createCalendarReadModelSnapshot({
    payload: taskBlockedPayload,
  });
  assert.ok(taskBlockedSnapshot);
  assert.equal(
    materializeCalendarReadModelSnapshot(taskBlockedSnapshot).tasks[0]
      .blockingTasks[0].ticketNumber,
    "INNE-1606",
  );
  assert.equal(
    createCalendarReadModelSnapshot({
      payload: {
        ...taskBlockedPayload,
        tasks: taskBlockedPayload.tasks.map((task, index) =>
          index === 0
            ? {
                ...task,
                blockingTasks: task.blockingTasks.map((blockingTask) => ({
                  ...blockingTask,
                  projectId: 999,
                })),
              }
            : task,
        ),
      },
    }),
    null,
  );

  const forgedProject = { id: 999, name: "revoked", title: "Revoked" };
  assert.equal(
    isCalendarReadModelSnapshotV1({
      ...snapshot,
      projectOrder: [...snapshot.projectOrder, 999],
      projectsById: { ...snapshot.projectsById, 999: forgedProject },
    }),
    false,
  );

  assert.equal(
    isCalendarReadModelSnapshotV1({
      ...snapshot,
      projectsById: {
        ...snapshot.projectsById,
        15: { ...snapshot.projectsById["15"], members: null },
      },
    }),
    false,
  );

  const payloadWithDeletedTask = payloadFor(range);
  payloadWithDeletedTask.tasks[0] = {
    ...payloadWithDeletedTask.tasks[0],
    deletedAt: "2026-08-09T09:00:00.000Z",
  };
  const withoutDeletedTask = createCalendarReadModelSnapshot({
    payload: payloadWithDeletedTask,
  });
  assert.equal(withoutDeletedTask, null);

  const corruptDeletedSnapshot = {
    ...snapshot,
    tasksById: {
      ...snapshot.tasksById,
      100: {
        ...snapshot.tasksById["100"],
        deletedAt: "2026-08-09T09:00:00.000Z",
      },
    },
  };
  assert.equal(isCalendarReadModelSnapshotV1(corruptDeletedSnapshot), false);

  const payloadWithArchivedTask = payloadFor(range);
  payloadWithArchivedTask.tasks[0] = {
    ...payloadWithArchivedTask.tasks[0],
    status: "Archive",
  };
  const withoutArchivedTask = createCalendarReadModelSnapshot({
    payload: payloadWithArchivedTask,
  });
  assert.equal(withoutArchivedTask, null);

  assert.equal(
    isCalendarReadModelSnapshotV1({
      ...snapshot,
      taskOrder: [...snapshot.taskOrder, snapshot.taskOrder[0]],
    }),
    false,
  );
  assert.equal(
    isCalendarReadModelSnapshotV1({
      ...snapshot,
      tasksById: {
        ...snapshot.tasksById,
        999: { ...snapshot.tasksById["100"], id: 999 },
      },
    }),
    false,
  );

  for (const malformedTask of [
    { ...snapshot.tasksById["100"], taskLabels: {} },
    { ...snapshot.tasksById["100"], assignees: {} },
    { ...snapshot.tasksById["100"], assignees: [{}] },
    { ...snapshot.tasksById["100"], updatedByUserIds: {} },
    { ...snapshot.tasksById["100"], _count: { comments: 0 } },
    {
      ...snapshot.tasksById["100"],
      priority: { id: "priority", priority_index: "1", Priority_Value: "High" },
    },
    { ...snapshot.tasksById["100"], project: { id: 15 } },
    {
      ...snapshot.tasksById["100"],
      taskLabels: [
        {
          id: 1,
          taskId: 100,
          labelId: "label-15",
          label: { id: "label-15", value: "Calendar", projectId: 16 },
        },
      ],
    },
  ]) {
    assert.equal(
      isCalendarReadModelSnapshotV1({
        ...snapshot,
        tasksById: { ...snapshot.tasksById, 100: malformedTask },
      }),
      false,
    );
  }
  assert.equal(
    createCalendarReadModelSnapshot({
      payload: { ...payloadFor(range), tasks: {} },
    }),
    null,
  );
});

test("materialized tasks with an absent start date remain persistable", () => {
  const range = buildCalendarVisibleRange({
    anchor: new Date(2026, 7, 9, 12),
    view: "week",
    weekStartsOn: "monday",
  });
  const networkSnapshot = createCalendarReadModelSnapshot({
    payload: payloadFor(range),
    savedAt: "2026-08-09T10:00:00.000Z",
  });
  assert.ok(networkSnapshot);

  const materialized = materializeCalendarReadModelSnapshot(networkSnapshot);
  assert.equal(materialized.tasks[0].startDate, undefined);

  const persistedUndefined = createCalendarReadModelSnapshot({
    payload: materialized,
    savedAt: "2026-08-09T10:01:00.000Z",
  });
  assert.ok(persistedUndefined);
  assert.equal(persistedUndefined.tasksById["100"].startDate, null);

  delete materialized.tasks[0].startDate;

  const persistedAbsent = createCalendarReadModelSnapshot({
    payload: materialized,
    savedAt: "2026-08-09T10:02:00.000Z",
  });
  assert.ok(
    persistedAbsent,
    "the accepted network projection must survive the materialize-to-write round trip",
  );
  assert.equal(persistedAbsent.tasksById["100"].startDate, null);

  const malformed = createCalendarReadModelSnapshot({
    payload: {
      ...materialized,
      tasks: materialized.tasks.map((task, index) =>
        index === 0 ? { ...task, startDate: "not-a-date" } : task,
      ),
    },
  });
  assert.equal(malformed, null, "malformed non-null dates remain rejected");
});

test("server freshness orders cross-tab and skewed-client optimistic writes", () => {
  // These represent fresh server responses, so keep them within the cache TTL
  // regardless of when the test suite happens to run.
  const staleRetrievedAt = new Date(Date.now() - 2 * 60 * 1_000).toISOString();
  const freshRetrievedAt = new Date(Date.now() - 60 * 1_000).toISOString();
  const range = buildCalendarVisibleRange({
    anchor: new Date(2026, 7, 9, 12),
    view: "week",
    weekStartsOn: "monday",
  });
  const stale = createCalendarReadModelSnapshot({
    payload: {
      ...payloadFor(range),
      retrievedAt: staleRetrievedAt,
    },
    savedAt: "2026-08-09T12:00:00.000Z",
  });
  const fresh = createCalendarReadModelSnapshot({
    payload: {
      ...payloadFor(range),
      retrievedAt: freshRetrievedAt,
      tasks: payloadFor(range).tasks.map((task) =>
        task.id === 100 ? { ...task, title: "Authoritative update" } : task,
      ),
    },
    savedAt: "2026-08-09T09:00:00.000Z",
  });
  const optimistic = createCalendarReadModelSnapshot({
    payload: {
      ...payloadFor(range),
      retrievedAt: stale.retrievedAt,
      tasks: payloadFor(range).tasks.map((task) =>
        task.id === 100 ? { ...task, title: "Optimistic update" } : task,
      ),
    },
    savedAt: "2099-01-01T00:00:00.000Z",
  });

  assert.ok(stale);
  assert.ok(fresh);
  assert.ok(optimistic);
  assert.equal(shouldReplaceCalendarReadModelSnapshot(stale, fresh), true);
  assert.equal(shouldReplaceCalendarReadModelSnapshot(fresh, stale), false);
  assert.equal(shouldReplaceCalendarReadModelSnapshot(fresh, fresh), false);
  assert.equal(shouldReplaceCalendarReadModelSnapshot(stale, optimistic), false);

  // Optimistic projections stay in memory; only the later server response is
  // eligible to replace the authoritative IndexedDB snapshot.
  let stored = stale;
  if (shouldReplaceCalendarReadModelSnapshot(stored, fresh)) stored = fresh;
  assert.equal(stored.tasksById["100"].title, "Authoritative update");
  assert.equal(
    optimistic.expiresAt,
    new Date(Date.parse(staleRetrievedAt) + 24 * 60 * 60 * 1_000).toISOString(),
    "a fast client clock must not extend cache expiry",
  );
});

test("persisted identity data is least-privilege and preserves human classification", () => {
  const human = {
    id: 6,
    displayName: "Valentin",
    photoURL: null,
  };
  const agent = { id: "agent-1", displayName: "Desktop", photoURL: null };
  assert.equal(containsUnsafeCalendarIdentity({ user: human, agent }), false);
  assert.equal(
    containsUnsafeCalendarIdentity({ agent: { ...agent, mcpToken: "secret" } }),
    true,
  );
  assert.equal(
    containsUnsafeCalendarIdentity({
      user: { ...human, email: "private@example.com" },
    }),
    true,
  );
  assert.equal(
    containsUnsafeCalendarIdentity({
      user: { ...human, uid: "firebase-user-6" },
    }),
    true,
  );
  assert.equal(
    containsUnsafeCalendarIdentity({
      waitingOnUser: { ...human, email: "private@example.com" },
    }),
    true,
  );

  const classified = splitAssignees([
    { id: 1, userId: 6, user: human },
    { id: 2, agentId: "agent-1", agent },
  ]);
  assert.equal(classified.humanAssignees.length, 1);
  assert.equal(classified.humanAssignees[0].id, 6);
  assert.equal(classified.agentAssignees.length, 1);
  assert.equal(!("uid" in classified.humanAssignees[0]), true);
  assert.equal(!("uid" in classified.agentAssignees[0]), true);
});

test("authoritative replacement removes tasks missing from the next response", () => {
  const range = buildCalendarVisibleRange({
    anchor: new Date(2026, 7, 9, 12),
    view: "week",
    weekStartsOn: "monday",
  });
  const first = createCalendarReadModelSnapshot({ payload: payloadFor(range) });
  const nextPayload = payloadFor(range);
  nextPayload.tasks = nextPayload.tasks.filter((task) => task.id !== 100);
  const next = createCalendarReadModelSnapshot({ payload: nextPayload });

  assert.ok(first);
  assert.ok(next);
  assert.deepEqual(first.taskOrder, [100, 101, 104]);
  assert.deepEqual(next.taskOrder, [101, 104]);
});

test("cache hydration requires current access and failed cold loads settle to retry", () => {
  const range = buildCalendarVisibleRange({
    anchor: new Date(2026, 7, 9, 12),
    view: "week",
    weekStartsOn: "monday",
  });
  const cachedPayload = payloadFor(range);
  cachedPayload.tasks[0].blockingTasks = [
    {
      id: 200,
      projectId: 15,
      uniqueIndex: 200,
      ticketNumber: "HTPR-200",
      title: "Same-board blocker",
      status: "Normal",
      section: "In Progress",
    },
    {
      id: 201,
      projectId: 16,
      uniqueIndex: 201,
      ticketNumber: "HTPR-201",
      title: "Revoked-board blocker",
      status: "Normal",
      section: "In Progress",
    },
  ];
  const cached = materializeCalendarReadModelSnapshot(
    createCalendarReadModelSnapshot({ payload: cachedPayload }),
  );
  assert.equal(
    intersectAuthorizedCalendarPayload(cached, {
      accountId: 6,
      projectIds: [15],
      authorizationRevision: "15",
    }),
    null,
  );

  const defenseInDepth = intersectAuthorizedCalendarPayload(
    { ...cached, authorizationRevision: "15" },
    { accountId: 6, projectIds: [15], authorizationRevision: "15" },
  );
  assert.ok(defenseInDepth);
  assert.deepEqual(
    defenseInDepth.projects.map((item) => item.id),
    [15],
  );
  assert.deepEqual(
    defenseInDepth.tasks.map((item) => item.id),
    [100, 104],
  );
  assert.deepEqual(
    defenseInDepth.tasks.find((item) => item.id === 100).blockingTasks.map(
      (blockingTask) => blockingTask.projectId,
    ),
    [15],
  );

  const revokedDuringReconciliation = restrictCalendarPayloadToAccess(cached, {
    accountId: 6,
    projectIds: [15],
    authorizationRevision: "15",
  });
  assert.ok(revokedDuringReconciliation);
  assert.equal(revokedDuringReconciliation.authorizationRevision, "15");
  assert.deepEqual(
    revokedDuringReconciliation.projects.map((item) => item.id),
    [15],
  );
  assert.deepEqual(
    revokedDuringReconciliation.tasks.map((item) => item.id),
    [100, 104],
  );
  assert.deepEqual(
    revokedDuringReconciliation.tasks.find((item) => item.id === 100)
      .blockingTasks.map((blockingTask) => blockingTask.projectId),
    [15],
  );

  assert.deepEqual(
    beginCalendarAccessRevalidation(
      { rangeKey: "week", status: "ready" },
      "week",
    ),
    { rangeKey: "week", status: "pending" },
  );
  const projectionGate = {
    projectionAccountId: 6,
    currentAccountId: 6,
    projectionRangeKey: "week",
    activeRangeKey: "week",
  };
  assert.equal(
    canRenderCalendarProjection({
      ...projectionGate,
      loadState: { rangeKey: "week", status: "pending" },
    }),
    false,
    "a hung access proof keeps the previous projection hidden",
  );
  assert.equal(
    canRenderCalendarProjection({
      ...projectionGate,
      loadState: { rangeKey: "week", status: "error" },
    }),
    false,
    "a failed access proof keeps the previous projection hidden",
  );
  assert.equal(
    canRenderCalendarProjection({
      ...projectionGate,
      currentAccountId: 7,
      loadState: { rangeKey: "week", status: "ready" },
    }),
    false,
    "another account can never render the retained projection",
  );
  assert.equal(
    canRenderCalendarProjection({
      ...projectionGate,
      loadState: { rangeKey: "week", status: "ready" },
    }),
    true,
  );
  const restoredAfterAccess = settleCalendarAccessSuccess(
    { rangeKey: "week", status: "pending" },
    "week",
    true,
  );
  assert.deepEqual(restoredAfterAccess, {
    rangeKey: "week",
    status: "ready",
  });
  assert.deepEqual(
    settleCalendarLoadFailure(restoredAfterAccess, "week"),
    restoredAfterAccess,
    "a payload failure retains the access-reauthorized projection",
  );
  assert.deepEqual(
    beginCalendarAccessRevalidation(restoredAfterAccess, "week"),
    { rangeKey: "week", status: "pending" },
    "an authorization mismatch hides the projection again before retry",
  );

  assert.deepEqual(
    settleCalendarLoadFailure({ rangeKey: "week", status: "pending" }, "week"),
    { rangeKey: "week", status: "error" },
  );
  assert.deepEqual(
    settleCalendarLoadFailure({ rangeKey: "week", status: "ready" }, "week"),
    { rangeKey: "week", status: "ready" },
  );

  assert.deepEqual(
    settleCalendarAuthorizationFailure(
      { rangeKey: "week", status: "ready" },
      "week",
    ),
    { rangeKey: "week", status: "error" },
  );
  assert.deepEqual(
    settleCalendarAuthorizationFailure(
      { rangeKey: "month", status: "ready" },
      "week",
    ),
    { rangeKey: "month", status: "ready" },
  );

  const forbidden = new CalendarAuthorizationFailure(
    "Calendar access check failed (403)",
    403,
  );
  assert.equal(isCalendarAuthorizationFailure(forbidden), true);
  assert.equal(forbidden.status, 403);
  assert.equal(isCalendarAuthorizationFailure(new Error("temporary")), false);
});

test("a newer authoritative access proof permanently closes late cache hydration", async () => {
  const arbiter = createCalendarHydrationArbiter();
  let releaseLateCache;
  const lateCacheRead = new Promise((resolve) => {
    releaseLateCache = resolve;
  }).then(() => arbiter.canHydrateFromCache());

  assert.equal(arbiter.canHydrateFromCache(), true);
  arbiter.observeAuthoritativeAccess();
  releaseLateCache();
  assert.equal(await lateCacheRead, false);
  assert.equal(arbiter.canHydrateFromCache(), false);
});

test("cache hydration and first reconciliation share one ordered access proof", async () => {
  let releaseInitialProof;
  let laterFetches = 0;
  const initialProof = new Promise((resolve) => {
    releaseInitialProof = resolve;
  });
  const hydrationProof = initialProof;
  const reconciliationProof = resolveCalendarAccessProof({
    attempt: 0,
    initialProof,
    fetchProof: async () => {
      laterFetches += 1;
      return { authorizationRevision: "stale-broader-proof" };
    },
  });

  assert.equal(reconciliationProof, hydrationProof);
  assert.equal(laterFetches, 0);
  releaseInitialProof({ authorizationRevision: "current-narrow-proof" });
  assert.deepEqual(await hydrationProof, await reconciliationProof);

  const retryProof = await resolveCalendarAccessProof({
    attempt: 1,
    initialProof,
    fetchProof: async () => {
      laterFetches += 1;
      return { authorizationRevision: "later-proof" };
    },
  });
  assert.equal(laterFetches, 1);
  assert.equal(retryProof.authorizationRevision, "later-proof");
});

test("range writes serialize so authoritative data wins despite client clock skew", async () => {
  const queue = createSerializedLatestWriteQueue();
  const order = [];
  let storedSource = null;
  let releaseOptimistic;
  let markOptimisticStarted;
  const optimisticGate = new Promise((resolve) => {
    releaseOptimistic = resolve;
  });
  const optimisticStarted = new Promise((resolve) => {
    markOptimisticStarted = resolve;
  });

  const optimistic = queue.enqueue("range", async () => {
    order.push("optimistic:start");
    markOptimisticStarted();
    await optimisticGate;
    storedSource = "optimistic-client-clock-ahead";
    order.push("optimistic:end");
    return "2026-08-10T12:00:00.000Z";
  });
  await optimisticStarted;

  const authoritative = queue.enqueue("range", async () => {
    order.push("authoritative:start");
    storedSource = "authoritative-server-clock-behind";
    order.push("authoritative:end");
    return "2026-08-09T12:00:00.000Z";
  });

  assert.deepEqual(order, ["optimistic:start"]);
  releaseOptimistic();
  assert.equal(await optimistic, "2026-08-10T12:00:00.000Z");
  assert.equal(await authoritative, "2026-08-09T12:00:00.000Z");
  assert.equal(storedSource, "authoritative-server-clock-behind");
  assert.deepEqual(order, [
    "optimistic:start",
    "optimistic:end",
    "authoritative:start",
    "authoritative:end",
  ]);
});

test("cache cleanup is serialized without superseding a fresh per-range write", async () => {
  const queue = createSerializedLatestWriteQueue();
  const order = [];
  let releaseBlocker;
  let markBlockerStarted;
  const blockerGate = new Promise((resolve) => {
    releaseBlocker = resolve;
  });
  const blockerStarted = new Promise((resolve) => {
    markBlockerStarted = resolve;
  });

  const blocker = queue.enqueue("range", async () => {
    order.push("blocker");
    markBlockerStarted();
    await blockerGate;
  });
  await blockerStarted;
  const cleanup = queue.enqueueMaintenance("range", async () => {
    order.push("cleanup");
  });
  const freshWrite = queue.enqueue("range", async () => {
    order.push("fresh-write");
  });

  releaseBlocker();
  await Promise.all([blocker, cleanup, freshWrite]);
  assert.deepEqual(order, ["blocker", "cleanup", "fresh-write"]);
});

test("corruption cleanup cannot continue after logout advances storage generation", () => {
  assert.equal(
    canRunCalendarStorageOperation({
      startedGeneration: 4,
      currentGeneration: 4,
      operationsDisabled: false,
    }),
    true,
  );
  assert.equal(
    canRunCalendarStorageOperation({
      startedGeneration: 4,
      currentGeneration: 5,
      operationsDisabled: true,
    }),
    false,
  );
  assert.equal(
    canRunCalendarStorageOperation({
      startedGeneration: 5,
      currentGeneration: 5,
      operationsDisabled: true,
    }),
    false,
  );
});

test("Calendar readiness is claimed only once per mount latch", () => {
  const latch = createCalendarReadinessLatch();

  assert.equal(latch.claim(), true);
  assert.equal(latch.claim(), false);
  assert.equal(latch.claim(), false);
});

test("Calendar integrates cache-first hydration, authoritative reconciliation, realtime, metrics, rollback, and logout cleanup", () => {
  const page = read("src/app/calendar/page.tsx");
  const serverUser = read("src/lib/auth/serverUser.ts");
  const hook = read("src/hooks/Calendar/useSyncedCalendarReadModel.ts");
  const realtime = read("src/hooks/realtime/useCalendarRealtime.ts");
  const calendarView = read("src/hooks/Calendar/useCalendarView.ts");
  const calendarPage = read("src/components/PageComponents/Calendar/index.tsx");
  const taskCard = read("src/components/PageComponents/Calendar/task-card.tsx");
  const indexedDb = read("src/lib/calendarSync/indexedDbReadModel.ts");
  const signout = read("src/hooks/MultiPages/HTC/useSignout.ts");
  const localReadModelCleanup = read("src/lib/localReadModels/clear.ts");
  const route = read("src/app/api/calendar/read-model/route.ts");
  const accessRoute = read("src/app/api/calendar/access/route.ts");
  const controller = read("src/utils/controllers/tasks/calendarReadModel.ts");
  const contract = read("src/lib/calendarSync/contract.ts");
  const filterPicker = read(
    "src/components/Modals/FilterModals/SelectFilters/FilterHTC.tsx",
  );
  const userPicker = read("src/components/Modals/UserSelectionModal.tsx");
  const taskTopRow = read(
    "src/components/PageComponents/Kanban/KanbanTaskComponents/TaskTopRow.tsx",
  );
  const optimisticProjectionBlock = hook.slice(
    hook.indexOf("const updateTaskProjection"),
    hook.indexOf("const accountProjection"),
  );

  assert.doesNotMatch(page, /getRecentTasks/);
  assert.match(page, /await requireServerCookieUser\(\)/);
  assert.doesNotMatch(page, /JSON\.parse|nookies_user/);
  assert.match(serverUser, /const id = Number\(parsed\?\.id\)/);
  assert.match(serverUser, /!parsed \|\| !Number\.isFinite\(id\)/);
  assert.match(page, /CalendarProvider accountId=\{userObj\.id\}/);
  assert.doesNotMatch(calendarView, /currentUserAtom|currentUser\.id/);
  assert.match(calendarView, /isTaskAssignedToMe\(task, accountId\)/);
  assert.match(hook, /fetchCalendarAccess\(controller\.signal\)/);
  assert.match(hook, /access\.authorizationRevision/);
  assert.match(hook, /intersectAuthorizedCalendarPayload/);
  assert.match(hook, /fetchCalendarPayload/);
  assert.match(hook, /writeCalendarReadModel\(payload\)/);
  assert.match(hook, /app_calendar_readiness/);
  assert.match(hook, /calendar_measurement_version: 1 as const/);
  assert.match(hook, /local_outcome: localOutcome/);
  assert.match(hook, /const readinessLatch = createCalendarReadinessLatch\(\)/);
  assert.match(
    hook,
    /if \(emitReadiness && readinessLatch\?\.claim\(\)\) \{[\s\S]*?readinessProperties\(\s*range,\s*"network",[\s\S]*?readinessLocalOutcome\?\.current \?\? "none"/,
  );
  assert.match(
    hook,
    /if \(readinessLatch\.claim\(\)\) \{[\s\S]*?readinessProperties\(\s*range,\s*"indexeddb",[\s\S]*?"none"/,
  );
  assert.match(
    hook,
    /else \{\s*readinessLocalOutcome\.current = "miss";\s*\}/,
  );
  assert.match(
    hook,
    /\.catch\(\(error\) => \{\s*if \(!controller\.signal\.aborted\) \{\s*readinessLocalOutcome\.current = "error";/,
  );
  assert.doesNotMatch(hook, /readinessProperties\([\s\S]*?"indexeddb_miss"/);
  assert.match(hook, /app_calendar_reconciliation/);
  assert.match(hook, /resolveCalendarTimezone/);
  assert.match(hook, /visibilitychange/);
  assert.match(
    hook,
    /const revalidateWhenVisible[\s\S]*?reconcile\("focus"\)/,
  );
  assert.match(
    hook,
    /window\.addEventListener\("focus", revalidateWhenVisible\)/,
  );
  assert.match(hook, /getBoardSyncPilotEnabled/);
  assert.match(hook, /initialAccessPromise/);
  assert.match(hook, /resolveCalendarAccessProof/);
  assert.doesNotMatch(optimisticProjectionBlock, /writeCalendarReadModel/);
  assert.doesNotMatch(
    optimisticProjectionBlock,
    /retrievedAt: new Date\(\)\.toISOString\(\)/,
  );
  assert.match(realtime, /reconcileRef\.current\("realtime"\)/);
  assert.match(calendarView, /reconcileCalendar\("manual"\)/);
  assert.match(calendarPage, /isCalendarDataPending/);
  assert.match(calendarPage, /calendarDataError/);
  assert.match(calendarPage, /retryCalendarData/);
  assert.match(calendarPage, /role="alert"/);
  assert.match(indexedDb, /BroadcastChannel/);
  assert.match(indexedDb, /database\.onversionchange/);
  assert.match(indexedDb, /await writeQueue\.enqueueMaintenance/);
  assert.match(indexedDb, /snapshotFingerprint\(currentSnapshot\)/);
  assert.match(indexedDb, /await requestValue\(store\.get\(snapshot\.key\)\)/);
  assert.match(
    indexedDb,
    /shouldReplaceCalendarReadModelSnapshot\(existing, snapshot\)/,
  );
  assert.match(indexedDb, /Date\.parse\(right\.retrievedAt\)/);
  assert.match(indexedDb, /operationCanRun\(startedGeneration\)/);
  assert.match(indexedDb, /createSerializedLatestWriteQueue/);
  assert.doesNotMatch(
    indexedDb,
    /existing\.retrievedAt[\s\S]*snapshot\.retrievedAt/,
  );
  assert.match(indexedDb, /MAX_RANGES_PER_ACCOUNT/);
  assert.match(signout, /clearAllLocalReadModels/);
  assert.match(localReadModelCleanup, /clearBoardReadModels/);
  assert.match(localReadModelCleanup, /clearInboxReadModels/);
  assert.match(localReadModelCleanup, /clearCalendarReadModels/);
  assert.match(localReadModelCleanup, /results\.every\(Boolean\)/);
  assert.match(route, /Cache-Control": "private, no-store/);
  assert.match(route, /validateCalendarVisibleRange/);
  assert.match(route, /containsUnsafeCalendarIdentity/);
  assert.match(accessRoute, /getCalendarAccessibleProjectIds/);
  assert.doesNotMatch(controller, /agent:\s*true/);
  assert.doesNotMatch(controller, /user:\s*true/);
  assert.doesNotMatch(controller, /members:\s*\{\s*include/);
  assert.doesNotMatch(controller, /uid:\s*true/);
  assert.doesNotMatch(controller, /followers:\s*\{/);
  assert.doesNotMatch(
    controller,
    /savedContent:\s*\{\s*where:\s*\{ userId, commentId: null \},\s*select:/,
  );
  assert.match(
    controller,
    /savedContent:\s*\{\s*where:\s*\{ userId, commentId: null \}/,
  );
  assert.match(taskCard, /task\._count\?\.savedContent/);
  assert.match(taskCard, /task\.waitingOnUser \?\? undefined/);
  assert.doesNotMatch(
    taskCard,
    /members\.find\([\s\S]*?waitingOnUserId/,
  );
  assert.match(controller, /buildCalendarTaskOverlapWhere\(start, endExclusive\)/);
  assert.match(
    controller,
    /calendarTaskOverlapsRange\(task, start, endExclusive\)/,
  );
  assert.match(controller, /attachOpenBlockingTasks\(authorizedTasks\)/);
  assert.match(controller, /attachWaitingOnUsers\(tasksWithOpenBlockers\)/);
  assert.match(
    controller,
    /members:\s*\{\s*some:\s*\{\s*userId, status: "Accepted"/,
  );
  assert.match(
    controller,
    /project:\s*\{\s*is: calendarAccessibleProjectWhere\(userId\)/,
  );
  assert.match(
    controller,
    /project:[\s\S]*status: "Normal",[\s\S]*deletedAt: null/,
  );
  assert.match(controller, /safeAgentSelect/);
  assert.match(
    controller,
    /comments: \{[\s\S]*?OR: \[[\s\S]*?creatorId: \{ not: null \}[\s\S]*?agentId: \{ not: null \}/,
  );
  assert.doesNotMatch(controller, /comments: true/);
  assert.match(controller, /owner: \{ select: safeUserSelect \}/);
  assert.match(controller, /user\.id !== project\.owner\.id/);
  assert.doesNotMatch(controller, /projects as unknown as IProject\[\]/);
  assert.match(controller, /CalendarProjectV1\[\]/);
  assert.match(contract, /isCalendarProjectV1/);
  assert.doesNotMatch(filterPicker, /!\("uid" in value\)/);
  assert.match(filterPicker, /typeof value\.id === "string"/);
  assert.match(userPicker, /typeof entry\.id === "string"/);
  assert.match(taskTopRow, /task\._count\?\.savedContent/);
  assert.match(hook, /createCalendarHydrationArbiter/);
  assert.match(
    hook,
    /currentWaitingOnUser\?\.id === task\.waitingOnUserId/,
  );
  assert.match(hook, /observeAuthoritativeAccess/);
  assert.match(hook, /settleCalendarAuthorizationFailure/);
  assert.match(hook, /updateProjection\(\(current\)[\s\S]*?\? null\s*:\s*current/);
  assert.match(hook, /attempt < 2/);
  assert.match(hook, /restrictCalendarPayloadToAccess/);
  assert.ok(
    hook.indexOf("onAuthoritativeAccessObserved?.()") <
      hook.indexOf("payload = intersectAuthorizedCalendarPayload"),
  );
  const reconciliationLoop = hook.slice(
    hook.indexOf("for (let attempt = 0"),
    hook.indexOf("if (!payload)"),
  );
  assert.ok(
    reconciliationLoop.indexOf("await fetchCalendarAccess") <
      reconciliationLoop.indexOf("await candidateResult"),
  );
  assert.ok(
    reconciliationLoop.indexOf("restrictCalendarPayloadToAccess") <
      reconciliationLoop.indexOf("await candidateResult"),
  );
});
