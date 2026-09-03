// Event names (kept stable; clients bind to these).
export const BOARD_EVENT = "board:changed"; // a task on a board changed
export const TASK_EVENT = "task:changed"; // task detail changed
export const COMMENT_EVENT = "comment:changed"; // a comment/activity on a task changed
export const INBOX_EVENT = "inbox:changed"; // a user's inbox/notifications changed
export const AGENT_CHAT_EVENT = "agent-chat:changed"; // a user's agent chat changed
export const TIME_EVENT = "time:changed"; // a timer on a task started/stopped
export const FEATURE_FLAGS_EVENT = "feature-flags:changed";

// Channel name builders (server and client must agree). All private.
export const boardChannel = (projectId: number | string) => `private-project-${projectId}`;
export const taskChannel = (taskId: number | string) => `private-task-${taskId}`;
export const userChannel = (userId: number | string) => `private-user-${userId}`;
export const featureFlagsChannel = () => "private-feature-flags";
// Timers get their own channels rather than sharing the task/board ones: those
// are subscribed and unsubscribed by other hooks, which would tear a timer
// listener out from under a still-mounted component (HTPR-4700).
export const timeTaskChannel = (taskId: number | string) => `private-time-task-${taskId}`;
export const timeBoardChannel = (projectId: number | string) =>
  `private-time-project-${projectId}`;
