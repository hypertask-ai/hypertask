// HTPR-5927: whether a board-read-model snapshot has ever been written
// successfully in this browser. Split out (like retention.ts) so reading it
// costs nothing and never pulls in indexedDbReadModel.ts's BroadcastChannel
// side effect -- callers use it to skip the local read path entirely when
// unset, since a browser that has never written a snapshot has nothing for
// IndexedDB to offer.
const MARKER_KEY = "ht_board_read_model_seen";

export const hasBoardReadModelMarker = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(MARKER_KEY) === "1";
  } catch {
    return false;
  }
};

export const setBoardReadModelMarker = (): void => {
  try {
    globalThis.localStorage?.setItem(MARKER_KEY, "1");
  } catch {
    // Best effort: a missing marker just costs one extra databases()-free
    // skip that falls back to the network path, same as a first-ever visit.
  }
};

export const clearBoardReadModelMarker = (): void => {
  try {
    globalThis.localStorage?.removeItem(MARKER_KEY);
  } catch {
    // Best effort: a stale marker just costs one wasted keyed open() that
    // finds nothing, same as today's behavior for a missing database.
  }
};
