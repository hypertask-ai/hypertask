import { TASK_SUMMARY_PROMPT } from "@/lib/ai/taskSummaryPrompt";

export const TASK_SUMMARY_ACTION = {
  label: "Summarize the current task",
  prompt: TASK_SUMMARY_PROMPT,
} as const;

export function taskSummaryActionFor(taskId?: number | null) {
  return taskId ? TASK_SUMMARY_ACTION : null;
}
