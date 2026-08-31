const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.join(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const jiti = createJiti(__filename, {
  interopDefault: true,
  moduleCache: false,
  alias: { "@": path.join(root, "src") },
});

const {
  createInboxReadModelSnapshot,
  filterInboxReadModelByProjectAccess,
  INBOX_READ_MODEL_TTL_MS,
  INBOX_READ_MODEL_SCHEMA_VERSION,
  isInboxReadModelSnapshotV1,
  materializeInboxReadModelSnapshot,
} = jiti(path.join(root, "src/lib/inboxSync/contract.ts"));
const {
  clearInboxReadModelRevisionStorage,
  compareInboxReadModelRevisions,
  createInboxReadModelRevision,
  currentInboxReadModelRevision,
  inboxRevisionStorageAvailable,
  isInboxReadModelRevision,
  observeInboxReadModelRevision,
  reserveInboxReadModelRevision,
} = jiti(path.join(root, "src/lib/inboxSync/revision.ts"));
const {
  applyInboxReadModelMutation,
  createInboxRemovalMutation,
  findInboxRestoreIndex,
} = jiti(path.join(root, "src/lib/inboxSync/mutation.ts"));
const { updateInboxOptimistically } = jiti(
  path.join(root, "src/lib/inboxSync/optimistic.ts"),
);
const { createInboxReadinessLatch } = jiti(
  path.join(root, "src/hooks/Inbox/useGetNotifications.ts"),
);

const revision = (operationTime, tabId = "a".repeat(32), previousRevision) =>
  createInboxReadModelRevision({ operationTime, tabId, previousRevision });

const savedAt = "2026-08-09T12:00:00.000Z";
const accountId = 6;
const notification = (id, overrides = {}) => ({
  id: String(id),
  userId: accountId,
  taskId: 100 + Number(id),
  projectId: 15,
  type: "Comment",
  status: "Normal",
  seen: false,
  createdAt: savedAt,
  project: { id: 15, title: "Speed", name: "Speed", teamId: 1 },
  task: {
    id: 100 + Number(id),
    projectId: 15,
    title: `task-${id}`,
    status: "Normal",
    ticketNumber: `HTPR-${id}`,
  },
  title: `notification-${id}`,
  ...overrides,
});

test("the v1 Inbox snapshot is account scoped, expiring, and normalized", () => {
  const duplicate = notification(10, { title: "newest" });
  const snapshot = createInboxReadModelSnapshot({
    accountId,
    savedAt,
    ttlMs: 60_000,
    payload: {
      revision: revision(1_000),
      notifications: [
        notification(10),
        duplicate,
        notification(11, { userId: accountId + 1 }),
        notification(-12, { waitingOnSynthetic: true }),
      ],
      splitsNoImportant: ["system:@Mentions", "system:@Mentions", "bad"],
      showImportantSplit: true,
    },
  });

  assert.ok(snapshot);
  assert.equal(snapshot.revision, revision(1_000));
  assert.deepEqual(snapshot.notificationOrder, ["10"]);
  assert.equal(snapshot.notificationsById["10"].title, "newest");
  assert.deepEqual(snapshot.splitsNoImportant, ["system:@Mentions"]);
  assert.equal(snapshot.showImportantSplit, true);
  assert.equal(
    isInboxReadModelSnapshotV1(snapshot, accountId, Date.parse(savedAt) + 1),
    true,
  );
  assert.equal(
    isInboxReadModelSnapshotV1(
      snapshot,
      accountId + 1,
      Date.parse(savedAt) + 1,
    ),
    false,
  );
  const materialized = materializeInboxReadModelSnapshot(snapshot);
  assert.deepEqual(materialized.notifications, [duplicate]);
  assert.deepEqual(materialized.splitsNoImportant, ["system:@Mentions"]);
  assert.equal(materialized.showImportantSplit, true);
});

test("projectless invitations remain network-only", () => {
  const invite = notification(12, {
    type: "Invited",
    taskId: null,
    task: undefined,
    projectId: null,
    project: undefined,
    notification_invite: { inviteURL: "/invite/speed" },
  });
  const snapshot = createInboxReadModelSnapshot({
    accountId,
    savedAt,
    ttlMs: 60_000,
    payload: {
      revision: revision(1_500),
      notifications: [invite],
      splitsNoImportant: [],
      showImportantSplit: false,
    },
  });

  assert.ok(snapshot);
  assert.deepEqual(snapshot.notificationOrder, []);
  assert.equal(
    isInboxReadModelSnapshotV1(snapshot, accountId, Date.parse(savedAt) + 1),
    true,
  );
});

test("expired, corrupt, duplicate, and schema-mismatched snapshots fail closed", () => {
  const snapshot = createInboxReadModelSnapshot({
    accountId,
    savedAt,
    ttlMs: 60_000,
    payload: {
      revision: revision(2_000),
      notifications: [notification(10)],
      splitsNoImportant: [],
      showImportantSplit: false,
    },
  });
  assert.ok(snapshot);
  assert.equal(
    isInboxReadModelSnapshotV1(
      snapshot,
      accountId,
      Date.parse(savedAt) + 60_000,
    ),
    false,
  );
  assert.equal(
    isInboxReadModelSnapshotV1(
      {
        ...snapshot,
        schemaVersion: INBOX_READ_MODEL_SCHEMA_VERSION + 1,
      },
      accountId,
      Date.parse(savedAt) + 1,
    ),
    false,
  );
  assert.equal(
    isInboxReadModelSnapshotV1(
      { ...snapshot, notificationOrder: ["10", "10"] },
      accountId,
      Date.parse(savedAt) + 1,
    ),
    false,
  );
  assert.equal(
    isInboxReadModelSnapshotV1(
      { ...snapshot, notificationsById: {} },
      accountId,
      Date.parse(savedAt) + 1,
    ),
    false,
  );
  assert.equal(
    isInboxReadModelSnapshotV1(
      {
        ...snapshot,
        notificationsById: {
          ...snapshot.notificationsById,
          10: { id: "10", userId: accountId },
        },
      },
      accountId,
      Date.parse(savedAt) + 1,
    ),
    false,
  );
  assert.equal(
    isInboxReadModelSnapshotV1(
      {
        ...snapshot,
        savedAt: new Date(Date.parse(savedAt) + 2).toISOString(),
      },
      accountId,
      Date.parse(savedAt) + 1,
    ),
    false,
  );
  assert.equal(
    isInboxReadModelSnapshotV1(
      {
        ...snapshot,
        expiresAt: new Date(
          Date.parse(snapshot.savedAt) + INBOX_READ_MODEL_TTL_MS + 1,
        ).toISOString(),
      },
      accountId,
      Date.parse(savedAt) + 1,
    ),
    false,
  );
  assert.equal(
    isInboxReadModelSnapshotV1(
      { ...snapshot, expiresAt: snapshot.savedAt },
      accountId,
      Date.parse(savedAt) - 1,
    ),
    false,
  );
});

test("cache revisions are ordered and unique across tabs", () => {
  assert.equal(inboxRevisionStorageAvailable(accountId), false);
  const firstTab = revision(3_000, "a".repeat(32));
  const secondTab = revision(3_000, "b".repeat(32));
  const nextInFirstTab = revision(3_000, "a".repeat(32), firstTab);

  assert.equal(isInboxReadModelRevision(firstTab), true);
  assert.notEqual(firstTab, secondTab);
  assert.ok(compareInboxReadModelRevisions(firstTab, secondTab) < 0);
  assert.ok(compareInboxReadModelRevisions(nextInFirstTab, firstTab) > 0);

  const observedAccountId = accountId + 100;
  const observed = revision(8_000_000_000_000_000, "c".repeat(32));
  observeInboxReadModelRevision(observedAccountId, observed);
  const afterObserved = reserveInboxReadModelRevision(observedAccountId);
  assert.ok(compareInboxReadModelRevisions(afterObserved, observed) > 0);

  const first = reserveInboxReadModelRevision(accountId);
  const second = reserveInboxReadModelRevision(accountId);
  assert.ok(compareInboxReadModelRevisions(second, first) > 0);
  assert.equal(currentInboxReadModelRevision(accountId), second);
});

test("the local revision fence is synchronously visible across tabs", () => {
  const originalWindow = global.window;
  const values = new Map();
  global.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      get length() {
        return values.size;
      },
      removeItem: (key) => values.delete(key),
      setItem: (key, value) => values.set(key, value),
    },
  };

  try {
    const isolatedJiti = createJiti(__filename, {
      interopDefault: true,
      moduleCache: false,
      alias: { "@": path.join(root, "src") },
    });
    const isolatedRevision = isolatedJiti(
      path.join(root, "src/lib/inboxSync/revision.ts"),
    );
    const isolatedAccountId = accountId + 200;
    const reserved =
      isolatedRevision.reserveInboxReadModelRevision(isolatedAccountId);

    assert.equal(
      isolatedRevision.inboxRevisionStorageAvailable(isolatedAccountId),
      true,
    );
    assert.equal(
      isolatedRevision.currentInboxReadModelRevision(isolatedAccountId),
      reserved,
    );

    const newer = revision(
      Number.parseInt(reserved.slice(0, 16), 10) + 1,
      "f".repeat(32),
      reserved,
    );
    const prefix = `hypertask-inbox-read-model-revision:${isolatedAccountId}`;
    values.set(`${prefix}:${"f".repeat(32)}`, newer);
    assert.equal(
      isolatedRevision.currentInboxReadModelRevision(isolatedAccountId),
      newer,
    );
    const newest = revision(
      Number.parseInt(newer.slice(0, 16), 10) + 1,
      "e".repeat(32),
      newer,
    );
    isolatedRevision.observeInboxReadModelRevision(isolatedAccountId, newest);
    assert.equal(
      isolatedRevision.inboxRevisionStorageAvailable(isolatedAccountId),
      false,
    );
    const older = revision(
      Number.parseInt(newer.slice(0, 16), 10) - 1,
      "d".repeat(32),
    );
    values.set(`${prefix}:${"d".repeat(32)}`, older);
    assert.equal(
      isolatedRevision.currentInboxReadModelRevision(isolatedAccountId),
      newest,
    );
    const newestReserved =
      isolatedRevision.reserveInboxReadModelRevision(isolatedAccountId);
    assert.ok(
      isolatedRevision.compareInboxReadModelRevisions(
        newestReserved,
        newest,
      ) > 0,
    );
    const storageOnlyAccountId = isolatedAccountId + 1;
    const storageOnlyPrefix =
      `hypertask-inbox-read-model-revision:${storageOnlyAccountId}`;
    values.set(`${storageOnlyPrefix}:${"a".repeat(32)}`, older);
    values.set(`${storageOnlyPrefix}:${"f".repeat(32)}`, newer);
    assert.equal(
      isolatedRevision.currentInboxReadModelRevision(storageOnlyAccountId),
      newer,
    );
    clearInboxReadModelRevisionStorage();
    assert.equal(
      isolatedRevision.inboxRevisionStorageAvailable(isolatedAccountId),
      false,
    );
  } finally {
    global.window = originalWindow;
  }
});

