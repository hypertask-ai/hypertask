
import { z } from "zod";
import { type ToolTaskIdentifierInput } from "@/app/api/ai/chat/stream/bulkTools";
import prisma from "@/lib/prisma";
import { toStoredHtml } from "@/utils/helperFunctions/toStoredHtml";
import generateRank from "@/utils/generateRank";
import { updateTaskSingle } from "@/utils/controllers/tasks/single";
import sendNotificationForTask from "@/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove";
import createArchiveActivity from "@/utils/controllers/activities/createArchiveActivity";
import { cancelDueDateJob, scheduleDueDateJob } from "@/pages/api/queues/duedateQueue";
import createTaskDueDateActivity from "@/utils/controllers/activities/createTaskDueDateActivity";
import { setTaskLabels, mutateTaskLabels } from "@/lib/mcp/tasks/services";
import { taskDetailInclude } from "@/lib/mcp/tasks/mappers";
import { broadcastBoardChange, broadcastTaskChange } from "@/lib/realtime/server";
import { buildMcpTaskUrl } from "@/lib/mcp/boards/links";

import { ResolveTaskForToolResult, resolveTaskForTool } from "@/lib/ai/tools/execution";
import { buildActivityUser, applyPriorityUpdate, applyEstimateUpdate, sanitizeForJson, mapTaskToDetail } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";
import { updateTaskSchema } from "./updateTaskSchema";

