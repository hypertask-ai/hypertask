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

const fixture = JSON.parse(read("tests/fixtures/board-sync-v1.json"));
const fixtureLocalPayload = {
  ...fixture,
  project: { ...fixture.project, section: [] },
};

const useFakeLocalStorage = () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  return {
    store,
    restore: () => {
      delete globalThis.localStorage;
    },
  };
};

// HTPR-5927: a board-read-model database whose object store cannot be found
// on this key exercises the same open()/get()/put() path both writes and
// clears go through, without needing a real IndexedDB. put/delete are queued
// synchronously (matching real IndexedDB request semantics) and settle on the
// next microtask so cursor/get callbacks that queue further work still run
// before the transaction completes.
function fakeIndexedDb({ existingByKey = new Map() } = {}) {
  const puts = [];
  let deleteDatabaseCalled = false;
  const database = {
    objectStoreNames: { contains: () => true },
    onversionchange: null,
    close: () => {},
    transaction: () => {
      const transaction = { oncomplete: null, onabort: null, onerror: null };
      // Pending starts at 1, released only once the caller has finished
      // issuing every op for this tick (see release() below) -- otherwise a
      // transaction with zero ops still outstanding at creation time (before
      // get()/put()/openCursor() are even called) would complete instantly,
      // firing oncomplete before those ops get a chance to run.
      let pending = 1;
      const maybeComplete = () => {
        if (pending === 0) queueMicrotask(() => transaction.oncomplete?.());
      };
      const release = () => {
        pending -= 1;
        maybeComplete();
      };
      transaction.objectStore = () => ({
        get: (key) => {
          const request = {};
          pending += 1;
          queueMicrotask(() => {
            request.result = existingByKey.get(key);
            request.onsuccess?.();
            release();
          });
          return request;
        },
        put: (value) => {
          puts.push(value);
          existingByKey.set(value.key, value);
        },
        delete: () => {},
        index: () => ({
          openCursor: () => {
            const request = {};
            pending += 1;
            // No other records for this account -- nothing to evict.
            queueMicrotask(() => {
              request.result = null;
              request.onsuccess?.();
              release();
            });
            return request;
          },
        }),
      });
      // Every op above is issued synchronously in the same tick as
      // transaction(), so releasing this placeholder on the next microtask
      // (after they've all incremented pending) is what lets a real op count
      // decide when the transaction is actually done.
      queueMicrotask(release);
      return transaction;
    },
  };
  return {
    puts,
    indexedDb: {
      open: () => {
        const request = {};
        queueMicrotask(() => {
          request.result = database;
          request.onsuccess?.();
        });
        return request;
      },
      deleteDatabase: () => {
        deleteDatabaseCalled = true;
        const request = {};
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    },
    get deleteDatabaseCalled() {
      return deleteDatabaseCalled;
    },
  };
}

function withFakeIndexedDb(setup, run) {
  const originalIndexedDb = global.indexedDB;
  const originalBroadcastChannel = global.BroadcastChannel;
  const originalIdbKeyRange = global.IDBKeyRange;
  global.BroadcastChannel = undefined;
  // Node has no IDBKeyRange global; writeBoardReadModel only uses .only() to
  // scope the retention-eviction cursor, which our fake cursor ignores.
  global.IDBKeyRange = { only: (value) => value };
  const fake = fakeIndexedDb(setup);
  global.indexedDB = fake.indexedDb;
  return run(fake).finally(() => {
    global.indexedDB = originalIndexedDb;
    global.BroadcastChannel = originalBroadcastChannel;
    global.IDBKeyRange = originalIdbKeyRange;
  });
}

test("readModelMarker: absent by default, set/read/clear round-trips", () => {
  const localStorage = useFakeLocalStorage();
  try {
    const { hasBoardReadModelMarker, setBoardReadModelMarker, clearBoardReadModelMarker } =
      jiti(path.join(root, "src/lib/boardSync/readModelMarker.ts"));

    assert.equal(hasBoardReadModelMarker(), false);
    setBoardReadModelMarker();
    assert.equal(hasBoardReadModelMarker(), true);
    clearBoardReadModelMarker();
    assert.equal(hasBoardReadModelMarker(), false);
  } finally {
    localStorage.restore();
  }
});

test("readModelMarker: a denied localStorage (private browsing) falls through to the local read, never throws", () => {
  // localStorage and IndexedDB are separately gated permissions. A browser
  // that denies localStorage but still allows IndexedDB (private mode is not
  // all-or-nothing) must keep running the keyed open -- "unknown" reads as
  // "may exist", matching today's behavior when databases() itself is denied.
  const originalLocalStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("SecurityError");
    },
    removeItem: () => {
      throw new Error("SecurityError");
    },
  };
  try {
    const { hasBoardReadModelMarker, setBoardReadModelMarker, clearBoardReadModelMarker } =
      jiti(path.join(root, "src/lib/boardSync/readModelMarker.ts"));

    assert.equal(
      hasBoardReadModelMarker(),
      true,
      "a denied localStorage must not disable the local read path -- fall through to the keyed open",
    );
    assert.doesNotThrow(() => setBoardReadModelMarker());
    assert.doesNotThrow(() => clearBoardReadModelMarker());
  } finally {
    globalThis.localStorage = originalLocalStorage;
  }
});

