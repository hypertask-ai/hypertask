const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
  moduleCache: false,
});
const {
  LEGACY_QUERY_CACHE_STORAGE_KEY,
  QUERY_CACHE_RECORD_SCHEMA_VERSION,
  createIndexedDbQueryPersister,
  createQueryPersister,
  clearQueryPersistence,
  handleQueryPersistenceControlMessage,
  createQueryCacheRecord,
  parseQueryCacheRecord,
  resolveQueryPersistenceMode,
  shouldReplaceQueryCacheRecord,
} = jiti(path.join(root, "src/utils/queryIndexedDbPersister.ts"));
const { MAX_PERSISTED_CLIENT_BYTES } = jiti(
  path.join(root, "src/utils/queryPersistence.ts"),
);

const client = (marker = "current") => ({
  timestamp: Date.now(),
  buster: "startup-budget-v2-indexeddb",
  clientState: {
    mutations: [],
    queries: [
      {
        queryKey: ["small-setting", marker],
        queryHash: `small-setting-${marker}`,
        state: { data: { marker }, dataUpdatedAt: 1 },
      },
    ],
  },
});

const memoryStorage = (initialValue) => {
  let value = initialValue;
  const writes = [];
  const removes = [];
  return {
    storage: {
      async read() {
        return value;
      },
      async write(record) {
        value = record;
        writes.push(record);
      },
      async remove(accountId, expectedRevision) {
        removes.push({ accountId, expectedRevision });
        if (
          expectedRevision === undefined ||
          value?.revision === expectedRevision
        ) {
          value = undefined;
        }
      },
    },
    removes,
    value: () => value,
    writes,
  };
};

const fakeTimers = () => {
  let nextId = 1;
  const callbacks = new Map();
  return {
    clearTimer(id) {
      callbacks.delete(id);
    },
    flush() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback();
    },
    pendingCount: () => callbacks.size,
    setTimer(callback) {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
  };
};

test("versioned records round-trip without exceeding the existing byte budget", async () => {
  const original = client();
  const record = createQueryCacheRecord(6, original, "revision-1");
  assert.ok(record);
  assert.equal(record.schemaVersion, QUERY_CACHE_RECORD_SCHEMA_VERSION);
  assert.equal(record.accountId, 6);
  assert.ok(record.bytes <= MAX_PERSISTED_CLIENT_BYTES);
  assert.deepEqual(await parseQueryCacheRecord(record, 6), original);
});

test("another account, stale schema, oversize, and corrupt records never hydrate", async () => {
  const record = createQueryCacheRecord(6, client(), "revision-1");
  assert.ok(record);
  assert.equal(await parseQueryCacheRecord(record, 7), null);
  assert.equal(
    await parseQueryCacheRecord({ ...record, schemaVersion: 0 }, 6),
    null,
  );
  assert.equal(
    await parseQueryCacheRecord(
      {
        ...record,
        bytes: MAX_PERSISTED_CLIENT_BYTES + 1,
        payload: new Blob(["x".repeat(MAX_PERSISTED_CLIENT_BYTES + 1)], {
          type: "application/json",
        }),
      },
      6,
    ),
    null,
  );
  assert.equal(
    await parseQueryCacheRecord(
      {
        ...record,
        bytes: 8,
        payload: new Blob(["not-json"], { type: "application/json" }),
      },
      6,
    ),
    null,
  );
});