test("local Inbox hydration excludes projects without current access", () => {
  const payload = {
    revision: revision(4_000),
    notifications: [
      notification(10, { projectId: 15 }),
      notification(11, { projectId: 16 }),
      notification(12, { projectId: 99, task: { projectId: 15 } }),
      notification(13, { projectId: 15, task: { projectId: 16 } }),
      notification(14, { projectId: 15, task: { projectId: 15 } }),
    ],
    splitsNoImportant: [],
    showImportantSplit: false,
  };

  assert.deepEqual(
    filterInboxReadModelByProjectAccess(payload, [15]).notifications.map(
      ({ id }) => id,
    ),
    ["10", "14"],
  );
});

test("concurrent Inbox reads share work only within the same account", async () => {
  const originalIndexedDb = global.indexedDB;
  const originalBroadcastChannel = global.BroadcastChannel;
  const secondAccountId = accountId + 1;
  const firstSnapshot = createInboxReadModelSnapshot({
    accountId,
    payload: {
      revision: revision(4_500),
      notifications: [notification(10)],
      splitsNoImportant: [],
      showImportantSplit: false,
    },
  });
  const secondSnapshot = createInboxReadModelSnapshot({
    accountId: secondAccountId,
    payload: {
      revision: revision(4_600),
      notifications: [notification(20, { userId: secondAccountId })],
      splitsNoImportant: [],
      showImportantSplit: false,
    },
  });
  assert.ok(firstSnapshot);
  assert.ok(secondSnapshot);
  const snapshotsByKey = new Map([
    [firstSnapshot.key, firstSnapshot],
    [secondSnapshot.key, secondSnapshot],
  ]);
  const fenceRevision = revision(4_650);
  snapshotsByKey.set(`revision-fence:${accountId}`, {
    key: `revision-fence:${accountId}`,
    accountId,
    revision: fenceRevision,
  });

  let openCount = 0;
  global.BroadcastChannel = undefined;
  global.indexedDB = {
    open: () => {
      openCount += 1;
      const openRequest = {};
      setImmediate(() => {
        openRequest.result = {
          objectStoreNames: { contains: () => true },
          transaction: () => {
            const transaction = {
              objectStore: () => ({
                get: (key) => {
                  const request = {};
                  setImmediate(() => {
                    request.result = snapshotsByKey.get(key);
                    request.onsuccess();
                    setImmediate(() => transaction.oncomplete());
                  });
                  return request;
                },
              }),
            };
            return transaction;
          },
          close: () => {},
        };
        openRequest.onsuccess();
      });
      return openRequest;
    },
  };

  try {
    const { readInboxReadModel, readInboxReadModelRevisionFence } = jiti(
      path.join(root, "src/lib/inboxSync/indexedDbReadModel.ts"),
    );
    const [hydrated, reconciled, otherAccount] = await Promise.all([
      readInboxReadModel(accountId),
      readInboxReadModel(accountId),
      readInboxReadModel(secondAccountId),
    ]);

    assert.deepEqual(hydrated, reconciled);
    assert.notDeepEqual(hydrated, otherAccount);
    assert.equal(otherAccount.notifications[0].userId, secondAccountId);
    assert.equal(openCount, 2);

    assert.equal(
      await readInboxReadModelRevisionFence(accountId),
      fenceRevision,
    );
    assert.equal(openCount, 3);

    await readInboxReadModel(accountId);
    assert.equal(openCount, 4);
  } finally {
    global.indexedDB = originalIndexedDb;
    global.BroadcastChannel = originalBroadcastChannel;
  }
});

