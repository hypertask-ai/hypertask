export const LEGACY_CREATE_TASK_DRAFT_PREFIX = "create-task-draft:";

export const purgeLegacyCreateTaskDrafts = () => {
  try {
    if (typeof localStorage === "undefined") return;
    const staleKeys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(LEGACY_CREATE_TASK_DRAFT_PREFIX)) staleKeys.push(key);
    }
    staleKeys.forEach((key) => localStorage.removeItem(key));
  } catch {}
};
