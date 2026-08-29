import type { QueryClient } from "@tanstack/react-query";

type BoardQueryClient = Pick<
  QueryClient,
  "invalidateQueries" | "refetchQueries"
>;

export const isBoardTasksQueryForProject = (
  queryKey: readonly unknown[],
  projectId: number,
): boolean =>
  queryKey[0] === "boardTasks" && queryKey[2] === projectId;

// `projectsAll` hydrates its active board from the five-minute `boardTasks`
// side cache. Expire that snapshot first, or an otherwise-correct refetch can
// republish stale tasks after a realtime event.
export async function reconcileActiveBoardQuery(
  queryClient: BoardQueryClient,
  projectId: number,
): Promise<void> {
  await queryClient.invalidateQueries({
    predicate: (query) =>
      isBoardTasksQueryForProject(query.queryKey, projectId),
  });
  await queryClient.refetchQueries({ queryKey: ["projectsAll"] });
}