test("a failed IndexedDB read does not block the next account read", async () => {
  const originalIndexedDb = global.indexedDB;
  const originalBroadcastChannel = global.BroadcastChannel;
  const snapshot = createInboxReadModelSnapshot({
    accountId,
    payload: {
      revision: revision(4_700),
      notifications: [notification(30)],
      splitsNoImportant: [],
      showImportantSplit: false,
    },
  });
  assert.ok(snapshot);

  let openCount = 0;
  global.BroadcastChannel = undefined;
  global.indexedDB = {
    open: () => {
      openCount += 1;
      const openRequest = {};
      setImmediate(() => {
        if (openCount === 1) {
          openRequest.error = new Error("temporary IndexedDB failure");
          openRequest.onerror();
          return;
        }
        openRequest.result = {
          objectStoreNames: { contains: () => true },
          transaction: () => {
            const transaction = {
              objectStore: () => ({
                get: () => {
                  const request = {};
                  setImmediate(() => {
                    request.result = snapshot;
                    request.onsuccess();
                    setImmediate(() => transaction.oncomplete());
                  });
                  return request;
                },
              }),
            };
            return transaction;
          },
          close: () => {},
        };
        openRequest.onsuccess();
      });
      return openRequest;
    },
  };

  try {
    const { readInboxReadModel } = jiti(
      path.join(root, "src/lib/inboxSync/indexedDbReadModel.ts"),
    );
    assert.equal(await readInboxReadModel(accountId), null);
    assert.deepEqual(
      await readInboxReadModel(accountId),
      materializeInboxReadModelSnapshot(snapshot),
    );
    assert.equal(openCount, 2);
  } finally {
    global.indexedDB = originalIndexedDb;
    global.BroadcastChannel = originalBroadcastChannel;
  }
});

