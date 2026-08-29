/**
 * Synchronous, session-scoped quarantine of denied boards.
 *
 * Durable revocation lives in the board read-model store itself: revoking
 * overwrites the snapshot with a stub that fails snapshot validation, so it is
 * exactly as durable as the data it replaced and survives reloads. This set
 * only has to close the window inside one session where a local read that
 * started before the revocation is still in flight.
 */
const quarantined = new Set<string>();

const tombstoneKey = (accountId: number, projectId: number) =>
  `${accountId}:${projectId}`;

// One key per board, written and removed whole. A shared list would need a
// read-modify-write and two tabs revoking at once would lose an entry.
const fallbackStorageKey = (accountId: number, projectId: number) =>
  `hypertask:board-revoked:${accountId}:${projectId}`;

const readFallbackFlag = (accountId: number, projectId: number): boolean => {
  try {
    return (
      globalThis.localStorage?.getItem(
        fallbackStorageKey(accountId, projectId),
      ) === "1"
    );
  } catch {
    return false;
  }
};

export const recordBoardRevocationTombstone = (
  accountId: number,
  projectId: number,
): void => {
  quarantined.add(tombstoneKey(accountId, projectId));
};

/**
 * Only for the case where the durable stub could not be written. The normal
 * path leaves nothing in localStorage.
 */
export const persistBoardRevocationFallback = (
  accountId: number,
  projectId: number,
): void => {
  try {
    globalThis.localStorage?.setItem(
      fallbackStorageKey(accountId, projectId),
      "1",
    );
  } catch {
    // Nothing left to fall back to; the session quarantine still holds.
  }
};

export const clearBoardRevocationTombstone = (
  accountId: number,
  projectId: number,
): void => {
  quarantined.delete(tombstoneKey(accountId, projectId));
  try {
    globalThis.localStorage?.removeItem(
      fallbackStorageKey(accountId, projectId),
    );
  } catch {
    // Ignore: a stale flag only costs one extra network-authorized publish.
  }
};

export const isBoardRevocationTombstoned = (
  accountId: number,
  projectId: number,
): boolean =>
  quarantined.has(tombstoneKey(accountId, projectId)) ||
  readFallbackFlag(accountId, projectId);
