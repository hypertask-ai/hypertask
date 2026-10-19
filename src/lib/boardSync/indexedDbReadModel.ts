import type { BoardSyncPayloadV1 } from "./contract";
import {
  boardReadModelKey,
  createBoardReadModelRevocation,
  createBoardReadModelSnapshot,
  isBoardReadModelRevocationV1,
  isBoardReadModelSnapshotV1,
  materializeBoardReadModelSnapshot,
} from "./contract";
import { boardRetentionEvictionKeys } from "./retention";
import {
  clearBoardReadModelMarker,
  setBoardReadModelMarker,
} from "./readModelMarker";
import { requestValue, waitForTransaction } from "@/lib/indexedDb/transactionPromises";

const DATABASE_NAME = "hypertask-board-read-model";
const DATABASE_VERSION = 1;
const STORE_NAME = "boards";
const ACCOUNT_INDEX = "accountId";
const CLEAR_MESSAGE = "clear-board-read-models";
const DELETE_TIMEOUT_MS = 2_000;

const recordRecency = (record: unknown): string | null => {
  const savedAt = (record as { savedAt?: unknown })?.savedAt;
  if (typeof savedAt === "string") return savedAt;
  const revokedAt = (record as { revokedAt?: unknown })?.revokedAt;
  return typeof revokedAt === "string" ? revokedAt : null;
};

let operationGeneration = 0;
let operationsDisabled = false;
const activeDatabases = new Set<IDBDatabase>();

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
    const channel = new BroadcastChannel("hypertask-board-read-model-control");
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

const openDatabase = (): Promise<IDBDatabase | null> => {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    let settled = false;
    request.onupgradeneeded = () => {
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
      if (settled) {
        database.close();
        return;
      }
      settled = true;
      activeDatabases.add(database);
      database.onversionchange = () => closeDatabase(database);
      resolve(database);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      resolve(null);
    };
  });
};

export const readBoardReadModel = async (
  accountId: number,
  projectId: number,
): Promise<BoardSyncPayloadV1 | null> => {
  if (operationsDisabled) return null;
  const startedGeneration = operationGeneration;
  let database: IDBDatabase | null = null;
  try {
    database = await openDatabase();
    if (!database || startedGeneration !== operationGeneration) return null;
    const transaction = database.transaction(STORE_NAME, "readonly");
    const transactionComplete = waitForTransaction(transaction);
    const snapshot = await requestValue(
      transaction.objectStore(STORE_NAME).get(boardReadModelKey(accountId, projectId)),
    );
    await transactionComplete;
    if (startedGeneration !== operationGeneration) return null;
    if (!isBoardReadModelSnapshotV1(snapshot, accountId, projectId)) return null;
    return materializeBoardReadModelSnapshot(snapshot);
  } catch {
    return null;
  } finally {
    closeDatabase(database);
  }
};

export const writeBoardReadModel = async ({
  accountId,
  projectId,
  payload,
}: {
  accountId: number;
  projectId: number;
  payload: BoardSyncPayloadV1;
}): Promise<boolean> => {
  if (operationsDisabled) return false;
  const startedGeneration = operationGeneration;
  const snapshot = createBoardReadModelSnapshot({ accountId, projectId, payload });
  if (!snapshot) return false;

  let database: IDBDatabase | null = null;
  try {
    database = await openDatabase();
    if (!database || startedGeneration !== operationGeneration) return false;
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const transactionComplete = waitForTransaction(transaction);
    const store = transaction.objectStore(STORE_NAME);
    let wroteSnapshot = false;
    const existing = store.get(snapshot.key);
    existing.onsuccess = () => {
      if (isBoardReadModelRevocationV1(existing.result, accountId, projectId)) {
        return;
      }
      store.put(snapshot);
      wroteSnapshot = true;
    };

    const otherRecords: { key: string; recency: string }[] = [];
    const cursorRequest = store.index(ACCOUNT_INDEX).openCursor(IDBKeyRange.only(accountId));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) {
        boardRetentionEvictionKeys(otherRecords, snapshot.key).forEach((key) =>
          store.delete(key),
        );
        return;
      }
      if (cursor.primaryKey !== snapshot.key) {
        otherRecords.push({
          key: cursor.primaryKey as string,
          recency: recordRecency(cursor.value) ?? "",
        });
      }
      cursor.continue();
    };

    await transactionComplete;
    const committed = startedGeneration === operationGeneration;
    if (committed && wroteSnapshot) setBoardReadModelMarker();
    return committed;
  } catch {
    return false;
  } finally {
    closeDatabase(database);
  }
};

export const revokeBoardReadModel = async (
  accountId: number,
  projectId: number,
): Promise<boolean> => {
  if (operationsDisabled) return false;
  operationGeneration += 1;
  const revocationGeneration = operationGeneration;
  let database: IDBDatabase | null = null;
  try {
    database = await openDatabase();
    if (!database || revocationGeneration !== operationGeneration) return false;
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const transactionComplete = waitForTransaction(transaction);
    transaction
      .objectStore(STORE_NAME)
      .put(createBoardReadModelRevocation(accountId, projectId));
    await transactionComplete;
    return revocationGeneration === operationGeneration;
  } catch {
    return false;
  } finally {
    closeDatabase(database);
  }
};

export const clearBoardReadModelRevocation = async (
  accountId: number,
  projectId: number,
): Promise<void> => {
  if (operationsDisabled) return;
  let database: IDBDatabase | null = null;
  try {
    database = await openDatabase();
    if (!database) return;
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const transactionComplete = waitForTransaction(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const key = boardReadModelKey(accountId, projectId);
    const record = store.get(key);
    record.onsuccess = () => {
      if (!record.result) return;
      if (isBoardReadModelSnapshotV1(record.result, accountId, projectId)) return;
      store.delete(key);
    };
    await transactionComplete;
  } catch {
  } finally {
    closeDatabase(database);
  }
};

export const clearBoardReadModels = async (): Promise<boolean> => {
  operationGeneration += 1;
  operationsDisabled = true;
  closeActiveDatabases();
  clearChannel?.postMessage(CLEAR_MESSAGE);
  clearBoardReadModelMarker();
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
