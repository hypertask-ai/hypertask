import { clearBoardRevocationTombstone } from "@/lib/boardSync/revocationTombstone";

export const clearAllLocalReadModels = async (): Promise<boolean> => {
  const [
    { clearBoardReadModels },
    { clearInboxReadModels },
    { clearCalendarReadModels },
    { clearQueryPersistence },
  ] = await Promise.all([
    import("@/lib/boardSync/indexedDbReadModel"),
    import("@/lib/inboxSync/indexedDbReadModel"),
    import("@/lib/calendarSync/indexedDbReadModel"),
    import("@/utils/queryIndexedDbPersister"),
  ]);
  const results = await Promise.all([
    clearBoardReadModels(),
    clearInboxReadModels(),
    clearCalendarReadModels(),
    clearQueryPersistence(),
  ]);
  return results.every(Boolean);
};

export const clearRevokedBoardReadModel = async (
  accountId: number,
  projectId: number,
): Promise<boolean> => {
  const { revokeBoardReadModel } = await import(
    "@/lib/boardSync/indexedDbReadModel"
  );
  return revokeBoardReadModel(accountId, projectId);
};

export const clearRevokedBoardMarker = async (
  accountId: number,
  projectId: number,
): Promise<void> => {
  // Synchronous first so a publication started in the same tick already sees
  // the board as authorized again.
  clearBoardRevocationTombstone(accountId, projectId);
  const { clearBoardReadModelRevocation } = await import(
    "@/lib/boardSync/indexedDbReadModel"
  );
  await clearBoardReadModelRevocation(accountId, projectId);
};
