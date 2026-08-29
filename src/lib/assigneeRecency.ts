type AssigneeOption = {
  id: number | string;
  assigned?: boolean;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

type LockManagerLike = {
  request<T>(name: string, callback: () => T | PromiseLike<T>): Promise<T>;
};

const MAX_RECENT_ASSIGNEES = 50;
const STORAGE_PREFIX = "hypertask:recent-assignees:v1";

export const getAssigneeRecencyKey = (option: AssigneeOption) =>
  `${typeof option.id === "string" ? "agent" : "user"}:${option.id}`;

const getStorageKey = (currentUserId: number) =>
  `${STORAGE_PREFIX}:${currentUserId}`;

const getLockName = (currentUserId: number) =>
  `${STORAGE_PREFIX}:lock:${currentUserId}`;

export const getAssigneeRecencyStorage = (): StorageLike | undefined => {
  if (typeof window === "undefined") return undefined;

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

export const getAssigneeRecencyLockManager =
  (): LockManagerLike | undefined => {
    if (typeof navigator === "undefined") return undefined;

    try {
      return (navigator as Navigator & { locks?: LockManagerLike }).locks;
    } catch {
      return undefined;
    }
  };

export const readRecentAssigneeKeys = (
  storage: StorageLike | undefined,
  currentUserId: number | undefined,
): string[] => {
  if (!storage || currentUserId == null) return [];

  try {
    const parsed = JSON.parse(storage.getItem(getStorageKey(currentUserId)) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
};

export const recordRecentAssigneeUse = (
  storage: StorageLike | undefined,
  currentUserId: number | undefined,
  option: AssigneeOption,
  locks?: LockManagerLike,
) => {
  if (!storage || currentUserId == null || option.id === 0) return;

  const commit = () => {
    const optionKey = getAssigneeRecencyKey(option);
    const recentKeys = readRecentAssigneeKeys(storage, currentUserId);
    const nextKeys = [
      optionKey,
      ...recentKeys.filter((key) => key !== optionKey),
    ].slice(0, MAX_RECENT_ASSIGNEES);

    try {
      storage.setItem(getStorageKey(currentUserId), JSON.stringify(nextKeys));
    } catch {
      // Assignment still works when storage is unavailable or full.
    }
  };

  // Cross-tab recency is only safe inside an origin-wide lock. Assignment
  // remains fully functional when Web Locks are unavailable; in that case we
  // leave the existing order untouched instead of risking a stale overwrite.
  if (!locks) return;

  return locks.request(getLockName(currentUserId), commit).catch(() => undefined);
};

export const sortAssigneeOptionsByRecency = <T extends AssigneeOption>(
  options: T[],
  recentKeys: readonly string[],
): T[] => {
  const recentIndex = new Map(recentKeys.map((key, index) => [key, index]));

  return options
    .map((option, originalIndex) => ({ option, originalIndex }))
    .sort((a, b) => {
      const assignedOrder =
        Number(Boolean(b.option.assigned)) -
        Number(Boolean(a.option.assigned));
      if (assignedOrder !== 0) return assignedOrder;

      const aRecent = recentIndex.get(getAssigneeRecencyKey(a.option));
      const bRecent = recentIndex.get(getAssigneeRecencyKey(b.option));
      if (aRecent != null || bRecent != null) {
        if (aRecent == null) return 1;
        if (bRecent == null) return -1;
        if (aRecent !== bRecent) return aRecent - bRecent;
      }

      return a.originalIndex - b.originalIndex;
    })
    .map(({ option }) => option);
};
