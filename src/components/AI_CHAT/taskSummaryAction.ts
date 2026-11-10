export const TASK_SUMMARY_PROMPT =
  "Summarize the current task. First say what it is in one or two lines, then where it stands in one line, then up to three bullets for what is still open. No Next action line. No flag names, pull request numbers, screen sizes, or owner names.";

export const TASK_SUMMARY_ACTION = {
  label: "Summarize the current task",
  prompt: TASK_SUMMARY_PROMPT,
} as const;

export function taskSummaryActionFor(taskId?: number | null) {
  return taskId ? TASK_SUMMARY_ACTION : null;
}
