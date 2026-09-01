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

const DATABASE_NAME = "hypertask-board-read-model";
const DATABASE_VERSION = 1;
const STORE_NAME = "boards";
const ACCOUNT_INDEX = "accountId";
const CLEAR_MESSAGE = "clear-board-read-models";
const DELETE_TIMEOUT_MS = 2_000;

// Snapshots and revocation stubs share one key per board and record their own
// recency field (savedAt / revokedAt respectively) — this reads whichever is
// present so both compete on equal footing for the retained slots.
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
    // IndexedDB can be denied in private contexts. The server path remains the
    // source of truth and must keep working without local persistence.
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
    // Another tab may have revoked this board mid-write. Revocation wins until
    // fresh network authorization lifts it.
    let wroteSnapshot = false;
    const existing = store.get(snapshot.key);
    existing.onsuccess = () => {
      if (isBoardReadModelRevocationV1(existing.result, accountId, projectId)) {
        return;
      }
      store.put(snapshot);
      wroteSnapshot = true;
    };

    // HTPR-5753: the pilot keeps the RETENTION_LIMIT most-recently-written
    // boards per account (was 1, uncovering that cross-session board
    // rotation, not live in-session switching, was driving most network-path
    // loads). Whole-record eviction only: a stub occupies the same key as the
    // snapshot it masks, so deleting a key always drops both together, never
    // leaving one behind.
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
    // HTPR-5927: first successful snapshot write proves this origin has a
    // board-read-model database, so later loads can skip indexedDB.databases()
    // and go straight to the keyed open (see readModelMarker.ts).
    if (committed && wroteSnapshot) setBoardReadModelMarker();
    return committed;
  } catch {
    return false;
  } finally {
    closeDatabase(database);
  }
};

/**
 * Revoking overwrites the snapshot with a stub in a single put. Deleting the
 * record instead would leave nothing behind to say the board was denied, so a
 * reload could republish a snapshot whose deletion had failed.
 */
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

/**
 * Fresh network authorization is the only thing that lifts a revocation. A
 * valid snapshot is left alone: only the stub (or an unreadable record) goes.
 */
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
    // Nothing to recover: the board simply stays revoked locally until the
    // next authorization tries again.
  } finally {
    closeDatabase(database);
  }
};

export const clearBoardReadModels = async (): Promise<boolean> => {
  operationGeneration += 1;
  operationsDisabled = true;
  closeActiveDatabases();
  clearChannel?.postMessage(CLEAR_MESSAGE);
  // HTPR-5927: this deletes the whole database, so the marker (which only
  // claims "some snapshot may exist") must go with it. revokeBoardReadModel
  // and clearBoardReadModelRevocation, below, touch a single board's record
  // and leave the rest of the store intact, so they don't clear this.
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
      // Do not report success while another tab still owns a connection. The
      // BroadcastChannel/versionchange handlers close cooperating tabs; the
      // timeout lets logout continue while accurately reporting failure.
      closeActiveDatabases();
      clearChannel?.postMessage(CLEAR_MESSAGE);
    };
  });
};
