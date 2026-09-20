const TASK_TERM = /\b(?:tasks?|tickets?|cards?)\b/i;
const LIST_INTENT =
  /\b(?:list|show|enumerate|count|all|any|how many|what|which)\b/i;
const SEMANTIC_SEARCH_INTENT =
  /\b(?:find|search|matching|mentioning|mentions|about|related to)\b/i;

export function isLiveTaskListRequest(message: string) {
  return (
    TASK_TERM.test(message) &&
    LIST_INTENT.test(message) &&
    !SEMANTIC_SEARCH_INTENT.test(message)
  );
}

export function resolveLiveTaskListProjectId({
  message,
  projectId,
  boardId,
  defaultProjectId,
}: {
  message: string;
  projectId?: number;
  boardId?: number;
  defaultProjectId?: number;
}) {
  return (
    projectId ??
    boardId ??
    (isLiveTaskListRequest(message) ? defaultProjectId : undefined)
  );
}