test("writes are delayed, latest-only, and structured outside startup", async () => {
  const memory = memoryStorage();
  const timers = fakeTimers();
  const persister = createIndexedDbQueryPersister({
    accountId: 6,
    storage: memory.storage,
    legacyStorage: null,
    throttleMs: 2_000,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  persister.persistClient(client("old"));
  persister.persistClient(client("new"));
  assert.equal(memory.writes.length, 0);
  assert.equal(timers.pendingCount(), 1);

  timers.flush();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(memory.writes.length, 1);
  assert.equal(
    (await parseQueryCacheRecord(memory.writes[0], 6)).clientState.queries[0]
      .queryKey[1],
    "new",
  );
});

test("remove cancels pending writes and cannot let an in-flight write return", async () => {
  const timers = fakeTimers();
  const pendingMemory = memoryStorage();
  const pendingPersister = createIndexedDbQueryPersister({
    accountId: 6,
    storage: pendingMemory.storage,
    legacyStorage: null,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  pendingPersister.persistClient(client("pending"));
  await pendingPersister.removeClient();
  timers.flush();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pendingMemory.writes.length, 0);

  let finishWrite;
  const inFlightMemory = memoryStorage();
  const originalWrite = inFlightMemory.storage.write;
  inFlightMemory.storage.write = async (record) => {
    await new Promise((resolve) => {
      finishWrite = resolve;
    });
    await originalWrite(record);
  };
  const inFlightPersister = createIndexedDbQueryPersister({
    accountId: 6,
    storage: inFlightMemory.storage,
    legacyStorage: null,
    throttleMs: 0,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  inFlightPersister.persistClient(client("in-flight"));
  timers.flush();
  await new Promise((resolve) => setImmediate(resolve));
  const removal = inFlightPersister.removeClient();
  finishWrite();
  await removal;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(inFlightMemory.value(), undefined);
  assert.ok(
    inFlightMemory.removes.some(
      ({ expectedRevision }) => expectedRevision !== undefined,
    ),
  );
});

test("disposing a boundary cancels its writes without deleting account data", async () => {
  const memory = memoryStorage(createQueryCacheRecord(6, client("saved")));
  const timers = fakeTimers();
  const persister = createIndexedDbQueryPersister({
    accountId: 6,
    storage: memory.storage,
    legacyStorage: null,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  persister.persistClient(client("pending"));
  persister.dispose();
  timers.flush();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(memory.writes.length, 0);
  assert.equal(memory.removes.length, 0);
  assert.ok(memory.value());
});

test("a remove during restore prevents stale hydration", async () => {
  let finishRead;
  const record = createQueryCacheRecord(6, client("stale"), "stale-revision");
  const storage = {
    async read() {
      return new Promise((resolve) => {
        finishRead = () => resolve(record);
      });
    },
    async write() {},
    async remove() {},
  };
  const persister = createIndexedDbQueryPersister({
    accountId: 6,
    storage,
    legacyStorage: null,
  });

  const restoring = persister.restoreClient();
  await persister.removeClient();
  finishRead();
  assert.equal(await restoring, undefined);
});

test("restore discards a snapshot replaced by another tab during parsing", async () => {
  const older = createQueryCacheRecord(6, client("older"), "revision-old");
  const newer = createQueryCacheRecord(6, client("newer"), "revision-new");
  let reads = 0;
  const persister = createIndexedDbQueryPersister({
    accountId: 6,
    storage: {
      async read() {
        reads += 1;
        return reads === 1 ? older : newer;
      },
      async write() {},
      async remove() {},
    },
    legacyStorage: null,
  });

  assert.equal(await persister.restoreClient(), undefined);
  assert.equal(reads, 2);
});

test("remove after restore cannot delete a newer cross-tab revision", async () => {
  const restored = createQueryCacheRecord(6, client("restored"), "revision-old");
  const newer = createQueryCacheRecord(6, client("newer"), "revision-new");
  const memory = memoryStorage(restored);
  const persister = createIndexedDbQueryPersister({
    accountId: 6,
    storage: memory.storage,
    legacyStorage: null,
  });

  assert.ok(await persister.restoreClient());
  await memory.storage.write(newer);
  await persister.removeClient();
  assert.equal(memory.value().revision, "revision-new");
  assert.deepEqual(memory.removes.at(-1), {
    accountId: 6,
    expectedRevision: "revision-old",
  });
  persister.dispose();
});

test("record ordering rejects older cross-tab snapshots deterministically", () => {
  const olderClient = client("older");
  olderClient.timestamp = 100;
  const newerClient = client("newer");
  newerClient.timestamp = 200;
  const older = createQueryCacheRecord(6, olderClient, "revision-z");
  const newer = createQueryCacheRecord(6, newerClient, "revision-a");
  assert.ok(older && newer);

  assert.equal(shouldReplaceQueryCacheRecord(newer, older), false);
  assert.equal(shouldReplaceQueryCacheRecord(older, newer), true);
  assert.equal(
    shouldReplaceQueryCacheRecord(
      { ...newer, updatedAt: older.updatedAt, revision: "revision-a" },
      older,
    ),
    true,
  );
  assert.equal(shouldReplaceQueryCacheRecord({ corrupt: true }, older), true);
});

test("the IndexedDB write path only compares the current account key", () => {
  const source = fs.readFileSync(
    path.join(root, "src/utils/queryIndexedDbPersister.ts"),
    "utf8",
  );
  const writeStart = source.indexOf("write: async (record)");
  const removeStart = source.indexOf("remove: async (accountId", writeStart);
  const writeSource = source.slice(writeStart, removeStart);

  assert.match(writeSource, /store\.get\(record\.key\)/);
  assert.doesNotMatch(writeSource, /getAll|openCursor|cursor\.delete/);
});

test("restore retires the unscoped cache and conditionally removes corruption", async () => {
  const wrongAccount = createQueryCacheRecord(7, client(), "wrong-account");
  const memory = memoryStorage(wrongAccount);
  const removedLegacyKeys = [];
  const persister = createIndexedDbQueryPersister({
    accountId: 6,
    storage: memory.storage,
    legacyStorage: { removeItem: (key) => removedLegacyKeys.push(key) },
  });

  assert.equal(await persister.restoreClient(), undefined);
  assert.deepEqual(removedLegacyKeys, [
    LEGACY_QUERY_CACHE_STORAGE_KEY,
    `${LEGACY_QUERY_CACHE_STORAGE_KEY}:v2:user:6`,
  ]);
  assert.deepEqual(memory.removes, [
    { accountId: 6, expectedRevision: "wrong-account" },
  ]);
});

test("a failed IndexedDB read preserves the legacy fallback", async () => {
  const removedLegacyKeys = [];
  const persister = createIndexedDbQueryPersister({
    accountId: 6,
    storage: {
      async read() {
        throw new Error("blocked");
      },
      async write() {},
      async remove() {},
    },
    legacyStorage: { removeItem: (key) => removedLegacyKeys.push(key) },
  });

  assert.equal(await persister.restoreClient(), undefined);
  assert.deepEqual(removedLegacyKeys, []);
});

test("a successful remote clear permanently fences the pre-logout persister", async () => {
  const memory = memoryStorage();
  const timers = fakeTimers();
  const persister = createIndexedDbQueryPersister({
    accountId: 6,
    storage: memory.storage,
    legacyStorage: null,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  handleQueryPersistenceControlMessage({
    type: "clear-query-cache-start",
    token: "remote-clear",
  });
  persister.persistClient(client("blocked"));
  timers.flush();
  assert.equal(memory.writes.length, 0);

  handleQueryPersistenceControlMessage({
    type: "clear-query-cache-complete",
    token: "remote-clear",
    deleted: true,
  });
  persister.persistClient(client("must-remain-fenced"));
  timers.flush();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(memory.writes.length, 0);
  persister.dispose();
});

test("the rollout switch defaults to IndexedDB and supports local or off", () => {
  assert.equal(resolveQueryPersistenceMode({}), "indexeddb");
  assert.equal(
    resolveQueryPersistenceMode({ requestedMode: "local" }),
    "local",
  );
  assert.equal(
    resolveQueryPersistenceMode({ storedMode: "off" }),
    "off",
  );
  assert.equal(
    resolveQueryPersistenceMode({
      requestedMode: "indexeddb",
      storedMode: "off",
    }),
    "indexeddb",
  );
  assert.equal(
    resolveQueryPersistenceMode({
      requestedMode: "indexeddb",
      indexedDbEnabled: false,
    }),
    "local",
  );
  assert.equal(
    resolveQueryPersistenceMode({
      requestedMode: "off",
      indexedDbEnabled: false,
    }),
    "off",
  );
});

test("local fallback preserves its account-scoped cache across reloads", async () => {
  const originalWindow = global.window;
  const originalIndexedDb = global.indexedDB;
  const originalBroadcastChannel = global.BroadcastChannel;
  const values = new Map([
    ["ht_query_persistence_mode", "local"],
    [`${LEGACY_QUERY_CACHE_STORAGE_KEY}:v2:user:6`, "persisted"],
  ]);
  const removed = [];
  global.window = {
    location: { search: "" },
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      removeItem: (key) => {
        removed.push(key);
        values.delete(key);
      },
      setItem: (key, value) => values.set(key, value),
    },
  };
  global.indexedDB = undefined;
  global.BroadcastChannel = undefined;

  try {
    const persister = createQueryPersister(6);
    assert.deepEqual(removed, [LEGACY_QUERY_CACHE_STORAGE_KEY]);
    assert.equal(
      values.get(`${LEGACY_QUERY_CACHE_STORAGE_KEY}:v2:user:6`),
      "persisted",
    );
    persister.dispose();
    await persister.removeClient();
    assert.equal(
      values.get(`${LEGACY_QUERY_CACHE_STORAGE_KEY}:v2:user:6`),
      "persisted",
    );
  } finally {
    global.window = originalWindow;
    global.indexedDB = originalIndexedDb;
    global.BroadcastChannel = originalBroadcastChannel;
  }
});

test("failed logout deletion tombstones restoration until a retry succeeds", async () => {
  const originalWindow = global.window;
  const originalIndexedDb = global.indexedDB;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const accountKey = `${LEGACY_QUERY_CACHE_STORAGE_KEY}:v2:user:6`;
  const values = new Map([
    ["ht_query_persistence_mode", "local"],
    [accountKey, JSON.stringify(client("must-not-restore"))],
  ]);
  global.window = {
    location: { search: "" },
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      removeItem: (key) => values.delete(key),
      setItem: (key, value) => values.set(key, value),
      get length() {
        return values.size;
      },
      key: (index) => [...values.keys()][index] ?? null,
    },
  };
  global.indexedDB = { deleteDatabase: () => ({}) };
  global.setTimeout = (callback) => {
    queueMicrotask(callback);
    return 1;
  };
  global.clearTimeout = () => undefined;

  try {
    const clearing = clearQueryPersistence();
    values.set(accountKey, JSON.stringify(client("stale-after-clear")));
    const restoring = createQueryPersister(6).restoreClient();
    assert.equal(await clearing, false);
    assert.equal(await restoring, undefined);
  } finally {
    global.window = originalWindow;
    global.indexedDB = originalIndexedDb;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test("the provider uses signed account scope and logout clears the query database", () => {
  const provider = fs.readFileSync(
    path.join(root, "src/utils/Providers.tsx"),
    "utf8",
  );
  const layout = fs.readFileSync(path.join(root, "src/app/layout.tsx"), "utf8");
  const cleanup = fs.readFileSync(
    path.join(root, "src/lib/localReadModels/clear.ts"),
    "utf8",
  );
  const persister = fs.readFileSync(
    path.join(root, "src/utils/queryIndexedDbPersister.ts"),
    "utf8",
  );

  assert.match(layout, /authenticatedUserId=\{analyticsSession\?\.id \?\? null\}/);
  assert.match(provider, /createQueryPersister\(accountId\)/);
  assert.match(provider, /createQueryBoundary\(authenticatedUserId\)/);
  assert.match(provider, /key=\{`query-account-/);
  assert.match(provider, /previous\.client\.clear\(\)/);
  assert.match(provider, /previous\.persister\.dispose\(\)/);
  assert.doesNotMatch(provider, /createSyncStoragePersister/);
  assert.match(cleanup, /clearQueryPersistence\(\)/);
  assert.match(persister, /new Response\(value\.payload\)\.json\(\)/);
  assert.match(persister, /performance\.measure\("ht-query-cache-restore"/);
  assert.match(
    persister,
    /addEventListener\("message"[\s\S]*clearLocalQueryStorage\(\)/,
  );
  assert.match(
    persister,
    /const persisterOperationGeneration = operationGeneration;[\s\S]*getControlChannel\(\)/,
  );
  const indexedStart = persister.indexOf("createIndexedDbQueryPersister");
  const localStart = persister.indexOf("createLocalQueryPersister");
  assert.doesNotMatch(
    persister.slice(indexedStart, localStart),
    /JSON\.parse/,
  );
});

test("a new authenticated boundary resumes only in the post-logout generation", async () => {
  const originalWindow = global.window;
  const originalIndexedDb = global.indexedDB;
  const originalBroadcastChannel = global.BroadcastChannel;
  const accountKey = `${LEGACY_QUERY_CACHE_STORAGE_KEY}:v2:user:6`;
  const persisted = client("after-login");
  const values = new Map([
    ["ht_query_persistence_mode", "local"],
    [accountKey, JSON.stringify(persisted)],
  ]);
  global.window = {
    location: { search: "" },
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      removeItem: (key) => values.delete(key),
      setItem: (key, value) => values.set(key, value),
      get length() {
        return values.size;
      },
      key: (index) => [...values.keys()][index] ?? null,
    },
  };
  global.indexedDB = undefined;
  global.BroadcastChannel = undefined;

  try {
    await clearQueryPersistence();
    values.set(accountKey, JSON.stringify(persisted));
    const resumed = createQueryPersister(6);
    assert.deepEqual(await resumed.restoreClient(), persisted);
  } finally {
    global.window = originalWindow;
    global.indexedDB = originalIndexedDb;
    global.BroadcastChannel = originalBroadcastChannel;
  }
});
