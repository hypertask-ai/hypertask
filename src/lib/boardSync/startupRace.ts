/**
 * A successful authorized network payload never inherits IndexedDB latency.
 * Only an unavailable network payload waits to learn whether local data can
 * preserve the already-authorized Board.
 */
export const resolveAuthorizedLocalFallback = async ({
  boardPayload,
  localBoardPublication,
}: {
  boardPayload: unknown | null;
  localBoardPublication: Promise<boolean>;
}): Promise<boolean> =>
  boardPayload === null ? await localBoardPublication : false;
