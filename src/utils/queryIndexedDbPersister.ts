import type {
  PersistedClient,
  Persister,
} from "@tanstack/react-query-persist-client";

import {
  MAX_PERSISTED_CLIENT_BYTES,
  serializePersistedClientWithinBudget,
} from "@/utils/queryPersistence";

const DATABASE_NAME = "hypertask-query-cache";
const DATABASE_VERSION = 1;
const STORE_NAME = "clients";
const CLEAR_START_MESSAGE = "clear-query-cache-start";
const CLEAR_COMPLETE_MESSAGE = "clear-query-cache-complete";
const DELETE_TIMEOUT_MS = 2_000;
const REMOTE_DELETE_TIMEOUT_MS = DELETE_TIMEOUT_MS + 500;
const DEFAULT_THROTTLE_MS = 2_000;

export const QUERY_CACHE_RECORD_SCHEMA_VERSION = 1 as const;
export const LEGACY_QUERY_CACHE_STORAGE_KEY = "REACT_QUERY_OFFLINE_CACHE";
export const QUERY_PERSISTENCE_MODE_PARAM = "query_cache";
export const QUERY_PERSISTENCE_MODE_STORAGE_KEY =
  "ht_query_persistence_mode";

export type QueryPersistenceMode = "indexeddb" | "local" | "off";
export type DisposableQueryPersister = Persister & { dispose: () => void };

export type QueryCacheRecordV1 = {
  key: string;
  schemaVersion: typeof QUERY_CACHE_RECORD_SCHEMA_VERSION;
  accountId: number;
  revision: string;
  updatedAt: number;
  bytes: number;
  payload: Blob;
};

type QueryCacheStorage = {
  read: (accountId: number) => Promise<unknown>;
  write: (record: QueryCacheRecordV1) => Promise<void>;
  remove: (accountId: number, expectedRevision?: string) => Promise<void>;
};

type TimerHandle = ReturnType<typeof setTimeout>;

const accountCacheKey = (accountId: number) => `account:${accountId}`;
const accountLocalCacheKey = (accountId: number) =>
  `${LEGACY_QUERY_CACHE_STORAGE_KEY}:v2:user:${accountId}`;
const validAccountId = (accountId: number | null): accountId is number =>
  Number.isSafeInteger(accountId) && Number(accountId) > 0;

