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
// reach before the open board could repaint — ["projectsAll"] re-runs
// /api/projects/getAll, the account-wide authorization sweep and a section
// rebuild for every board, measured at p75 1.6s from receipt to render. Fetch
// only this board's tasks and patch its own cache entry instead. Reconnect keeps
// the full reconcile above: re-establishing the session is also when access to
// every board is re-proved and board metadata (renames, new shares) refreshes.
export async function reconcileActiveBoardTasks(
  queryClient: BoardQueryClient,
  projectId: number,
  userId: number,
): Promise<void> {
  const payload = await queryClient.fetchQuery({
    queryKey: BOARD_TASKS_KEY(projectId, userId),
    queryFn: () => fetchBoardTasks(projectId, userId),
    staleTime: 0,
  });
  // The list is globally keyed, so a response that started under a previous
  // account must never be patched into the current one. Fall back in that case
  // too: it is rare (account switch mid-request) and correctness wins.
  const cachedAccountId = (
    queryClient.getQueryData(["projectsAll"]) as
      | { accountId?: number }
      | undefined
  )?.accountId;
  const foreignAccount =
    cachedAccountId != null && cachedAccountId !== userId;
  // Nothing to patch yet (the account list is still loading) — fall back so the
  // open board can never be left showing stale tasks.
  if (
    foreignAccount ||
    !patchProjectIntoCache(queryClient, projectId, payload)
  ) {
    await reconcileActiveBoardQuery(queryClient, projectId);
  }
}
