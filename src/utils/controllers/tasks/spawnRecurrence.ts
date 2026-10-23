import prisma from "@/lib/prisma";
import { createTaskCore } from "./createTaskCore";
import { isRecurrenceRule, nextOccurrence } from "@/lib/recurrence";
import { columnRoleFor } from "@/lib/mcp/boards/columnRole";
import { broadcastBoardChange } from "@/lib/realtime/server";
import { scheduleDueDateJob } from "@/pages/api/queues/duedateQueue";

export async function spawnNextRecurrence(
  taskId: number,
  anchorDate?: Date | null,
): Promise<number | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      description_: { select: { content: true } },
      priority: { select: { priority_index: true } },
      estimate: { select: { estimate_index: true } },
      taskLabels: { select: { labelId: true } },
      assignees: { select: { userId: true, agentId: true } },
      project: { select: { uniqueIdentifier: true } },
    },
  });
  if (!task?.recurrence || !isRecurrenceRule(task.recurrence)) return null;
  const rule = task.recurrence;

  const sections = await prisma.section.findMany({
    where: { projectId: task.projectId, deleted: false, visibility: true },
    orderBy: { ranking: "asc" },
    select: { id: true, section_title: true, isDone: true },
  });
  const target = sections.find((s) => columnRoleFor(s) !== "done");
  if (!target) return null;

  const labelIds = task.taskLabels.map((tl) => tl.labelId);
  const liveLabelIds =
    labelIds.length > 0
      ? (
          await prisma.label.findMany({
            where: { id: { in: labelIds }, projectId: task.projectId },
            select: { id: true },
          })
        ).map((label) => label.id)
      : [];

  const claimed = await prisma.task.updateMany({
    where: { id: taskId, recurrence: rule },
    data: { recurrence: null },
  });
  if (claimed.count !== 1) return null;

  const nextDue = nextOccurrence(
    rule,
    task.dueDate ?? anchorDate ?? new Date(),
  );
  const anchorDue = task.dueDate ?? anchorDate ?? null;
  const nextStart = !task.startDate
    ? null
    : anchorDue
      ? new Date(
          nextDue.getTime() - (anchorDue.getTime() - task.startDate.getTime()),
        )
      : nextOccurrence(rule, task.startDate);

  let newTask;
  try {
    ({ task: newTask } = await createTaskCore({
      creationChannel: "api",
      title: task.title,
      description: task.description_?.content ?? "",
      userId: task.userId,
      projectId: task.projectId,
      sectionId: target.id,
      sectionTitle: target.section_title,
      projectIdentifier: task.project?.uniqueIdentifier ?? "TASK",
      priorityIndex: task.priority?.priority_index ?? 0,
      estimateIndex: task.estimate?.estimate_index ?? 0,
      dueDate: nextDue,
      startDate: nextStart ?? undefined,
      recurrence: rule,
      labelIds: liveLabelIds,
      createDrafts: false,
      updateTeamActivity: false,
    }));
  } catch (error) {
    await prisma.task
      .updateMany({
        where: { id: taskId, recurrence: null },
        data: { recurrence: rule },
      })
      .catch(() => undefined);
    throw error;
  }

  if (task.assignees.length > 0) {
    await prisma.assignees.createMany({
      data: task.assignees.map((a) => ({
        taskId: newTask.id,
        userId: a.userId,
        agentId: a.agentId,
      })),
      skipDuplicates: true,
    });
  }

  await scheduleDueDateJob(
    { taskId: newTask.id, projectId: task.projectId },
    nextDue,
  );
  void broadcastBoardChange(task.projectId);
  return newTask.id;
}

export async function sectionIsDone(sectionId: number | null): Promise<boolean> {
  if (!sectionId) return false;
  const section = await prisma.section.findUnique({
    where: { id: sectionId },
    select: { section_title: true, isDone: true },
  });
  return section ? columnRoleFor(section) === "done" : false;
}
