export function timeQuickLogUrl(boardId: number, taskId: number) {
  const params = new URLSearchParams({
    board: String(boardId),
    task: String(taskId),
    add: "1",
  });
  return `/time?${params.toString()}`;
}

export function timeQuickLogTaskUrl(
  taskId: number | null | undefined,
  taskBoardId: number | null | undefined,
  ambientBoardId: number | undefined
) {
  const boardId = taskBoardId ?? ambientBoardId;
  return taskId && boardId ? timeQuickLogUrl(boardId, taskId) : null;
}

export function timeQuickLogRequestKey(
  boardId: number | string | undefined,
  taskId: string | undefined,
  quickAdd: boolean
) {
  return quickAdd && boardId && taskId ? `${boardId}:${taskId}` : null;
}

export function shouldHydrateTimeQuickLog(
  requestKey: string | null,
  hydratedKey: string | null
) {
  return requestKey !== null && requestKey !== hydratedKey;
}
