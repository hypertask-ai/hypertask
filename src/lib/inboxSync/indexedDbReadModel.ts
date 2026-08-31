import type { InboxReadModelPayloadV1 } from "./contract";
import {
  createInboxReadModelSnapshot,
  inboxReadModelKey,
  isInboxReadModelSnapshotV1,
  materializeInboxReadModelSnapshot,
} from "./contract";
import {
  clearInboxReadModelRevisionStorage,
  compareInboxReadModelRevisions,
  currentInboxReadModelRevision,
  isInboxReadModelRevision,
  type InboxReadModelRevision,
} from "./revision";

const DATABASE_NAME = "hypertask-inbox-read-model";
const DATABASE_VERSION = 1;
const STORE_NAME = "inboxes";
const CLEAR_MESSAGE = "clear-inbox-read-models";
const DELETE_TIMEOUT_MS = 2_000;
const REVISION_FENCE_PREFIX = "revision-fence";

type InboxReadModelRevisionFence = {
  key: string;
  accountId: number;
  revision: InboxReadModelRevision;
};

const revisionFenceKey = (accountId: number): string =>
  `${REVISION_FENCE_PREFIX}:${accountId}`;

const isInboxReadModelRevisionFence = (
  value: unknown,
  accountId: number,
): value is InboxReadModelRevisionFence => {
  if (value == null || Array.isArray(value) || typeof value !== "object") {
    return false;
  }
  const fence = value as Partial<InboxReadModelRevisionFence>;
  return (
    fence.key === revisionFenceKey(accountId) &&
    fence.accountId === accountId &&
    isInboxReadModelRevision(fence.revision)
  );
};

let operationGeneration = 0;
let operationsDisabled = false;
const activeDatabases = new Set<IDBDatabase>();
const inFlightReadsByAccount = new Map<
  number,
  Promise<InboxReadModelPayloadV1 | null>
>();

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
    const channel = new BroadcastChannel("hypertask-inbox-read-model-control");
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
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" });
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

const readInboxReadModelOnce = async (
  accountId: number,
): Promise<InboxReadModelPayloadV1 | null> => {
  if (operationsDisabled) return null;
  const startedGeneration = operationGeneration;
  let database: IDBDatabase | null = null;
  try {
    database = await openDatabase();
    if (!database || startedGeneration !== operationGeneration) return null;
    const transaction = database.transaction(STORE_NAME, "readonly");
    const transactionComplete = waitForTransaction(transaction);
    const snapshot = await requestValue(
      transaction.objectStore(STORE_NAME).get(inboxReadModelKey(accountId)),
    );
    await transactionComplete;
    if (startedGeneration !== operationGeneration) return null;
    if (!isInboxReadModelSnapshotV1(snapshot, accountId)) {
      // Do not delete in a second transaction: another tab may have replaced
      // this invalid value after the read completed. A valid same-key write
      // safely replaces it later.
      return null;
    }
    return materializeInboxReadModelSnapshot(snapshot);
  } catch {
    // The authoritative query remains usable when IndexedDB is unavailable,
    // corrupt, or denied by the browser.
    return null;
  } finally {
    closeDatabase(database);
  }
};

export const readInboxReadModel = (
  accountId: number,
): Promise<InboxReadModelPayloadV1 | null> => {
  const inFlight = inFlightReadsByAccount.get(accountId);
  if (inFlight) return inFlight;

  const read = readInboxReadModelOnce(accountId);
  const trackedRead = read.finally(() => {
    if (inFlightReadsByAccount.get(accountId) === trackedRead) {
      inFlightReadsByAccount.delete(accountId);
    }
  });
  inFlightReadsByAccount.set(accountId, trackedRead);
  return trackedRead;
};

/**
 * HTPR-5847: opens (or reuses) the connection with no read, so it can be
 * started in parallel with the persisted-payload read -- by the time
 * readInboxReadModelRevisionFence needs it below, the expensive part
 * (indexedDB.open()) is already done. The fence itself still reads last,
 * right before the response-staleness check; only its connection cost moves
 * off the critical path, not its timing.
 */
export const openInboxReadModelConnection = async (): Promise<IDBDatabase | null> => {
  if (operationsDisabled) return null;
  try {
    return await openDatabase();
  } catch {
    return null;
  }
};

export const readInboxReadModelRevisionFence = async (
  accountId: number,
  preOpenedConnection?: IDBDatabase | null,
): Promise<InboxReadModelRevision | null> => {
  if (operationsDisabled) return null;
  const startedGeneration = operationGeneration;
  let database: IDBDatabase | null = null;
  try {
    database = preOpenedConnection ?? (await openDatabase());
    if (!database || startedGeneration !== operationGeneration) return null;
    const transaction = database.transaction(STORE_NAME, "readonly");
    const transactionComplete = waitForTransaction(transaction);
    const fence = await requestValue(
      transaction.objectStore(STORE_NAME).get(revisionFenceKey(accountId)),
    );
    await transactionComplete;
    if (
      startedGeneration !== operationGeneration ||
      !isInboxReadModelRevisionFence(fence, accountId)
    ) {
      return null;
    }
    return fence.revision;
  } catch {
    return null;
  } finally {
    closeDatabase(database);
  }
};

