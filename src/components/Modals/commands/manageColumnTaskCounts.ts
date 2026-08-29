type SectionWithId = {
  id?: number;
  sectionId?: number;
};

type TaskWithSection = {
  sectionId?: number;
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
    if (typeof task.sectionId !== "number") continue;
    taskCountsBySectionId.set(
      task.sectionId,
      (taskCountsBySectionId.get(task.sectionId) ?? 0) + 1,
    );
  }

  return (sections ?? []).map((section) => {
    const sectionId = section.id ?? section.sectionId;
    return {
      section,
      taskCount:
        typeof sectionId === "number"
          ? (taskCountsBySectionId.get(sectionId) ?? 0)
          : 0,
    };
  });
};
