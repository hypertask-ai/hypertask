type TaskRelations = {
  projectId: number;
  parentTask?: {
    projectId: number;
    subTasks?: { projectId: number }[];
  } | null;
  subTasks?: { projectId: number }[];
};

export function stripForeignTaskRelations<T extends TaskRelations>(task: T): T {
  return {
    ...task,
    ...(task.parentTask !== undefined ? {
      parentTask: task.parentTask?.projectId === task.projectId
        ? {
            ...task.parentTask,
            ...(task.parentTask.subTasks ? {
              subTasks: task.parentTask.subTasks.filter((subTask) => subTask.projectId === task.projectId),
            } : {}),
          }
        : null,
    } : {}),
    ...(task.subTasks ? {
      subTasks: task.subTasks.filter((subTask) => subTask.projectId === task.projectId),
    } : {}),
  };
}
