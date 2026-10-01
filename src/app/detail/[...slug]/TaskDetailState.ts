import type { TaskDetailProps, useTaskDetailStateValue } from "./useTaskDetailState";
import type { useTaskDetailModalsValue } from "./useTaskDetailModals";
export type TaskDetailState = TaskDetailProps & useTaskDetailStateValue & useTaskDetailModalsValue;
