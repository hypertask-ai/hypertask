type SectionWithId = {
  id?: number;
  sectionId?: number;
  wipLimit?: number | null;
};

type TaskWithSection = {
  status?: string;
  sectionId?: number;
  wipLimit?: number | null;
};

export const getManageColumnRows = <
  TSection extends SectionWithId,
  TTask extends TaskWithSection = TaskWithSection,
>(
  sections: readonly TSection[] | null | undefined,
  tasks: readonly TTask[] | null | undefined,
) => {
  const taskCountsBySectionId = new Map<number, number>();

  for (const task of tasks ?? []) {
    if (typeof task.sectionId !== "number" || (task.status && task.status !== "Normal")) continue;
    taskCountsBySectionId.set(
      task.sectionId,
      (taskCountsBySectionId.get(task.sectionId) ?? 0) + 1,
    );
  }

  return (sections ?? []).map((section) => {
    const sectionId = section.id ?? section.sectionId;
    const taskCount = typeof sectionId === "number"
      ? (taskCountsBySectionId.get(sectionId) ?? 0)
      : 0;
    return {
      section,
      taskCount,
      overLimit: section.wipLimit != null && taskCount > section.wipLimit,
    };
  });
};
