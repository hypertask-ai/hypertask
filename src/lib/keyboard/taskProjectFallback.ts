import { useQuery } from "@tanstack/react-query";
import type { IProject } from "@/models/model";
import globalAPIHandlers from "@/utils/api/global";

export type TaskProjectFallbackResource = "assign" | "labels" | "sections";

export const taskProjectFallbackQueryKey = (
  resource: TaskProjectFallbackResource | null,
  projectId: number | null | undefined,
) => {
  if (resource === "assign") return ["assign", projectId] as const;
  if (resource === "labels") return ["projectLabels", projectId] as const;
  if (resource === "sections") return ["moveTaskModal", projectId] as const;
  return ["taskProjectFallback", null] as const;
};

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
  resource: TaskProjectFallbackResource | null,
): {
  project: IProject | null;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
} {
  const projectId = Number(taskProjectId);
  const shouldFetch =
    Boolean(resource) &&
    !currentProject &&
    Number.isInteger(projectId) &&
    projectId > 0;
  const query = useQuery({
    queryKey: taskProjectFallbackQueryKey(resource, taskProjectId),
    enabled: shouldFetch,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (resource === "assign") {
        return globalAPIHandlers.getMembersOwnersForAssignees(projectId);
      }
      if (resource === "labels") {
        return globalAPIHandlers.getAllProjectLabels(projectId);
      }
      if (resource === "sections") {
        return globalAPIHandlers.getSectionsForMoveTask(projectId);
      }
      throw new Error("Missing task project resource");
    },
  });

  let project = currentProject;
  if (!project && projectId > 0 && (!resource || query.isSuccess)) {
    if (resource === "assign") {
      project = query.data as IProject;
    } else {
      const resources = Array.isArray(query.data) ? query.data : [];
      project = {
        id: projectId,
        ...(resource === "labels" ? { labels: resources } : {}),
        ...(resource === "sections"
          ? { section: resources, sections: resources }
          : {}),
      } as IProject;
    }
  }

  return {
    project,
    isLoading: shouldFetch && query.isLoading,
    isError: shouldFetch && query.isError,
    error: shouldFetch ? query.error : null,
  };
}