export const writeInboxReadModel = async ({
  accountId,
  payload,
}: {
  accountId: number;
  payload: InboxReadModelPayloadV1;
}): Promise<boolean> => {
  if (operationsDisabled) return false;
  const startedGeneration = operationGeneration;
  const snapshot = createInboxReadModelSnapshot({ accountId, payload });
  if (!snapshot) return false;

  let database: IDBDatabase | null = null;
  try {
    database = await openDatabase();
    if (!database || startedGeneration !== operationGeneration) return false;
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const transactionComplete = waitForTransaction(transaction);
    const store = transaction.objectStore(STORE_NAME);
    let accepted = false;
    const existingRequest = store.get(snapshot.key);
    const fenceRequest = store.get(revisionFenceKey(accountId));
    let existingResolved = false;
    let fenceResolved = false;
    const acceptSnapshotIfCurrent = () => {
      if (!existingResolved || !fenceResolved) return;
      const existing = existingRequest.result;
      const fence = fenceRequest.result;
      const latestObservedRevision = currentInboxReadModelRevision(accountId);
      if (
        (latestObservedRevision != null &&
          compareInboxReadModelRevisions(
            snapshot.revision,
            latestObservedRevision,
          ) < 0) ||
        (isInboxReadModelRevisionFence(fence, accountId) &&
          compareInboxReadModelRevisions(snapshot.revision, fence.revision) <
            0) ||
        (isInboxReadModelSnapshotV1(existing, accountId) &&
          compareInboxReadModelRevisions(
            existing.revision,
            snapshot.revision,
          ) >= 0)
      ) {
        return;
      }
      accepted = true;
      store.put(snapshot);
    };
    existingRequest.onsuccess = () => {
      existingResolved = true;
      acceptSnapshotIfCurrent();
    };
    fenceRequest.onsuccess = () => {
      fenceResolved = true;
      acceptSnapshotIfCurrent();
    };
    await transactionComplete;
    return accepted && startedGeneration === operationGeneration;
  } catch {
    return false;
  } finally {
    closeDatabase(database);
  }
};

export const writeInboxReadModelRevisionFence = async ({
  accountId,
  revision,
}: {
  accountId: number;
  revision: InboxReadModelRevision;
}): Promise<boolean> => {
  if (
    operationsDisabled ||
    !Number.isInteger(accountId) ||
    accountId <= 0 ||
    !isInboxReadModelRevision(revision)
  ) {
    return false;
  }
  const startedGeneration = operationGeneration;
  const fence: InboxReadModelRevisionFence = {
    key: revisionFenceKey(accountId),
    accountId,
    revision,
  };

  let database: IDBDatabase | null = null;
  try {
    database = await openDatabase();
    if (!database || startedGeneration !== operationGeneration) return false;
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const transactionComplete = waitForTransaction(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const snapshotRequest = store.get(inboxReadModelKey(accountId));
    const fenceRequest = store.get(fence.key);
    let snapshotResolved = false;
    let fenceResolved = false;
    let changed = false;
    const applyFence = () => {
      if (!snapshotResolved || !fenceResolved) return;
      const existingFence = fenceRequest.result;
      const effectiveRevision =
        isInboxReadModelRevisionFence(existingFence, accountId) &&
        compareInboxReadModelRevisions(existingFence.revision, revision) >= 0
          ? existingFence.revision
          : revision;
      if (
        !isInboxReadModelRevisionFence(existingFence, accountId) ||
        compareInboxReadModelRevisions(revision, existingFence.revision) > 0
      ) {
        store.put(fence);
        changed = true;
      }
      const existingSnapshot = snapshotRequest.result;
      if (
        isInboxReadModelSnapshotV1(existingSnapshot, accountId) &&
        compareInboxReadModelRevisions(
          existingSnapshot.revision,
          effectiveRevision,
        ) < 0
      ) {
        // The fence transaction is serialized with snapshot writes. It deletes
        // only the exact older account snapshot, never newer confirmed data.
        store.delete(inboxReadModelKey(accountId));
        changed = true;
      }
    };
    snapshotRequest.onsuccess = () => {
      snapshotResolved = true;
      applyFence();
    };
    fenceRequest.onsuccess = () => {
      fenceResolved = true;
      applyFence();
    };
    await transactionComplete;
    return changed && startedGeneration === operationGeneration;
  } catch {
    return false;
  } finally {
    closeDatabase(database);
  }
};

export const clearInboxReadModels = async (): Promise<boolean> => {
  clearInboxReadModelRevisionStorage();
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
