import type { CalendarSyncPayloadV1 } from "./contract";
import {
  calendarReadModelKey,
  createCalendarReadModelSnapshot,
  isCalendarReadModelSnapshotV1,
  materializeCalendarReadModelSnapshot,
  shouldReplaceCalendarReadModelSnapshot,
  type CalendarReadModelSnapshotV1,
} from "./contract";
import type { CalendarVisibleRange } from "./range";
import { createSerializedLatestWriteQueue } from "./writeQueue";
import { canRunCalendarStorageOperation } from "./storageLifecycle";

const DATABASE_NAME = "hypertask-calendar-read-model";
const DATABASE_VERSION = 1;
const STORE_NAME = "ranges";
const ACCOUNT_INDEX = "accountId";
const CLEAR_MESSAGE = "clear-calendar-read-models";
const DELETE_TIMEOUT_MS = 2_000;
const MAX_RANGES_PER_ACCOUNT = 12;

let operationGeneration = 0;
let operationsDisabled = false;
const activeDatabases = new Set<IDBDatabase>();
const writeQueue = createSerializedLatestWriteQueue();

const operationCanRun = (startedGeneration: number) =>
  canRunCalendarStorageOperation({
    startedGeneration,
    currentGeneration: operationGeneration,
    operationsDisabled,
  });

const closeDatabase = (database: IDBDatabase | null): void => {
  if (!database) return;
  activeDatabases.delete(database);
  database.close();
};

const closeActiveDatabases = (): void => {
  for (const database of activeDatabases) closeDatabase(database);
};

const clearChannel = (() => {
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    const channel = new BroadcastChannel("hypertask-calendar-read-model-control");
    channel.addEventListener("message", (event) => {
      if (event.data !== CLEAR_MESSAGE) return;
      operationGeneration += 1;
      operationsDisabled = true;
      closeActiveDatabases();
    });
    return channel;
  } catch {
    return null;
  }
})();