// HTPR-5745: markAsDone and (un)archiveBulk both archive every OTHER
// notification sharing the removed row's taskId server-side (HTPR-5640
// sibling cleanup) -- so the optimistic client removal must target the
// taskId too, not just the clicked row's own id, or same-task siblings
// (e.g. other reactors' rows in the Reactions split) stay painted until the
// next refetch.
test("removal targets both the exact notification row and its same-task siblings", () => {
  const selected = notification(10, { taskId: 500 });
  const sibling = notification(11, { taskId: 500 });
  const unrelated = notification(12, { taskId: 501 });
  const payload = {
    revision: revision(7_000),
    notifications: [selected, sibling, unrelated],
    splitsNoImportant: [],
    showImportantSplit: false,
  };

  const mutation = createInboxRemovalMutation([selected]);
  assert.deepEqual(mutation.notificationIds, ["10"]);
  assert.deepEqual(mutation.taskIds, [500]);
  assert.deepEqual(
    applyInboxReadModelMutation(payload, mutation).notifications.map(
      ({ id }) => id,
    ),
    ["12"],
  );

  const fallbackMutation = createInboxRemovalMutation([
    notification("synthetic", { taskId: 500, waitingOnSynthetic: true }),
  ]);
  assert.deepEqual(fallbackMutation.notificationIds, []);
  assert.deepEqual(fallbackMutation.taskIds, [500]);
});

