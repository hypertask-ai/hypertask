export const BOARD_EVENT = "board:changed";
export const TASK_EVENT = "task:changed";
export const COMMENT_EVENT = "comment:changed";
export const INBOX_EVENT = "inbox:changed";
export const AGENT_CHAT_EVENT = "agent-chat:changed";
export const TIME_EVENT = "time:changed";
export const FEATURE_FLAGS_EVENT = "feature-flags:changed";

export const boardChannel = (projectId: number | string) => `private-project-${projectId}`;
export const taskChannel = (taskId: number | string) => `private-task-${taskId}`;
export const userChannel = (userId: number | string) => `private-user-${userId}`;
export const featureFlagsChannel = () => "private-feature-flags";
export const timeTaskChannel = (taskId: number | string) => `private-time-task-${taskId}`;
export const timeBoardChannel = (projectId: number | string) =>
  `private-time-project-${projectId}`;
