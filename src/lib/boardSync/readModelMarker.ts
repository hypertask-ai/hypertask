const MARKER_KEY = "ht_board_read_model_seen";

export const hasBoardReadModelMarker = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(MARKER_KEY) === "1";
  } catch {
    return true;
  }
};

export const setBoardReadModelMarker = (): void => {
  try {
    globalThis.localStorage?.setItem(MARKER_KEY, "1");
  } catch {
  }
};

export const clearBoardReadModelMarker = (): void => {
  try {
    globalThis.localStorage?.removeItem(MARKER_KEY);
  } catch {
  }
};
