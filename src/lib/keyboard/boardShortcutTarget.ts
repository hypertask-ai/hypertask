import type { QueryClient } from "@tanstack/react-query";

export const PROJECTS_MINIMAL_QUERY_KEY = "projectsAllMinimal";
export const BOARD_SHORTCUT_LIST_STALE_MS = 60_000;

type BoardRef = { id: number };
type FetchBoards = () => Promise<BoardRef[]>;

const boardListQuery = (userId: number, fetchBoards: FetchBoards) => ({
  queryKey: [PROJECTS_MINIMAL_QUERY_KEY, userId],
  queryFn: fetchBoards,
  staleTime: BOARD_SHORTCUT_LIST_STALE_MS,
});

export const firstAvailableBoard = (
  candidates: readonly unknown[],
  boards: readonly BoardRef[] | undefined,
): number | undefined =>
  candidates.find(
    (candidate): candidate is number =>
      Number.isInteger(candidate) &&
      !!boards?.some((board) => board.id === candidate),
  );

export const boardFromFreshList = async (
  queryClient: QueryClient,
  userId: number | undefined,
  candidates: readonly unknown[],
  fetchBoards: FetchBoards,
): Promise<number | undefined> => {
  const boards = userId
    ? await queryClient
        .fetchQuery(boardListQuery(userId, fetchBoards))
        .catch((): BoardRef[] => [])
    : [];
  return firstAvailableBoard(candidates, boards);
};

export const boardOnDevice = (
  queryClient: QueryClient,
  userId: number,
  candidates: readonly unknown[],
): number | undefined =>
  firstAvailableBoard(
    candidates,
    queryClient.getQueryData<BoardRef[]>([PROJECTS_MINIMAL_QUERY_KEY, userId]),
  ) ??
  firstAvailableBoard(
    candidates,
    queryClient.getQueryData<BoardRef[]>([PROJECTS_MINIMAL_QUERY_KEY]),
  );

export const boardFromDeviceFirst = async (
  queryClient: QueryClient,
  userId: number | undefined,
  candidates: readonly unknown[],
  fetchBoards: FetchBoards,
): Promise<number | undefined> => {
  const cachedBoard = userId
    ? boardOnDevice(queryClient, userId, candidates)
    : undefined;
  if (!userId || cachedBoard === undefined) {
    return boardFromFreshList(queryClient, userId, candidates, fetchBoards);
  }
  void queryClient.prefetchQuery(boardListQuery(userId, fetchBoards));
  return cachedBoard;
};
