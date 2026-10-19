const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.join(__dirname, "..");
const jiti = createJiti(__filename, {
  interopDefault: true,
  moduleCache: false,
  alias: { "@": path.join(root, "src") },
});

global.BroadcastChannel = undefined;

const accountId = 6;
const savedAt = new Date().toISOString();

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

const browserIndexedDb = ({ storedValue, failReads }) => {
  const database = {
    objectStoreNames: { contains: () => true },
    createObjectStore() {},
    close() {},
    transaction() {
      const transaction = {
        error: null,
        oncomplete: null,
        onabort: null,
        onerror: null,
        objectStore: () => ({
          get() {
            const request = { result: undefined, error: null };
            setTimeout(() => {
              if (failReads) {
                request.error = new DOMException("Internal error", "UnknownError");
                request.onerror?.({ target: request });
                transaction.onerror?.({ target: request });
                transaction.error = request.error;
                transaction.onabort?.({ target: transaction });
                return;
              }
              request.result = storedValue;
              request.onsuccess?.({ target: request });
              transaction.oncomplete?.({ target: transaction });
            });
            return request;
          },
        }),
      };
      return transaction;
    },
  };
  return {
    open() {
      const request = { result: database };
      setTimeout(() => request.onsuccess?.({ target: request }));
      return request;
    },
  };
};

const withIndexedDb = async (fakeIndexedDb, run) => {
  const originalIndexedDb = global.indexedDB;
  const unhandled = [];
  const recordUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", recordUnhandled);
  global.indexedDB = fakeIndexedDb;
  try {
    const result = await run();
    for (let tick = 0; tick < 5; tick += 1) await nextTask();
    return { result, unhandled };
  } finally {
    process.off("unhandledRejection", recordUnhandled);
    global.indexedDB = originalIndexedDb;
  }
};

const loadInboxReadModel = () =>
  jiti(path.join(root, "src/lib/inboxSync/indexedDbReadModel.ts"));

test("a failed Inbox read model read leaves no unhandled rejection behind", async () => {
  const { readInboxReadModel, readInboxReadModelRevisionFence } =
    loadInboxReadModel();

  const { result, unhandled } = await withIndexedDb(
    browserIndexedDb({ failReads: true }),
    async () => [
      await readInboxReadModel(accountId),
      await readInboxReadModelRevisionFence(accountId),
    ],
  );

  assert.deepEqual(result, [null, null]);
  assert.deepEqual(unhandled, []);
});

test("a failed board, calendar or query cache read leaves no unhandled rejection behind", async () => {
  const { readBoardReadModel } = jiti(
    path.join(root, "src/lib/boardSync/indexedDbReadModel.ts"),
  );
  const { readCalendarReadModel } = jiti(
    path.join(root, "src/lib/calendarSync/indexedDbReadModel.ts"),
  );
  const { createIndexedDbQueryPersister } = jiti(
    path.join(root, "src/utils/queryIndexedDbPersister.ts"),
  );

  const { result, unhandled } = await withIndexedDb(
    browserIndexedDb({ failReads: true }),
    async () => [
      await readBoardReadModel(accountId, 15),
      await readCalendarReadModel(accountId, {
        start: "2026-10-01T00:00:00.000Z",
        end: "2026-11-01T00:00:00.000Z",
      }),
      await createIndexedDbQueryPersister({
        accountId,
        legacyStorage: null,
      })
        .restoreClient()
        .catch(() => "rejected"),
    ],
  );

  assert.equal(result[0], null);
  assert.equal(result[1], null);
  assert.notEqual(result[2], "rejected");
  assert.deepEqual(unhandled, []);
});

test("a failed read rejects its awaiting caller with the real IndexedDB error", async () => {
  const { requestValue, waitForTransaction } = jiti(
    path.join(root, "src/lib/indexedDb/transactionPromises.ts"),
  );
  const database = browserIndexedDb({ failReads: true }).open().result;
  const transaction = database.transaction();
  const completion = waitForTransaction(transaction);

  await assert.rejects(requestValue(transaction.objectStore().get()), {
    name: "UnknownError",
  });
  await assert.rejects(completion, { name: "UnknownError" });
});

test("a stored Inbox snapshot is still read back", async () => {
  const { createInboxReadModelSnapshot } = jiti(
    path.join(root, "src/lib/inboxSync/contract.ts"),
  );
  const { createInboxReadModelRevision } = jiti(
    path.join(root, "src/lib/inboxSync/revision.ts"),
  );
  const notification = {
    id: "10",
    userId: accountId,
    taskId: 110,
    projectId: 15,
    type: "Comment",
    status: "Normal",
    seen: false,
    createdAt: savedAt,
    project: { id: 15, title: "Speed", name: "Speed", teamId: 1 },
    task: {
      id: 110,
      projectId: 15,
      title: "task-10",
      status: "Normal",
      ticketNumber: "HTPR-10",
    },
    title: "notification-10",
  };
  const snapshot = createInboxReadModelSnapshot({
    accountId,
    savedAt,
    ttlMs: 60_000,
    payload: {
      revision: createInboxReadModelRevision({
        operationTime: 1_000,
        tabId: "a".repeat(32),
      }),
      notifications: [notification],
      splitsNoImportant: [],
      showImportantSplit: false,
    },
  });
  assert.ok(snapshot);
  const { readInboxReadModel } = loadInboxReadModel();

  const { result, unhandled } = await withIndexedDb(
    browserIndexedDb({ storedValue: snapshot }),
    () => readInboxReadModel(accountId),
  );

  assert.deepEqual(
    result.notifications.map(({ id }) => id),
    ["10"],
  );
  assert.deepEqual(unhandled, []);
});
