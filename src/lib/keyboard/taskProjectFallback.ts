import { useQuery } from "@tanstack/react-query";
import type { IProject } from "@/models/model";
import globalAPIHandlers from "@/utils/api/global";

export const taskProjectFallbackQueryKey = (
  userId: number | null | undefined,
  projectId: number | null | undefined,
) => ["taskProjectFallback", userId ?? null, projectId ?? null] as const;

export function resolveTaskProject<T extends { id: number }>(
  currentProject: T | null | undefined,
  taskProjectId: number | null | undefined,
  projects: readonly T[],
): T | null {
  if (currentProject) return currentProject;
  if (!taskProjectId) return null;
  return projects.find((project) => project.id === taskProjectId) ?? null;
}

export function useTaskProjectFallback(
  currentProject: IProject | null,
  taskProjectId: number | null | undefined,
  userId: number | null | undefined,
  enabled: boolean,
): { project: IProject | null; isLoading: boolean } {
  const shouldFetch =
    enabled &&
    !currentProject &&
    Boolean(userId) &&
    Number.isInteger(taskProjectId) &&
    Number(taskProjectId) > 0;
  const query = useQuery<IProject | null>({
    queryKey: taskProjectFallbackQueryKey(userId, taskProjectId),
    enabled: shouldFetch,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const projectId = Number(taskProjectId);
      const [project, labels, sections] = await Promise.all([
        globalAPIHandlers.getMembersOwnersForAssignees(projectId),
        globalAPIHandlers.getAllProjectLabels(projectId),
        globalAPIHandlers.getSectionsForMoveTask(projectId),
      ]);

      return {
        ...project,
        labels: labels ?? [],
        section: sections ?? [],
        sections: sections ?? [],
      } as IProject;
    },
  });

  return {
    project: currentProject ?? query.data ?? null,
    isLoading: shouldFetch && query.isLoading,
  };
}
