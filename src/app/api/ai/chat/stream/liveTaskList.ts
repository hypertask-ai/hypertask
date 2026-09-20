const TASK_TERM = /\b(?:tasks?|tickets?|cards?)\b/i;
const DIRECT_LIST_INTENT =
  /\b(?:list|enumerate|count)\b[^?.!]*\b(?:tasks|tickets|cards)\b/i;
const PLURAL_LIST_INTENT =
  /\b(?:show(?:\s+me)?(?:\s+all)?|all|any|how many)\b[^?.!]*\b(?:tasks|tickets|cards)\b/i;
const SET_QUESTION_INTENT =
  /\b(?:what|which)\b[^?.!]*\b(?:tasks|tickets|cards)\b(?=[^?.!]*\b(?:are|were|remain|exist)\b)/i;
const BOARD_SCOPED_QUESTION_INTENT =
  /\b(?:what|which)\b[^?.!]*\b(?:tasks|tickets|cards)\b[^?.!]*\b(?:this|the|current|that)\s+(?:board|project)\b/i;
const EXISTENCE_INTENT =
  /\b(?:are there|is there|do we have|does (?:this|the|current|that) (?:board|project) have)\b|\b(?:tasks?|tickets?|cards?)\s+exist\b/i;
const PERSONAL_POSSESSIVE_INTENT =
  /\bmy\s+(?![^?.!]*\b(?:boards?|projects?|teams?)\b[^?.!]*\b(?:tasks|tickets|cards|work|workload|assignments|responsibilities)\b)[^?.!]*\b(?:tasks|tickets|cards|work|workload|assignments|responsibilities)\b/i;
const PERSONAL_WORK_INTENT =
  /\b(?:mine|do i have|i have|am i (?:working|assigned|responsible)|i(?:'m| am) (?:working|assigned|responsible)|assigned to me|for me)\b/i;
const PRODUCT_HELP_INTENT =
  /\b(?:how to|how (?:do|can|could|should) (?:i|we))\b[^?.!]*\b(?:create|add|make|edit|update|delete|archive|move|assign|list|show)\b|\b(?:can|could|should|may) (?:i|we)\b[^?.!]*\b(?:create|add|make|edit|update|delete|archive|move|assign)\b/i;
const GLOBAL_TASK_SCOPE =
  /\b(?:all\s+(?:boards|projects)|every\s+(?:boards?|projects?)|(?:across|from)\s+(?:(?:(?:all|my|our)\s+)?(?:boards|projects)|every\s+(?:boards?|projects?)))\b/i;
const SEMANTIC_SEARCH_INTENT =
  /\b(?:find|search|matching|mention|mentioning|mentions|about|related to)\b/i;

export function isLiveTaskListRequest(message: string) {
  return (
    TASK_TERM.test(message) &&
    (DIRECT_LIST_INTENT.test(message) ||
      PLURAL_LIST_INTENT.test(message) ||
      SET_QUESTION_INTENT.test(message) ||
      BOARD_SCOPED_QUESTION_INTENT.test(message) ||
      EXISTENCE_INTENT.test(message)) &&
    !PERSONAL_POSSESSIVE_INTENT.test(message) &&
    !PERSONAL_WORK_INTENT.test(message) &&
    !PRODUCT_HELP_INTENT.test(message) &&
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
    (isLiveTaskListRequest(message) && !GLOBAL_TASK_SCOPE.test(message)
      ? defaultProjectId
      : undefined)
  );
}
