import type { QueryClient } from "@tanstack/react-query";
import {
  BOARD_TASKS_KEY,
  fetchBoardTasks,
  patchProjectIntoCache,
} from "@/utils/api/Homepage";

type BoardQueryClient = Pick<
  QueryClient,
  | "cancelQueries"
  | "fetchQuery"
  | "getQueryData"
  | "invalidateQueries"
  | "refetchQueries"
  | "setQueryData"
>;

export const isBoardTasksQueryForProject = (
  queryKey: readonly unknown[],
  projectId: number,
): boolean =>
  queryKey[0] === "boardTasks" && queryKey[2] === projectId;

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

export async function reconcileActiveBoardTasks(
  queryClient: BoardQueryClient,
  projectId: number,
  userId: number,
  options?: { background?: boolean },
): Promise<void> {
  let payload;
  try {
    const queryKey = BOARD_TASKS_KEY(projectId, userId);
    await queryClient.cancelQueries({ queryKey, exact: true }, { revert: false });
    payload = await queryClient.fetchQuery({
      queryKey,
      queryFn: () => fetchBoardTasks(projectId, userId),
      staleTime: 0,
    });
  } catch (error) {
    const status = (error as { response?: { status?: number } } | null)
      ?.response?.status;
    if (options?.background && status !== 401 && status !== 403 && status !== 404) {
      return;
    }
    await reconcileActiveBoardQuery(queryClient, projectId);
    return;
  }
  if (!patchProjectIntoCache(queryClient, projectId, payload, userId)) {
    await reconcileActiveBoardQuery(queryClient, projectId);
  }
}