export function createTaskUpdater(context: ToolContext, input: z.infer<typeof updateTaskSchema>) {
  const { user, actingAgentId } = context;
  return async (
    identifier: ToolTaskIdentifierInput,
    taskResult?: ResolveTaskForToolResult
  ) => {
    taskResult ??= await resolveTaskForTool(user, identifier);
    if (taskResult.error) {
      return { success: false, error: taskResult.error };
    }

    const hasNonSectionUpdate =
      input.title !== undefined ||
      input.description !== undefined ||
      input.priority !== undefined ||
      input.estimate !== undefined ||
      input.due_date !== undefined ||
      input.status !== undefined ||
      input.parent_task_id !== undefined ||
      input.labels !== undefined ||
      input.add_labels !== undefined ||
      input.remove_labels !== undefined;
    const hasUpdate = hasNonSectionUpdate || input.section !== undefined;
    if (!hasUpdate) {
      return { success: false, error: "Provide at least one field to update" };
    }

    const task = taskResult.task;
    if (!task) {
      return { success: false, error: "Task not found or access denied" };
    }

    let sectionTarget: { id: number; section_title: string } | null = null;
    let sectionWarning: string | undefined;
    if (input.section !== undefined) {
      const sectionWhere =
        typeof input.section === "number"
          ? { id: input.section, projectId: task.projectId, deleted: false }
          : {
            projectId: task.projectId,
            section_title: input.section,
            deleted: false,
          };
      sectionTarget = await prisma.section.findFirst({
        where: sectionWhere,
        select: { id: true, section_title: true },
      });
      if (!sectionTarget) {
        if (hasNonSectionUpdate) {
          sectionWarning = `Section "${input.section}" not found on this board -- section unchanged; other fields updated.`;
        } else {
          return {
            success: false,
            error: `Section "${input.section}" not found in this task's board. Cross-board moves aren't supported here.`,
          };
        }
      }
    }

    const userObj = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, email: true, displayName: true, photoURL: true },
    });
    if (!userObj) return { success: false, error: "User not found" };
    const activityUser = buildActivityUser(userObj);

    const oldTask = await prisma.task.findUnique({
      where: { id: task.id },
      select: { section: true, sectionId: true, status: true, dueDate: true },
    });
    if (!oldTask) return { success: false, error: "Task not found" };

    const patch: Record<string, unknown> = { id: task.id };
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined)
      patch.description = toStoredHtml(input.description);
    if (input.parent_task_id !== undefined) patch.parentTaskId = input.parent_task_id;
    const dueDateValue =
      input.due_date === undefined
        ? undefined
        : input.due_date === null
          ? null
          : new Date(input.due_date);
    if (dueDateValue instanceof Date && isNaN(dueDateValue.getTime())) {
      return { success: false, error: `Invalid due_date: "${input.due_date}". Use an ISO-8601 date.` };
    }
    if (dueDateValue !== undefined) patch.dueDate = dueDateValue;
    if (input.status !== undefined) {
      patch.status = input.status;
      patch.archivedAt = input.status === "Archive" ? new Date() : null;
    }
    if (sectionTarget) {
      const lastTask = await prisma.task.findFirst({
        where: {
          sectionId: sectionTarget.id,
          projectId: task.projectId,
          status: "Normal",
        },
        orderBy: { ranking: "desc" },
        select: { ranking: true },
      });
      patch.sectionId = sectionTarget.id;
      patch.section = sectionTarget.section_title;
      patch.ranking = generateRank(lastTask?.ranking, undefined);
    }

    if (Object.keys(patch).length > 1) {
      const result = await updateTaskSingle(
        patch,
        activityUser,
        actingAgentId,
        sectionTarget
          ? {
            taskMovedActivity: {
              sendNotification: () =>
                sendNotificationForTask(
                  user.id,
                  "TaskMoved",
                  task.id,
                  task.projectId,
                  actingAgentId ?? undefined,
                ),
            },
          }
          : {},
      );
      if (result.status !== 200) {
        return {
          success: false,
          error:
            (result.json as { message?: string })?.message ||
            "Failed to update task",
        };
      }
    }

    if (input.status !== undefined && oldTask.status !== input.status) {
      await createArchiveActivity({
        taskId: task.id,
        fromUserId: user.id,
        fromUserDisplayName: userObj.displayName ?? "",
        fromUser: activityUser,
        newStatus: input.status,
      });
      if (input.status === "Archive") {
        await cancelDueDateJob(task.id, task.projectId);
      }
      await sendNotificationForTask(
        user.id,
        "TaskArchived",
        task.id,
        task.projectId,
        undefined
      );
    }

    if (dueDateValue !== undefined) {
      const dueDateChanged =
        (oldTask.dueDate?.getTime() ?? null) !== (dueDateValue?.getTime() ?? null);
      if (dueDateChanged) {
        await createTaskDueDateActivity({
          userObj: activityUser,
          taskId: task.id,
          toDueDate: dueDateValue ?? undefined,
          fromDueDate: oldTask.dueDate ?? undefined,
        });
        await cancelDueDateJob(task.id, task.projectId);
        if (dueDateValue) {
          await scheduleDueDateJob(
            { taskId: task.id, projectId: task.projectId },
            dueDateValue
          );
        }
        await sendNotificationForTask(
          user.id,
          "TaskDueDate",
          task.id,
          task.projectId,
          undefined
        );
      }
    }

    if (input.priority !== undefined) {
      const priorityResult = await applyPriorityUpdate(
        task.id,
        input.priority,
        user.id,
        activityUser
      );
      if (priorityResult.error) {
        return { success: false, error: priorityResult.error };
      }
    }

    if (input.estimate !== undefined) {
      const estimateResult = await applyEstimateUpdate(
        task.id,
        input.estimate,
        user.id,
        activityUser
      );
      if (estimateResult.error) {
        return { success: false, error: estimateResult.error };
      }
    }

    const labelActor = {
      id: userObj.id,
      email: userObj.email ?? "",
      displayName: userObj.displayName,
      photoURL: userObj.photoURL,
    };
    if (input.labels !== undefined) {
      await setTaskLabels(task.id, task.projectId, input.labels, labelActor);
    }
    if (input.add_labels !== undefined || input.remove_labels !== undefined) {
      await mutateTaskLabels(
        task.id,
        task.projectId,
        { add: input.add_labels, remove: input.remove_labels },
        labelActor
      );
    }

    const finalTask = await prisma.task.findUnique({
      where: { id: task.id },
      include: taskDetailInclude(user.id),
    });
    if (!finalTask) {
      return { success: false, error: "Task updated but could not be retrieved" };
    }

    void broadcastBoardChange(finalTask.projectId, { originUserId: user.id });
    void broadcastTaskChange(finalTask.id, { originUserId: user.id });

    return sanitizeForJson({
      success: true,
      task: mapTaskToDetail(finalTask, user.id),
      url: buildMcpTaskUrl(finalTask.projectId, finalTask.uniqueIndex),
      ...(sectionWarning ? { warning: sectionWarning } : {}),
    });
  };
}
