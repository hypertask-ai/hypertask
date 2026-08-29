export const TASK_SUMMARY_ACTION = {
  label: "Summarize the current task",
  prompt: "/i Summarize the current task",
} as const;

export function taskSummaryActionFor(taskId?: number | null) {
  return taskId ? TASK_SUMMARY_ACTION : null;
}