test("HTPR-5927: usePreparedBoardReadModel skips both indexedDB.databases() and the keyed open when the marker is absent", () => {
  // usePreparedBoardReadModel is a React hook; unit-testing its closure
  // without a renderer isn't practical, so this pins the structural
  // guarantee instead: the marker check returns before the dynamic import
  // that would otherwise reach indexedDbReadModel.ts's openDatabase(), so a
  // missing marker makes both indexedDB.databases() and indexedDB.open()
  // physically unreachable, not just untaken in some code path.
  const hook = read("src/hooks/Homepage/useSyncedBoardReadModel.ts");
  const prepareLocalRead = hook.slice(
    hook.indexOf("const promise = (async () => {"),
    hook.indexOf("preparedRef.current = { key: preparedKey"),
  );
  const markerCheckIndex = prepareLocalRead.indexOf(
    "if (!hasBoardReadModelMarker()) return null;",
  );
  const dynamicImportIndex = prepareLocalRead.indexOf(
    'await import("@/lib/boardSync/indexedDbReadModel")',
  );
  assert.ok(markerCheckIndex >= 0, "the marker check must exist in prepareLocalRead");
  assert.ok(dynamicImportIndex >= 0, "the lazy indexedDbReadModel import must exist");
  assert.ok(
    markerCheckIndex < dynamicImportIndex,
    "the marker check must return before indexedDbReadModel.ts (and therefore IndexedDB) is ever reached",
  );
  assert.doesNotMatch(hook, /indexedDB\.databases\(\)/);
});

test("HTPR-5927: writeBoardReadModel sets the marker on a successful snapshot write", async () => {
  const localStorage = useFakeLocalStorage();
  try {
    await withFakeIndexedDb({}, async (fake) => {
      const { hasBoardReadModelMarker } = jiti(
        path.join(root, "src/lib/boardSync/readModelMarker.ts"),
      );
      assert.equal(hasBoardReadModelMarker(), false);

      const { writeBoardReadModel } = jiti(
        path.join(root, "src/lib/boardSync/indexedDbReadModel.ts"),
      );
      const wrote = await writeBoardReadModel({
        accountId: fixture.accountId,
        projectId: fixture.projectId,
        payload: fixtureLocalPayload,
      });

      assert.equal(wrote, true);
      assert.equal(fake.puts.length, 1);
      assert.equal(hasBoardReadModelMarker(), true);
    });
  } finally {
    localStorage.restore();
  }
});