const createRevision = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}:${Math.random()}`;
};

const noOpPersister: DisposableQueryPersister = {
  dispose: () => undefined,
  persistClient: () => undefined,
  restoreClient: () => undefined,
  removeClient: () => undefined,
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && !Array.isArray(value) && typeof value === "object";

const isPersistedClient = (value: unknown): value is PersistedClient => {
  if (!isObject(value) || !isObject(value.clientState)) return false;
  const queries = value.clientState.queries;
  const mutations = value.clientState.mutations;
  return (
    Number.isFinite(value.timestamp) &&
    Number(value.timestamp) > 0 &&
    typeof value.buster === "string" &&
    Array.isArray(queries) &&
    queries.every(
      (query) =>
        isObject(query) &&
        Array.isArray(query.queryKey) &&
        typeof query.queryHash === "string" &&
        isObject(query.state),
    ) &&
    Array.isArray(mutations) &&
    mutations.every(
      (mutation) => isObject(mutation) && isObject(mutation.state),
    )
  );
};

const recordRevision = (value: unknown): string | undefined =>
  isObject(value) && typeof value.revision === "string"
    ? value.revision
    : undefined;

export const createQueryCacheRecord = (
  accountId: number,
  client: PersistedClient,
  revision = createRevision(),
): QueryCacheRecordV1 | null => {
  if (
    !validAccountId(accountId) ||
    !Number.isSafeInteger(client.timestamp) ||
    client.timestamp <= 0
  ) {
    return null;
  }
  const serialized = serializePersistedClientWithinBudget(client);
  const payload = new Blob([serialized], { type: "application/json" });
  if (payload.size > MAX_PERSISTED_CLIENT_BYTES) return null;
  return {
    key: accountCacheKey(accountId),
    schemaVersion: QUERY_CACHE_RECORD_SCHEMA_VERSION,
    accountId,
    revision,
    updatedAt: client.timestamp,
    bytes: payload.size,
    payload,
  };
};

const isOrderableQueryCacheRecord = (
  value: unknown,
): value is QueryCacheRecordV1 =>
  isObject(value) &&
  typeof value.key === "string" &&
  typeof value.accountId === "number" &&
  value.key === accountCacheKey(value.accountId) &&
  value.schemaVersion === QUERY_CACHE_RECORD_SCHEMA_VERSION &&
  validAccountId(value.accountId) &&
  typeof value.revision === "string" &&
  Number.isSafeInteger(value.updatedAt) &&
  Number(value.updatedAt) > 0 &&
  Number.isSafeInteger(value.bytes) &&
  Number(value.bytes) >= 0 &&
  Number(value.bytes) <= MAX_PERSISTED_CLIENT_BYTES &&
  value.payload instanceof Blob &&
  value.payload.size === value.bytes &&
  value.payload.type === "application/json";

export const shouldReplaceQueryCacheRecord = (
  existing: unknown,
  incoming: QueryCacheRecordV1,
) => {
  if (!isOrderableQueryCacheRecord(existing)) return true;
  if (incoming.updatedAt !== existing.updatedAt) {
    return incoming.updatedAt > existing.updatedAt;
  }
  return incoming.revision > existing.revision;
};

export const parseQueryCacheRecord = async (
  value: unknown,
  expectedAccountId: number,
): Promise<PersistedClient | null> => {
  if (!isObject(value)) return null;
  if (
    value.key !== accountCacheKey(expectedAccountId) ||
    value.schemaVersion !== QUERY_CACHE_RECORD_SCHEMA_VERSION ||
    value.accountId !== expectedAccountId ||
    typeof value.revision !== "string" ||
    !Number.isFinite(value.updatedAt) ||
    !Number.isSafeInteger(value.bytes) ||
    Number(value.bytes) < 0 ||
    Number(value.bytes) > MAX_PERSISTED_CLIENT_BYTES ||
    !(value.payload instanceof Blob) ||
    value.payload.size !== value.bytes ||
    value.payload.type !== "application/json"
  ) {
    return null;
  }

  try {
    // Response.json exposes an asynchronous parse boundary. Unlike the former
    // localStorage path, a cache up to 2 MB is never read and parsed in the
    // provider's synchronous startup call stack.
    const client = await new Response(value.payload).json();
    return isPersistedClient(client) ? client : null;
  } catch {
    return null;
  }
};

export const resolveQueryPersistenceMode = ({
  requestedMode,
  storedMode,
  indexedDbEnabled,
}: {
  requestedMode?: string | null;
  storedMode?: string | null;
  indexedDbEnabled?: boolean;
}): QueryPersistenceMode => {
  if (
    requestedMode === "indexeddb" ||
    requestedMode === "local" ||
    requestedMode === "off"
  ) {
    return requestedMode === "indexeddb" && indexedDbEnabled === false
      ? "local"
      : requestedMode;
  }
  if (
    storedMode === "indexeddb" ||
    storedMode === "local" ||
    storedMode === "off"
  ) {
    return storedMode === "indexeddb" && indexedDbEnabled === false
      ? "local"
      : storedMode;
  }
  return indexedDbEnabled === false ? "local" : "indexeddb";
};

let operationGeneration = 0;
let operationsDisabled = false;
const activeDatabases = new Set<IDBDatabase>();
let controlChannel: BroadcastChannel | null | undefined;
let deletionBarrier: Promise<boolean> | null = null;
let resolveDeletionBarrier: ((deleted: boolean) => void) | null = null;
let activeDeletionToken: string | null = null;
let deletionFailed = false;
let deletionBarrierTimeout: TimerHandle | null = null;
type QueryPersistenceLifecycle = {
  pause: () => void;
};
const activePersisterLifecycles = new Set<QueryPersistenceLifecycle>();

const pauseActivePersisters = () => {
  for (const lifecycle of activePersisterLifecycles) lifecycle.pause();
};

const beginDeletionBarrier = (token: string): Promise<boolean> => {
  if (deletionBarrier && activeDeletionToken === token) return deletionBarrier;
  resolveDeletionBarrier?.(false);
  activeDeletionToken = token;
  deletionBarrier = new Promise((resolve) => {
    resolveDeletionBarrier = resolve;
  });
  deletionBarrierTimeout = setTimeout(() => {
    finishDeletionBarrier(token, false);
  }, REMOTE_DELETE_TIMEOUT_MS);
  return deletionBarrier;
};

const finishDeletionBarrier = (token: string, deleted: boolean) => {
  if (activeDeletionToken !== token) return false;
  const resolve = resolveDeletionBarrier;
  activeDeletionToken = null;
  resolveDeletionBarrier = null;
  deletionBarrier = null;
  if (deletionBarrierTimeout !== null) {
    clearTimeout(deletionBarrierTimeout);
    deletionBarrierTimeout = null;
  }
  deletionFailed = !deleted;
  resolve?.(deleted);
  return true;
};

const clearLocalQueryStorage = () => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LEGACY_QUERY_CACHE_STORAGE_KEY);
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(`${LEGACY_QUERY_CACHE_STORAGE_KEY}:v2:user:`)) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Account-scoped local fallback cleanup is best-effort on sign-out.
  }
};

const closeDatabase = (database: IDBDatabase | null) => {
  if (!database) return;
  activeDatabases.delete(database);
  database.close();
};

const closeActiveDatabases = () => {
  for (const database of activeDatabases) closeDatabase(database);
};

export const handleQueryPersistenceControlMessage = (data: unknown) => {
  if (
    !isObject(data) ||
    typeof data.token !== "string" ||
    (data.type !== CLEAR_START_MESSAGE && data.type !== CLEAR_COMPLETE_MESSAGE)
  ) {
    return;
  }
  if (data.type === CLEAR_START_MESSAGE) {
    operationGeneration += 1;
    operationsDisabled = true;
    pauseActivePersisters();
    closeActiveDatabases();
    beginDeletionBarrier(data.token);
    // The sender removes these keys before posting. Removing them again in
    // each receiving tab closes the gap where a pending throttled local write
    // can run before the BroadcastChannel message is delivered.
    clearLocalQueryStorage();
    return;
  }
  const deleted = data.deleted === true;
  finishDeletionBarrier(data.token, deleted);
  // CLEAR_START is emitted by the full-account logout cleanup. Existing
  // QueryClients can still contain the departing account's data, so they stay
  // fenced even after deletion succeeds. Only a new server-authenticated
  // account boundary may create a persister in the new generation.
};

const getControlChannel = (): BroadcastChannel | null => {
  if (controlChannel !== undefined) return controlChannel;
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    controlChannel = null;
    return controlChannel;
  }
  try {
    controlChannel = new BroadcastChannel("hypertask-query-cache-control");
    controlChannel.addEventListener("message", (event) => {
      handleQueryPersistenceControlMessage(event.data);
    });
  } catch {
    controlChannel = null;
  }
  return controlChannel;
};

const operationCanRun = (startedGeneration: number) =>
  !operationsDisabled && startedGeneration === operationGeneration;

const openDatabase = (startedGeneration: number): Promise<IDBDatabase> => {
  if (typeof indexedDB === "undefined" || !operationCanRun(startedGeneration)) {
    return Promise.reject(new Error("IndexedDB query persistence unavailable"));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    let settled = false;
    request.onupgradeneeded = () => {
      if (!operationCanRun(startedGeneration)) {
        request.transaction?.abort();
        return;
      }
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled || !operationCanRun(startedGeneration)) {
        database.close();
        if (!settled) reject(new Error("IndexedDB query persistence stopped"));
        return;
      }
      settled = true;
      activeDatabases.add(database);
      database.onversionchange = () => closeDatabase(database);
      resolve(database);
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(request.error ?? new Error("Could not open query cache"));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error("Query cache database is blocked"));
    };
  });
};

const waitForTransaction = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });

const requestValue = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const indexedDbStorage: QueryCacheStorage = {
  read: async (accountId) => {
    const startedGeneration = operationGeneration;
    let database: IDBDatabase | null = null;
    try {
      database = await openDatabase(startedGeneration);
      if (!operationCanRun(startedGeneration)) return undefined;
      const transaction = database.transaction(STORE_NAME, "readonly");
      const complete = waitForTransaction(transaction);
      const value = await requestValue(
        transaction.objectStore(STORE_NAME).get(accountCacheKey(accountId)),
      );
      await complete;
      return operationCanRun(startedGeneration) ? value : undefined;
    } finally {
      closeDatabase(database);
    }
  },
  write: async (record) => {
    const startedGeneration = operationGeneration;
    let database: IDBDatabase | null = null;
    try {
      database = await openDatabase(startedGeneration);
      if (!operationCanRun(startedGeneration)) return;
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const complete = waitForTransaction(transaction);
      const store = transaction.objectStore(STORE_NAME);
      const existingRecord = await requestValue(store.get(record.key));
      if (shouldReplaceQueryCacheRecord(existingRecord, record)) {
        store.put(record);
      }
      await complete;
    } finally {
      closeDatabase(database);
    }
  },
  remove: async (accountId, expectedRevision) => {
    const startedGeneration = operationGeneration;
    let database: IDBDatabase | null = null;
    try {
      database = await openDatabase(startedGeneration);
      if (!operationCanRun(startedGeneration)) return;
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const complete = waitForTransaction(transaction);
      const store = transaction.objectStore(STORE_NAME);
      const key = accountCacheKey(accountId);
      if (expectedRevision === undefined) {
        store.delete(key);
      } else {
        const current = await requestValue(store.get(key));
        if (recordRevision(current) === expectedRevision) store.delete(key);
      }
      await complete;
    } finally {
      closeDatabase(database);
    }
  },
};

const retireUnscopedLegacyCache = (
  storage?: Pick<Storage, "removeItem"> | null,
) => {
  try {
    storage?.removeItem(LEGACY_QUERY_CACHE_STORAGE_KEY);
  } catch {
    // Storage cleanup is best-effort; the unscoped value is never hydrated.
  }
};

const retireLegacyCachesAfterIndexedDbRead = (
  storage: Pick<Storage, "removeItem"> | null,
  accountId: number,
) => {
  retireUnscopedLegacyCache(storage);
  try {
    storage?.removeItem(accountLocalCacheKey(accountId));
  } catch {
    // The account-scoped fallback is never read while IndexedDB is active.
  }
};

const beginRestoreMeasurement = (): number | null =>
  typeof window === "undefined" ? null : performance.now();

const finishRestoreMeasurement = (startedAt: number | null) => {
  if (startedAt === null) return;
  try {
    performance.measure("ht-query-cache-restore", {
      start: startedAt,
      end: performance.now(),
    });
  } catch {
    // Performance measurement is diagnostic only.
  }
};

export const createIndexedDbQueryPersister = ({
  accountId,
  storage = indexedDbStorage,
  legacyStorage =
    typeof window === "undefined" ? null : window.localStorage,
  throttleMs = DEFAULT_THROTTLE_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}: {
  accountId: number | null;
  storage?: QueryCacheStorage;
  legacyStorage?: Pick<Storage, "removeItem"> | null;
  throttleMs?: number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}): DisposableQueryPersister => {
  if (!validAccountId(accountId)) return noOpPersister;
  const persisterOperationGeneration = operationGeneration;
  let disposed = false;
  const persisterCanRun = () =>
    !disposed && operationCanRun(persisterOperationGeneration);
  let pendingClient: PersistedClient | undefined;
  let timer: TimerHandle | null = null;
  let writeInFlight = false;
  let persisterGeneration = 0;
  let restoredRevision: string | undefined;

  const cancelPending = () => {
    persisterGeneration += 1;
    pendingClient = undefined;
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };
  const lifecycle: QueryPersistenceLifecycle = { pause: cancelPending };
  activePersisterLifecycles.add(lifecycle);

  const scheduleWrite = () => {
    if (timer !== null || writeInFlight || !pendingClient) return;
    timer = setTimer(() => {
      timer = null;
      const client = pendingClient;
      pendingClient = undefined;
      if (!client || !persisterCanRun()) return;
      const record = createQueryCacheRecord(accountId, client);
      if (!record) return;
      const writeGeneration = persisterGeneration;
      writeInFlight = true;
      void storage
        .write(record)
        .catch(() => undefined)
        .then(async () => {
          if (writeGeneration !== persisterGeneration) {
            await storage
              .remove(accountId, record.revision)
              .catch(() => undefined);
          }
        })
        .finally(() => {
          writeInFlight = false;
          scheduleWrite();
        });
    }, throttleMs);
  };

  return {
    dispose: () => {
      disposed = true;
      cancelPending();
      activePersisterLifecycles.delete(lifecycle);
    },
    persistClient: (client) => {
      if (disposed || !persisterCanRun()) return;
      pendingClient = client;
      scheduleWrite();
    },
    restoreClient: async () => {
      if (disposed || !persisterCanRun()) return undefined;
      const restoreStartedAt = beginRestoreMeasurement();
      const restoreOperationGeneration = operationGeneration;
      const restorePersisterGeneration = persisterGeneration;
      const restoreCanFinish = () =>
        operationCanRun(restoreOperationGeneration) &&
        restorePersisterGeneration === persisterGeneration;
      try {
        const record = await storage.read(accountId);
        if (!restoreCanFinish()) return undefined;
        retireLegacyCachesAfterIndexedDbRead(legacyStorage, accountId);
        if (record === undefined) return undefined;
        const revision = recordRevision(record);
        const client = await parseQueryCacheRecord(record, accountId);
        if (!restoreCanFinish()) return undefined;
        if (client && revision !== undefined) {
          const currentRecord = await storage.read(accountId);
          if (
            !restoreCanFinish() ||
            recordRevision(currentRecord) !== revision
          ) {
            return undefined;
          }
          restoredRevision = revision;
          return client;
        }
        if (revision !== undefined && restoreCanFinish()) {
          await storage.remove(accountId, revision).catch(() => undefined);
        }
      } catch {
        // IndexedDB can be denied or blocked. The network remains the source
        // of truth, and query_cache=local is the explicit fallback switch.
      } finally {
        finishRestoreMeasurement(restoreStartedAt);
      }
      return undefined;
    },
    removeClient: async () => {
      cancelPending();
      if (persisterCanRun()) {
        await storage
          .remove(accountId, restoredRevision)
          .catch(() => undefined);
      }
      restoredRevision = undefined;
    },
  };
};

const createLocalQueryPersister = (
  accountId: number,
  initialOperationGeneration: number,
): DisposableQueryPersister => {
  const key = accountLocalCacheKey(accountId);
  const persisterOperationGeneration = initialOperationGeneration;
  let disposed = false;
  let pendingClient: PersistedClient | undefined;
  let timer: TimerHandle | null = null;
  let restoredValue: string | undefined;
  const canRun = () =>
    !disposed && operationCanRun(persisterOperationGeneration);
  const cancelPending = () => {
    pendingClient = undefined;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const lifecycle: QueryPersistenceLifecycle = { pause: cancelPending };
  activePersisterLifecycles.add(lifecycle);

  return {
    dispose: () => {
      disposed = true;
      cancelPending();
      activePersisterLifecycles.delete(lifecycle);
    },
    persistClient: (client) => {
      if (!canRun()) return;
      pendingClient = client;
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        const pending = pendingClient;
        pendingClient = undefined;
        if (!pending || !canRun()) return;
        try {
          const serialized = serializePersistedClientWithinBudget(pending);
          const current = window.localStorage.getItem(key);
          if (current) {
            try {
              const currentClient = JSON.parse(current);
              if (
                isPersistedClient(currentClient) &&
                (currentClient.timestamp > pending.timestamp ||
                  (currentClient.timestamp === pending.timestamp &&
                    current >= serialized))
              ) {
                return;
              }
            } catch {
              // A valid current snapshot replaces corrupt fallback data.
            }
          }
          window.localStorage.setItem(key, serialized);
        } catch {
          // The local fallback is best-effort; network data remains canonical.
        }
      }, DEFAULT_THROTTLE_MS);
    },
    restoreClient: () => {
      if (!canRun()) return undefined;
      const restoreStartedAt = beginRestoreMeasurement();
      try {
        const current = window.localStorage.getItem(key);
        if (!current) return undefined;
        const client = JSON.parse(current);
        if (!isPersistedClient(client)) {
          if (window.localStorage.getItem(key) === current) {
            window.localStorage.removeItem(key);
          }
          return undefined;
        }
        restoredValue = current;
        return client;
      } catch {
        return undefined;
      } finally {
        finishRestoreMeasurement(restoreStartedAt);
      }
    },
    removeClient: () => {
      cancelPending();
      if (!canRun()) return;
      try {
        const current = window.localStorage.getItem(key);
        if (restoredValue === undefined || current === restoredValue) {
          window.localStorage.removeItem(key);
        }
      } catch {
        // Conditional cleanup is best-effort in restricted storage contexts.
      } finally {
        restoredValue = undefined;
      }
    },
  };
};

const createReadyQueryPersister = (
  accountId: number,
): DisposableQueryPersister => {
  if (typeof window === "undefined") return noOpPersister;
  // A completed logout advances the global generation before deleting data.
  // A newly server-authenticated account may resume only in that new
  // generation; persisters created before logout remain permanently fenced.
  operationsDisabled = false;
  const persisterOperationGeneration = operationGeneration;
  getControlChannel();
  let requestedMode: string | null = null;
  let storedMode: string | null = null;
  try {
    requestedMode = new URLSearchParams(window.location.search).get(
      QUERY_PERSISTENCE_MODE_PARAM,
    );
    storedMode = window.localStorage.getItem(
      QUERY_PERSISTENCE_MODE_STORAGE_KEY,
    );
    if (
      requestedMode === "indexeddb" ||
      requestedMode === "local" ||
      requestedMode === "off"
    ) {
      window.localStorage.setItem(
        QUERY_PERSISTENCE_MODE_STORAGE_KEY,
        requestedMode,
      );
    }
  } catch {
    // Storage access is optional; the environment default still applies.
  }

  const mode = resolveQueryPersistenceMode({
    requestedMode,
    storedMode,
    indexedDbEnabled:
      process.env.NEXT_PUBLIC_QUERY_CACHE_INDEXED_DB !== "false",
  });
  if (mode === "off") return noOpPersister;
  if (mode === "indexeddb" && typeof indexedDB !== "undefined") {
    return createIndexedDbQueryPersister({ accountId });
  }

  // Local mode owns the account-scoped key below. Retire only the former
  // unscoped cache so the fallback survives reloads.
  retireUnscopedLegacyCache(window.localStorage);
  return createLocalQueryPersister(accountId, persisterOperationGeneration);
};

const createDeletionAwareQueryPersister = (
  accountId: number,
): DisposableQueryPersister => {
  let disposed = false;
  let delegate: DisposableQueryPersister | null = null;
  const getDelegate = async () => {
    if (disposed) return null;
    const deleted = await ensureQueryCacheDeletion();
    if (!deleted || disposed) return null;
    delegate ??= createReadyQueryPersister(accountId);
    return delegate;
  };

  return {
    dispose: () => {
      disposed = true;
      delegate?.dispose();
    },
    persistClient: async (client) => {
      const ready = await getDelegate();
      await ready?.persistClient(client);
    },
    restoreClient: async () => {
      const ready = await getDelegate();
      return ready?.restoreClient();
    },
    removeClient: async () => {
      const ready = await getDelegate();
      await ready?.removeClient();
    },
  };
};

export const createQueryPersister = (
  accountId: number | null,
): DisposableQueryPersister => {
  if (typeof window === "undefined") return noOpPersister;
  if (!validAccountId(accountId)) {
    retireUnscopedLegacyCache(window.localStorage);
    return noOpPersister;
  }
  return deletionBarrier || deletionFailed
    ? createDeletionAwareQueryPersister(accountId)
    : createReadyQueryPersister(accountId);
};

const ensureQueryCacheDeletion = async (): Promise<boolean> => {
  if (deletionBarrier) return deletionBarrier;
  if (deletionFailed) return startQueryCacheDeletion();
  return true;
};

const startQueryCacheDeletion = (): Promise<boolean> => {
  if (deletionBarrier) return deletionBarrier;
  const token = createRevision();
  operationGeneration += 1;
  operationsDisabled = true;
  pauseActivePersisters();
  closeActiveDatabases();
  const barrier = beginDeletionBarrier(token);
  getControlChannel()?.postMessage({ type: CLEAR_START_MESSAGE, token });
  clearLocalQueryStorage();
  const finish = (deleted: boolean) => {
    getControlChannel()?.postMessage({
      type: CLEAR_COMPLETE_MESSAGE,
      token,
      deleted,
    });
    finishDeletionBarrier(token, deleted);
  };
  if (typeof indexedDB === "undefined") {
    finish(true);
    return barrier;
  }

  void new Promise<boolean>((resolve) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    let settled = false;
    const settle = (deleted: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(deleted);
    };
    const timeoutId = setTimeout(() => settle(false), DELETE_TIMEOUT_MS);
    request.onsuccess = () => settle(true);
    request.onerror = () => settle(false);
    request.onblocked = () => {
      closeActiveDatabases();
      getControlChannel()?.postMessage({ type: CLEAR_START_MESSAGE, token });
    };
  }).then(finish, () => finish(false));
  return barrier;
};

export const clearQueryPersistence = (): Promise<boolean> =>
  startQueryCacheDeletion();
