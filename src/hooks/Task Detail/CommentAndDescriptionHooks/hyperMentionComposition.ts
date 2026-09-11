/**
 * Resolve HyperAI mention targeting from values captured at send time.
 * Live currentTask/currentProject must not win after mid-upload navigation.
 */
export function resolveHyperMentionComposition(input: {
  composedForTaskId?: number;
  composedForOwnerId?: number;
  composedForProjectId?: number;
  composedForTeamId?: string;
  composedForTeamTitle?: string;
  composedRelatedTaskIds?: number[];
  currentTaskId?: number;
  currentOwnerId?: number;
  currentProjectId?: number;
  currentTeamId?: string;
  currentTeamTitle?: string;
}): {
  taskId: number | undefined;
  ownerId: number | undefined;
  projectId: number | undefined;
  teamId: string | undefined;
  teamTitle: string | undefined;
  taskIds: number[];
} {
  const taskId = input.composedForTaskId ?? input.currentTaskId;
  const ownerId = input.composedForOwnerId ?? input.currentOwnerId;
  const projectId = input.composedForProjectId ?? input.currentProjectId;
  const teamId = input.composedForTeamId ?? input.currentTeamId;
  const teamTitle = input.composedForTeamTitle ?? input.currentTeamTitle;
  const related = input.composedRelatedTaskIds ?? [];
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