test("HTPR-5927: writeBoardReadModel does not set the marker when another tab's revocation wins", async () => {
  const localStorage = useFakeLocalStorage();
  try {
    const { boardReadModelKey, createBoardReadModelRevocation } = jiti(
      path.join(root, "src/lib/boardSync/contract.ts"),
    );
    const key = boardReadModelKey(fixture.accountId, fixture.projectId);
    const stub = createBoardReadModelRevocation(fixture.accountId, fixture.projectId);

    await withFakeIndexedDb({ existingByKey: new Map([[key, stub]]) }, async (fake) => {
      const { hasBoardReadModelMarker } = jiti(
        path.join(root, "src/lib/boardSync/readModelMarker.ts"),
      );
      const { writeBoardReadModel } = jiti(
        path.join(root, "src/lib/boardSync/indexedDbReadModel.ts"),
      );

      await writeBoardReadModel({
        accountId: fixture.accountId,
        projectId: fixture.projectId,
        payload: fixtureLocalPayload,
      });

      assert.equal(fake.puts.length, 0, "revocation must still win the write");
      assert.equal(
        hasBoardReadModelMarker(),
        false,
        "no snapshot was actually written, so the marker must not claim one exists",
      );
    });
  } finally {
    localStorage.restore();
  }
});

test("HTPR-5927: clearBoardReadModels (the full wipe) removes the marker", async () => {
  const localStorage = useFakeLocalStorage();
  try {
    const { setBoardReadModelMarker, hasBoardReadModelMarker } = jiti(
      path.join(root, "src/lib/boardSync/readModelMarker.ts"),
    );
    setBoardReadModelMarker();
    assert.equal(hasBoardReadModelMarker(), true);

    await withFakeIndexedDb({}, async (fake) => {
      const { clearBoardReadModels } = jiti(
        path.join(root, "src/lib/boardSync/indexedDbReadModel.ts"),
      );
      const cleared = await clearBoardReadModels();

      assert.equal(cleared, true);
      assert.ok(fake.deleteDatabaseCalled);
      assert.equal(hasBoardReadModelMarker(), false);
    });
  } finally {
    localStorage.restore();
  }
});

test("HTPR-5927: revokeBoardReadModel (one board's stub) leaves the marker alone -- the store still exists", async () => {
  const localStorage = useFakeLocalStorage();
  try {
    const { setBoardReadModelMarker, hasBoardReadModelMarker } = jiti(
      path.join(root, "src/lib/boardSync/readModelMarker.ts"),
    );
    setBoardReadModelMarker();

    await withFakeIndexedDb({}, async () => {
      const { revokeBoardReadModel } = jiti(
        path.join(root, "src/lib/boardSync/indexedDbReadModel.ts"),
      );
      await revokeBoardReadModel(fixture.accountId, fixture.projectId);

      assert.equal(
        hasBoardReadModelMarker(),
        true,
        "revoking a single board writes one stub -- other boards' snapshots may still be readable, so the marker must stay",
      );
    });
  } finally {
    localStorage.restore();
  }
});

test("HTPR-5927: clearBoardReadModelRevocation (lifting a revocation) leaves the marker alone", async () => {
  const localStorage = useFakeLocalStorage();
  try {
    const { setBoardReadModelMarker, hasBoardReadModelMarker } = jiti(
      path.join(root, "src/lib/boardSync/readModelMarker.ts"),
    );
    setBoardReadModelMarker();

    await withFakeIndexedDb({}, async () => {
      const { clearBoardReadModelRevocation } = jiti(
        path.join(root, "src/lib/boardSync/indexedDbReadModel.ts"),
      );
      await clearBoardReadModelRevocation(fixture.accountId, fixture.projectId);

      assert.equal(
        hasBoardReadModelMarker(),
        true,
        "lifting a revocation only removes one stub -- it never wipes the store",
      );
    });
  } finally {
    localStorage.restore();
  }
});
