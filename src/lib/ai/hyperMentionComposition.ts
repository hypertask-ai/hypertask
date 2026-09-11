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
  composedForTeamId?: string;
  composedForTeamTitle?: string;
  composedRelatedTaskIds?: number[];
  currentTaskId?: number;
  currentOwnerId?: number | string;
  currentProjectId?: number;
  currentTeamId?: string;
  currentTeamTitle?: string;
  currentRelatedTaskIds?: Array<number | undefined | null>;
}): {
  taskId: number | undefined;
  ownerId: number | string | undefined;
  projectId: number | undefined;
  teamId: string | undefined;
  teamTitle: string | undefined;
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
  const teamId = useComposed ? input.composedForTeamId : input.currentTeamId;
  const teamTitle = useComposed
    ? input.composedForTeamTitle
    : input.currentTeamTitle;
  const related = useComposed
    ? input.composedRelatedTaskIds ?? []
    : input.currentRelatedTaskIds ?? [];
  return {
    taskId,
    ownerId,
    projectId,
    teamId,
    teamTitle,
    taskIds: [taskId, ...related].filter(
      (id): id is number => typeof id === "number" && Number.isFinite(id),
    ),
  };
}
