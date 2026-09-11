/**
 * Resolve HyperAI mention targeting from values captured at send time.
 * Live currentTask/currentProject must not win after mid-upload navigation.
 * When a composed task id is present, the whole composed snapshot is used;
 * otherwise the whole current snapshot is used. Fields are never mixed.
 */
export function resolveHyperMentionComposition(input: {
  composedForTaskId?: number;
  composedForOwnerId?: number | string;
  composedForProjectId?: number;
  currentTaskId?: number;
  currentOwnerId?: number | string;
  currentProjectId?: number;
}): {
  taskId: number | undefined;
  ownerId: number | string | undefined;
  projectId: number | undefined;
  taskIds: number[];
} {
  const useComposed = input.composedForTaskId != null;
  const taskId = useComposed ? input.composedForTaskId : input.currentTaskId;
  const ownerId = useComposed
    ? input.composedForOwnerId
    : input.currentOwnerId;
  const projectId = useComposed
    ? input.composedForProjectId
    : input.currentProjectId;
  return {
    taskId,
    ownerId,
    projectId,
    taskIds: [taskId].filter(
      (id): id is number => typeof id === "number" && Number.isFinite(id),
    ),
  };
}