test("undo restores an archived notification to its post-removal cache position", () => {
  const before = notification(9);
  const sibling = notification(8, { taskId: 500 });
  const archived = notification(10, { taskId: 500 });
  const after = notification(11);
  const previousNotifications = [before, sibling, archived, after];
  const payload = {
    revision: revision(7_100),
    notifications: applyInboxReadModelMutation(
      {
        revision: revision(7_000),
        notifications: previousNotifications,
        splitsNoImportant: [],
        showImportantSplit: false,
      },
      createInboxRemovalMutation([archived]),
    ).notifications,
    splitsNoImportant: [],
    showImportantSplit: false,
  };
  assert.deepEqual(
    payload.notifications.map(({ id }) => id),
    ["9", "11"],
  );
  const restoreIndex = findInboxRestoreIndex(
    previousNotifications,
    payload.notifications,
    archived.id,
  );
  assert.equal(restoreIndex, 1);

  const restored = applyInboxReadModelMutation(payload, {
    type: "restore",
    notification: archived,
    index: restoreIndex,
  });
  assert.deepEqual(
    restored.notifications.map(({ id }) => id),
    ["9", "10", "11"],
  );

  const duplicate = applyInboxReadModelMutation(restored, {
    type: "restore",
    notification: archived,
    index: 1,
  });
  assert.deepEqual(
    duplicate.notifications.map(({ id }) => id),
    ["9", "10", "11"],
  );
});

test("legacy Inbox caches keep immediate mutations without read-model metadata", () => {
  const queryKey = ["agent-inbox", "agent-1"];
  const row = notification(10);
  let cached = {
    notifications: [row],
    structuredData: { data: [[row]], tabs: [] },
    splitsNoImportant: [],
    showImportantSplit: false,
  };
  const queryClient = {
    getQueryData: () => cached,
    setQueryData: (_queryKey, payload) => {
      cached = payload;
    },
  };

  const updated = updateInboxOptimistically({
    queryClient,
    queryKey,
    accountId,
    mutation: {
      type: "set_seen",
      notificationId: "10",
      seen: true,
    },
  });

  assert.ok(updated);
  assert.equal(updated.notifications[0].seen, true);
  assert.equal(cached.notifications[0].seen, true);
  assert.ok(cached.structuredData.tabs.length > 0);
  assert.equal(
    cached.structuredData.tabs.every(
      (tab, index) =>
        tab.length === cached.structuredData.data[index].length &&
        tab.hasUnseen ===
          cached.structuredData.data[index].every(
            (notificationRow) => notificationRow.seen === true,
          ),
    ),
    true,
  );
  assert.equal(updated.accountId, undefined);
  assert.equal(updated.readModelRevision, undefined);
});

test("Inbox readiness is claimed only once per page-load latch", () => {
  const latch = createInboxReadinessLatch();

  assert.equal(latch.claim(), true);
  assert.equal(latch.claim(), false);
  assert.equal(latch.claim(), false);
});

