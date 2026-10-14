const quarantined = new Set<string>();

const tombstoneKey = (accountId: number, projectId: number) =>
  `${accountId}:${projectId}`;

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
  }
};

export const isBoardRevocationTombstoned = (
  accountId: number,
  projectId: number,
): boolean =>
  quarantined.has(tombstoneKey(accountId, projectId)) ||
  readFallbackFlag(accountId, projectId);
