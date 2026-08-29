import type { TAiMode } from "@/models/AI_Task_writer_model";

type TaskReference = { id?: number | null };

export type TaskWriterContextTask = TaskReference & {
  parentTask?: TaskReference | null;
  subTasks?: TaskReference[] | null;
  relatedFromTasks?: Array<{ targetTask?: TaskReference | null }> | null;
  relatedToTasks?: Array<{ sourceTask?: TaskReference | null }> | null;
};

export function getTaskWriterTaskIds(
  currentTask: TaskWriterContextTask | null | undefined,
  aiMode: TAiMode
) {
  if (!currentTask?.id) return [];

  const ids =
    aiMode === "WriteWithAI"
      ? [
          currentTask.id,
          currentTask.parentTask?.id,
          ...(currentTask.subTasks ?? []).map((task) => task.id),
          ...(currentTask.relatedFromTasks ?? []).map(
            (relation) => relation.targetTask?.id
          ),
          ...(currentTask.relatedToTasks ?? []).map(
            (relation) => relation.sourceTask?.id
          ),
        ]
      : [currentTask.id];

  return Array.from(
    new Set(
      ids.filter(
        (id): id is number =>
          typeof id === "number" && Number.isInteger(id) && id > 0
      )
    )
  );
}
