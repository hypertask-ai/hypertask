export const buildTaskPayloadForAI = (task: any) => {
  const assigneeIds = task.assignees
    ?.map((x: { userId: any }) => x.userId)
    ?.filter((id: unknown): id is number => typeof id === "number");
  const followerIds = task.followers
    ?.map((x: { userId: any }) => x.userId)
    ?.filter((id: unknown): id is number => typeof id === "number");
  const priorityIndex = task.priority?.priority_index ?? null;
  const estimateIndex = task.estimate?.estimate_index ?? null;
  const labelIds = task.taskLabels
    ?.map((x: { labelId: any }) => x.labelId)
    ?.filter(
      (id: unknown): id is string => typeof id === "string" && id.length > 0
    );

  return {
    embed_nature: "task",
    taskId: task.id,
    projectId: task.projectId,
    createdAt: task.createdAt,
    createdBy: task.userId,
    creatorName: task.user.displayName,
    archivedAt: task.archivedAt ?? "",
    assignees: assigneeIds ?? [],
    commentCount: task.totalComments ?? task.commentCount,
    description: task.description_?.content.replaceAll(/\"/g, "'") ?? "",
    hasSubtasks: task.subTasks?.length > 0,
    isSubtask: !!task.parentTaskId,
    mentions: [...(followerIds ?? []), ...(assigneeIds ?? [])],
    priority: priorityIndex,
    estimate: estimateIndex,
    relatedToAndFromTasks: [
      ...(task.relatedFromTasks?.map(
        (x: { targetTaskId: any }) => x.targetTaskId
      ) ?? []),
      ...(task.relatedFromTasks?.map(
        (x: { sourceTaskId: any }) => x.sourceTaskId
      ) ?? []),
    ],
    size: estimateIndex,
    status: task.status,
    section_title: task.section,
    sectionId: task.sectionId,
    subtaskIds: task.subTasks?.map((x: { id: any }) => x.id),
    subtaskUniqueIndexes: task.subTasks?.map(
      (x: { uniqueIndex: any }) => x.uniqueIndex
    ),
    ticketNumber: task.ticketNumber,
    tagIds: labelIds ?? [],
    title: task.title,
    uniqueIndex: task.uniqueIndex,
  };
};