const openDatabase = (startedGeneration: number): Promise<IDBDatabase | null> => {
  if (typeof indexedDB === "undefined" || !operationCanRun(startedGeneration)) {
    return Promise.resolve(null);
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
      const store = database.objectStoreNames.contains(STORE_NAME)
        ? request.transaction!.objectStore(STORE_NAME)
        : database.createObjectStore(STORE_NAME, { keyPath: "key" });
      if (!store.indexNames.contains(ACCOUNT_INDEX)) {
        store.createIndex(ACCOUNT_INDEX, ACCOUNT_INDEX, { unique: false });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled || !operationCanRun(startedGeneration)) {
        database.close();
        if (!settled) {
          settled = true;
          resolve(null);
        }
        return;
      }
      settled = true;
      activeDatabases.add(database);
      database.onversionchange = () => closeDatabase(database);
      resolve(database);
    };
    request.onerror = () => {
      if (!operationCanRun(startedGeneration)) resolve(null);
      else reject(request.error);
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      resolve(null);
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

const snapshotFingerprint = (snapshot: unknown): string | null => {
  try {
    return JSON.stringify(snapshot) ?? null;
  } catch {
    return null;
  }
};

const deleteCalendarReadModel = async (
  key: string,
  startedGeneration: number,
  expectedSnapshot: unknown,
): Promise<void> => {
  if (!operationCanRun(startedGeneration)) return;
  const expectedFingerprint = snapshotFingerprint(expectedSnapshot);
  if (expectedFingerprint == null) return;
  let database: IDBDatabase | null = null;
  try {
    database = await openDatabase(startedGeneration);
    if (!database || !operationCanRun(startedGeneration)) return;
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const complete = waitForTransaction(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const currentSnapshot = await requestValue(store.get(key));
    if (snapshotFingerprint(currentSnapshot) === expectedFingerprint) {
      store.delete(key);
    }
    await complete;
    if (!operationCanRun(startedGeneration)) return;
  } catch {
    // Corruption cleanup is best-effort. The authoritative request still runs.
  } finally {
    closeDatabase(database);
  }
};

export const readCalendarReadModel = async (
  accountId: number,
  range: CalendarVisibleRange,
  authorizationRevision?: string,
): Promise<CalendarSyncPayloadV1 | null> => {
  if (operationsDisabled) return null;
  const startedGeneration = operationGeneration;
  const key = calendarReadModelKey(accountId, range);
  let database: IDBDatabase | null = null;
  try {
    database = await openDatabase(startedGeneration);
    if (!database || !operationCanRun(startedGeneration)) return null;
    const transaction = database.transaction(STORE_NAME, "readonly");
    const complete = waitForTransaction(transaction);
    const snapshot = await requestValue(
      transaction.objectStore(STORE_NAME).get(key),
    );
    await complete;
    if (!operationCanRun(startedGeneration)) return null;
    if (
      !isCalendarReadModelSnapshotV1(snapshot, {
        accountId,
        authorizationRevision,
        range,
      })
    ) {
      if (snapshot != null) {
        await writeQueue.enqueueMaintenance(key, () =>
          deleteCalendarReadModel(key, startedGeneration, snapshot),
        );
      }
      return null;
    }
    return materializeCalendarReadModelSnapshot(snapshot);
  } catch {
    return null;
  } finally {
    closeDatabase(database);
  }
};

const persistCalendarReadModel = async (
  snapshot: CalendarReadModelSnapshotV1,
  startedGeneration: number,
): Promise<boolean> => {
  if (!operationCanRun(startedGeneration)) return false;

  let database: IDBDatabase | null = null;
  try {
    database = await openDatabase(startedGeneration);
    if (!database || !operationCanRun(startedGeneration)) return false;
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const complete = waitForTransaction(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const existing = await requestValue(store.get(snapshot.key));
    if (!shouldReplaceCalendarReadModelSnapshot(existing, snapshot)) {
      await complete;
      return false;
    }
    store.put(snapshot);

    const accountSnapshots: CalendarReadModelSnapshotV1[] = [];
    const cursorRequest = store
      .index(ACCOUNT_INDEX)
      .openCursor(IDBKeyRange.only(snapshot.accountId));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor) {
        accountSnapshots.push(cursor.value as CalendarReadModelSnapshotV1);
        cursor.continue();
        return;
      }
      accountSnapshots
        .sort(
          (left, right) =>
            Date.parse(right.retrievedAt) - Date.parse(left.retrievedAt),
        )
        .slice(MAX_RANGES_PER_ACCOUNT)
        .forEach((stale) => store.delete(stale.key));
    };

    await complete;
    return operationCanRun(startedGeneration);
  } catch {
    return false;
  } finally {
    closeDatabase(database);
  }
};

export const writeCalendarReadModel = (
  payload: CalendarSyncPayloadV1,
): Promise<boolean> => {
  const startedGeneration = operationGeneration;
  if (!operationCanRun(startedGeneration)) return Promise.resolve(false);
  const snapshot = createCalendarReadModelSnapshot({ payload });
  if (!snapshot) return Promise.resolve(false);
  return writeQueue
    .enqueue(snapshot.key, () =>
      persistCalendarReadModel(snapshot, startedGeneration),
    )
    .then((result) => result ?? false);
};

export const clearCalendarReadModels = async (): Promise<boolean> => {
  operationGeneration += 1;
  operationsDisabled = true;
  closeActiveDatabases();
  clearChannel?.postMessage(CLEAR_MESSAGE);
  if (typeof indexedDB === "undefined") return true;

  return new Promise<boolean>((resolve) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    let settled = false;
    const finish = (deleted: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(deleted);
    };
    const timeoutId = setTimeout(() => finish(false), DELETE_TIMEOUT_MS);
    request.onsuccess = () => finish(true);
    request.onerror = () => finish(false);
    request.onblocked = () => {
      closeActiveDatabases();
      clearChannel?.postMessage(CLEAR_MESSAGE);
    };
  });
};
