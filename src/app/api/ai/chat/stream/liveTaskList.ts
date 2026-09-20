const TASK_TERM = /\b(?:tasks?|tickets?|cards?)\b/i;
const DIRECT_LIST_INTENT = /\b(?:list|enumerate|count)\b/i;
const PLURAL_LIST_INTENT =
  /\b(?:show(?:\s+all)?|all|any|how many|what|which)\b[^?.!]*\b(?:tasks|tickets|cards)\b/i;
const EXISTENCE_INTENT =
  /\b(?:are there|do we have|does (?:this|the|current|that) (?:board|project) have)\b|\b(?:tasks?|tickets?|cards?)\s+exist\b/i;
const PERSONAL_WORK_INTENT =
  /\b(?:my|mine|do i have|i have|am i working|assigned to me|for me)\b/i;
const SEMANTIC_SEARCH_INTENT =
  /\b(?:find|search|matching|mentioning|mentions|about|related to)\b/i;

export function isLiveTaskListRequest(message: string) {
  return (
    TASK_TERM.test(message) &&
    (DIRECT_LIST_INTENT.test(message) ||
      PLURAL_LIST_INTENT.test(message) ||
      EXISTENCE_INTENT.test(message)) &&
    !PERSONAL_WORK_INTENT.test(message) &&
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
