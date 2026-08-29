import prisma from "@/lib/prisma";
import { createTaskCore } from "./createTaskCore";
import { isRecurrenceRule, nextOccurrence } from "@/lib/recurrence";
import { columnRoleFor } from "@/lib/mcp/boards/columnRole";
import { broadcastBoardChange } from "@/lib/realtime/server";
import { scheduleDueDateJob } from "@/pages/api/queues/duedateQueue";

// HTPR-4885: a recurring task that gets completed (moved to a done column or
// archived) spawns its next occurrence. The rule moves to the new copy, so the
// completed one stays a plain historical task. The updateMany claim below is
// the double-fire guard: only the caller that actually nulls the rule spawns.
export async function spawnNextRecurrence(
  taskId: number,
  // Archiving clears dueDate before we read the row, so callers pass the
  // pre-update value to keep the series anchored to its original schedule.
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

  // Resolve everything that can fail before claiming: clearing the rule and
  // then bailing would silently stop the task ever repeating again.
  const sections = await prisma.section.findMany({
    where: { projectId: task.projectId, deleted: false, visibility: true },
    orderBy: { ranking: "asc" },
    select: { id: true, section_title: true, isDone: true },
  });
  // Only a non-done column will do. Dropping the new occurrence into Done
  // would hide it as finished work the moment it is created, so a board with
  // nothing but done columns simply does not repeat.
  const target = sections.find((s) => columnRoleFor(s) !== "done");
  if (!target) return null;

  // Labels can be deleted between setting the rule and completing the task;
  // a stale id would fail the create and cost us the series.
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

  // Claiming the rule is the double-fire guard: whichever caller wins this
  // update is the one that spawns, so a done-column move and an archive
  // arriving together cannot both produce a copy.
  const claimed = await prisma.task.updateMany({
    where: { id: taskId, recurrence: rule },
    data: { recurrence: null },
  });
  if (claimed.count !== 1) return null;

  const nextDue = nextOccurrence(
    rule,
    task.dueDate ?? anchorDate ?? new Date(),
  );
  // A planned start rolls forward with the series; dropping it would file the
  // copy under its deadline in My Tasks instead of the day work begins. Keep
  // the gap to the deadline rather than advancing each date on its own — a
  // late completion fast-forwards them by different amounts otherwise.
  const anchorDue = task.dueDate ?? anchorDate ?? null;
  const nextStart = !task.startDate
    ? null
    : anchorDue
      ? new Date(
          nextDue.getTime() - (anchorDue.getTime() - task.startDate.getTime()),
        )
      : nextOccurrence(rule, task.startDate);

  // The claim already destroyed the rule, so from here any failure has to put
  // it back — otherwise a transient error (uniqueIndex collision, dropped
  // connection, deleted label) would silently end the series with nothing
  // created and nothing shown to the user.
  let newTask;
  try {
    ({ task: newTask } = await createTaskCore({
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

// True when the task's new section counts as done for its board.
export async function sectionIsDone(sectionId: number | null): Promise<boolean> {
  if (!sectionId) return false;
  const section = await prisma.section.findUnique({
    where: { id: sectionId },
    select: { section_title: true, isDone: true },
  });
  return section ? columnRoleFor(section) === "done" : false;
}
