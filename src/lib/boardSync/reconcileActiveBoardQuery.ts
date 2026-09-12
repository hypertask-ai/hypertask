import type { QueryClient } from "@tanstack/react-query";
import {
  BOARD_TASKS_KEY,
  fetchBoardTasks,
  patchProjectIntoCache,
} from "@/utils/api/Homepage";

type BoardQueryClient = Pick<
  QueryClient,
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

// HTPR-6166: a change on one board used to refetch every project the account can
// reach before the open board could repaint. Fetch only this board's tasks and
// patch its own cache entry instead. Reconnect keeps the full reconcile above:
// re-establishing the session is also when access to every board is re-proved
// and board metadata (renames, new shares) refreshes.
export async function reconcileActiveBoardTasks(
  queryClient: BoardQueryClient,
  projectId: number,
  userId: number,
): Promise<void> {
  try {
    const payload = await queryClient.fetchQuery({
      queryKey: BOARD_TASKS_KEY(projectId, userId),
      queryFn: () => fetchBoardTasks(projectId, userId),
      staleTime: 0,
    });
    // Re-read the live cache at commit time. An account switch or a missing
    // project during the request must not write a foreign payload.
    if (!patchProjectIntoCache(queryClient, projectId, payload, userId)) {
      await reconcileActiveBoardQuery(queryClient, projectId);
    }
  } catch {
    // Access loss and fetch failures fall back to the account-wide path so a
    // revoked board cannot stay painted from the old cache.
    await reconcileActiveBoardQuery(queryClient, projectId);
  }
}
