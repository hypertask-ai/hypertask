type MyTasksViewMemory = {
  viewId?: number | null;
  defaultViewId?: number | null;
  boardId?: number | null;
};

const storageKey = (userId: number) => `htpr-6938-my-tasks:${userId}`;
const validId = (value: unknown): value is number | null =>
  value === null || (typeof value === "number" && Number.isSafeInteger(value) && value > 0);

export function readMyTasksViewMemory(userId: number): MyTasksViewMemory {
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey(userId)) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return {
      ...(validId(value.viewId) && validId(value.defaultViewId)
        ? { viewId: value.viewId, defaultViewId: value.defaultViewId } : {}),
      ...(validId(value.boardId) ? { boardId: value.boardId } : {}),
    };
  } catch {
    return {};
  }
}

export function rememberMyTasksView(userId: number, selection: MyTasksViewMemory): void {
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify({
      ...readMyTasksViewMemory(userId), ...selection,
    }));
  } catch {
  }
}