test("the Inbox integration hydrates, reconciles, persists confirmed data, measures, and clears", () => {
  const hook = read("src/hooks/Inbox/useGetNotifications.ts");
  const indexedDb = read("src/lib/inboxSync/indexedDbReadModel.ts");
  const optimistic = read("src/lib/inboxSync/optimistic.ts");
  const inbox = read("src/app/inbox/Inbox.tsx");
  const focusHandler = read("src/hooks/Inbox/useGlobalFocusHandler.tsx");
  const splitRows = read("src/components/notifications/inboxSplit/index.tsx");
  const revisionSource = read("src/lib/inboxSync/revision.ts");
  const clear = read("src/lib/localReadModels/clear.ts");
  const signout = read("src/hooks/MultiPages/HTC/useSignout.ts");
  const accessRoute = read("src/pages/api/notifications/access.ts");
  const accessController = read(
    "src/utils/controllers/notifications/getAccessibleProjectIds.ts",
  );

  assert.match(hook, /readInboxReadModel\(userId\)/);
  assert.match(hook, /getInboxAccessibleProjectIds\(\)/);
  assert.match(hook, /Promise\.all\(\[/);
  assert.match(hook, /access\.accountId !== userId/);
  assert.match(hook, /access\.projectIds/);
  assert.match(hook, /filterInboxReadModelByProjectAccess/);
  assert.match(hook, /writeInboxReadModel\(/);
  assert.match(hook, /dataOrigin: "indexeddb"/);
  assert.match(hook, /dataOrigin: "network"/);
  assert.match(hook, /queryClient\.setQueryData\(queryKey, hydrated\)/);
  assert.match(hook, /ht-inbox-indexeddb-ready/);
  assert.match(hook, /ht-inbox-network-ready/);
  assert.match(hook, /local_outcome: localOutcome/);
  assert.match(hook, /if \(!latch\.claim\(\)\) return;/);
  assert.match(
    hook,
    /source: "network",[\s\S]*?localOutcome: readinessLocalOutcome\?\.current \?\? "none"/,
  );
  assert.match(
    hook,
    /if \(!storedPayload\) \{\s*readinessLocalOutcome\.current = "miss";\s*return;/,
  );
  assert.match(hook, /catch \{[\s\S]*?readinessLocalOutcome\.current = "error";/);
  assert.doesNotMatch(hook, /source: "indexeddb_miss"/);
  assert.doesNotMatch(hook, /metricKey/);
  assert.doesNotMatch(hook, /getEntriesByName/);
  assert.match(
    hook,
    /properties: \{[\s\S]*?inbox_measurement_version: 2,[\s\S]*?\n    \},/,
  );
  assert.match(hook, /analytics_surface: "authenticated_app"/);
  assert.match(hook, /window\.location\.pathname\.startsWith\("\/inbox"\)/);
  assert.match(hook, /persistBoardSyncPilotPreference\(parameter\)/);
  assert.match(hook, /useSearchParams\(\)/);
  assert.match(hook, /currentInboxReadModelRevision\(userId\)/);
  assert.match(hook, /latestNetworkRequestRevisionByAccount\.set/);
  assert.match(hook, /latestObservedRevision === latestNetworkRequestRevision/);
  assert.match(hook, /isInboxAuthorizationError\(error\)/);
  assert.match(hook, /authorizationFailureBlocksRevision/);
  assert.match(hook, /Ignored Inbox persisted fallback/);
  assert.match(hook, /latestAuthorizationFailureRevisionByAccount\.set/);
  assert.match(hook, /latestAuthorizationFailureRevisionByAccount\.has/);
  assert.match(hook, /Ignored Inbox hydration after authorization failure/);
  assert.match(hook, /emptyInboxPayload\(userId\)/);
  assert.match(hook, /compareInboxReadModelRevisions/);
  assert.match(
    hook,
    /observeInboxReadModelRevision\(userId, payload\.revision\)/,
  );
  assert.match(hook, /current\?\.readModelRevision/);
  assert.match(hook, /responseIsStale/);
  assert.match(hook, /const persistedPayloadPromise = enabled/);
  assert.match(hook, /persistedPayload = await persistedPayloadPromise/);
  assert.match(hook, /readInboxReadModelRevisionFence\(userId\)/);
  assert.match(hook, /!inboxRevisionStorageAvailable\(userId\)/);
  assert.match(hook, /const finalRevision = currentInboxReadModelRevision/);
  assert.match(hook, /Ignored Inbox response after final revision check/);
  assert.ok(
    hook.indexOf("const persistedPayloadPromise = enabled") <
      hook.indexOf("response = await getAllNotifications(userId)"),
  );
  assert.match(hook, /persistedPayload\.revision/);
  assert.match(
    hook,
    /throw new Error\("Ignored stale cross-tab Inbox response"\)/,
  );
  assert.doesNotMatch(
    hook,
    /current\?\.accountId === userId && current\.dataOrigin !== "placeholder"/,
  );
  assert.match(
    hook,
    /latestObservedRevision = currentInboxReadModelRevision\(userId\)/,
  );
  assert.match(hook, /latestQueryPayload\?\.readModelRevision/);
  assert.match(
    hook,
    /compareInboxReadModelRevisions\(payload\.revision, candidate\) < 0/,
  );
  assert.match(
    hook,
    /throw new Error\("Ignored stale cross-tab Inbox hydration"\)/,
  );
  assert.ok(
    hook.indexOf("if (hydrationIsStale)") <
      hook.indexOf("observeInboxReadModelRevision(userId, payload.revision)"),
  );
  assert.match(hook, /dataOrigin !== "network"/);
  assert.match(
    hook,
    /queryClient\.resetQueries\(\{ queryKey, exact: true \}\)/,
  );
  assert.match(inbox, /updateInboxOptimistically/);
  assert.match(
    inbox,
    /const undoHandler[\s\S]*?queryKey: undoQueryKey[\s\S]*?type: "restore"[\s\S]*?index: data\.notificationIndex[\s\S]*?queryKey: undoQueryKey[\s\S]*?exact: true/,
  );
  assert.match(focusHandler, /updateInboxOptimistically/);
  assert.match(splitRows, /updateInboxOptimistically/);
  assert.doesNotMatch(inbox, /reserveInboxReadModelRevision/);
  assert.doesNotMatch(focusHandler, /reserveInboxReadModelRevision/);
  assert.doesNotMatch(splitRows, /reserveInboxReadModelRevision/);
  assert.match(indexedDb, /BroadcastChannel/);
  assert.match(indexedDb, /database\.onversionchange/);
  assert.match(indexedDb, /operationsDisabled = true/);
  assert.match(indexedDb, /compareInboxReadModelRevisions/);
  assert.match(indexedDb, /currentInboxReadModelRevision/);
  assert.match(indexedDb, /writeInboxReadModelRevisionFence/);
  assert.match(indexedDb, /revisionFenceKey/);
  assert.match(indexedDb, /database\.transaction\(STORE_NAME, "readwrite"\)/);
  assert.doesNotMatch(indexedDb, /mutateInboxReadModel/);
  assert.doesNotMatch(indexedDb, /objectStore\(STORE_NAME\)\.delete/);
  assert.match(indexedDb, /isInboxReadModelSnapshotV1\(existing, accountId\)/);
  assert.match(optimistic, /updateInboxOptimistically/);
  assert.match(optimistic, /Agent and legacy Inbox queries/);
  assert.match(optimistic, /reserveInboxReadModelRevision\(accountId\)/);
  assert.match(optimistic, /persistRevisionFence\(accountId, revision\)/);
  assert.doesNotMatch(optimistic, /mutateInboxReadModel/);
  assert.doesNotMatch(optimistic, /mutationQueueByAccount/);
  assert.match(focusHandler, /await reconcileInbox\(\)/);
  assert.match(splitRows, /invalidateQueries/);
  assert.match(inbox, /invalidateQueries/);
  assert.match(indexedDb, />=\s*0/);
  assert.match(revisionSource, /BroadcastChannel/);
  assert.match(revisionSource, /revisionChannel\?\.postMessage/);
  assert.match(revisionSource, /observeInboxReadModelRevision/);
  assert.match(accessRoute, /getSessionUser/);
  assert.match(accessRoute, /getInboxAccessibleProjectIds\(session\.userId\)/);
  assert.match(accessRoute, /accountId: session\.userId/);
  assert.match(accessRoute, /Cache-Control/);
  assert.match(accessRoute, /private, no-store, max-age=0/);
  assert.match(accessController, /projectContentAccessWhere\(userId\)/);
  assert.match(accessController, /select: \{ id: true \}/);
  assert.match(clear, /clearBoardReadModels\(\)/);
  assert.match(clear, /clearInboxReadModels\(\)/);
  assert.match(clear, /clearCalendarReadModels\(\)/);
  assert.match(
    signout,
    /localReadModelsCleared = await clearAllLocalReadModels\(\)/,
  );
  assert.ok(
    signout.indexOf("if (!localReadModelsCleared)") <
      signout.indexOf("await signOutAllAccounts()"),
  );
});
