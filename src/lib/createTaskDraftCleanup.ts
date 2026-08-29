// The create-task composer used to persist a localStorage draft per user and
// board, then restore it the next time the modal opened. Valentin: the modal
// must always open blank and closing it must throw the entry away (HTPR-5537).
// This prefix only exists so drafts written by the old behaviour get cleaned
// up once, instead of sitting in storage forever.
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
