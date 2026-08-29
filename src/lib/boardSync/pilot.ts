export const BOARD_SYNC_PILOT_PARAM = "local_db";
export const BOARD_SYNC_PILOT_STORAGE_KEY = "ht_board_sync_pilot";

export const resolveBoardSyncPilotEnabled = ({
  parameter,
  storedPreference,
  environmentEnabled,
}: {
  parameter?: string | null;
  storedPreference?: string | null;
  environmentEnabled?: boolean;
}): boolean => {
  if (environmentEnabled === false) return false;
  if (parameter === "0") return false;
  if (parameter === "1") return true;
  if (storedPreference === "0") return false;
  if (storedPreference === "1") return true;
  return environmentEnabled === true;
};

export const getBoardSyncPilotEnabled = (parameter?: string | null): boolean => {
  let storedPreference: string | null = null;
  if (typeof window !== "undefined") {
    try {
      storedPreference = window.localStorage.getItem(BOARD_SYNC_PILOT_STORAGE_KEY);
    } catch {
      // Storage access is optional; the URL/env flag still works.
    }
  }
  return resolveBoardSyncPilotEnabled({
    parameter,
    storedPreference,
    environmentEnabled:
      process.env.NEXT_PUBLIC_SYNCED_BOARD_CACHE !== "false",
  });
};

export const persistBoardSyncPilotPreference = (
  parameter?: string | null,
): void => {
  if (typeof window === "undefined" || (parameter !== "0" && parameter !== "1")) {
    return;
  }
  try {
    window.localStorage.setItem(BOARD_SYNC_PILOT_STORAGE_KEY, parameter);
  } catch {
    // A private browser may deny storage. The current URL still controls this load.
  }
};
