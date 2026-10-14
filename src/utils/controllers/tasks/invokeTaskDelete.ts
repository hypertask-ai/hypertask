import prisma from "@/lib/prisma";
import {
  assertAgentAssignmentChangeAllowed,
  cancelAgentMutationLeaseForHumanOverride,
} from "@/lib/mcp/tasks/agentMutationFence";
import { Prisma } from "@prisma/client";
import { broadcastInboxForTask } from "@/utils/controllers/notifications/broadcastInboxForTask";
import {
  deleteManyCommentsInTurbopuffer,
  deleteTaskInTurbopuffer,
} from "../turbopuffer/turbopufferHelper";

export const HARD_DELETE_PROCESSING_TIMEOUT_MINUTES = 30;

type TaskTreeRow = {
  id: number;
};

type LockedTaskDeleteRow = {
  id: number;
  status: string;
  permanentlyDeleteAt: Date | null;
  hardDeleteProcessingAt: Date | null;
};

type HardDeleteClaim = {
  taskIds: number[];
  claimedAt: Date;
};

async function claimTaskTreeForHardDelete(
  taskId: number,
  options: { actingUserId?: number; requireDue: boolean },
): Promise<HardDeleteClaim | null> {
  return prisma.$transaction(
    async (tx) => {
      const tree = await tx.$queryRaw<TaskTreeRow[]>`
      WITH RECURSIVE task_tree AS (
        SELECT id, "projectId" FROM "Task" WHERE id = ${taskId}
        UNION
        SELECT child.id, child."projectId"
        FROM "Task" child
        INNER JOIN task_tree parent
          ON child."parentTaskId" = parent.id
          AND child."projectId" = parent."projectId"
      )
      SELECT id FROM task_tree ORDER BY id
    `;
      const taskIds = [...new Set(tree.map(({ id }) => id))].sort(
        (a, b) => a - b,
      );
      if (taskIds.length === 0) return null;

      for (const id of taskIds) {
        await assertAgentAssignmentChangeAllowed(
          tx,
          id,
          null,
          options.actingUserId ?? null,
          { allowHumanOverride: options.actingUserId != null },
        );
      }

      const rows = await tx.$queryRaw<LockedTaskDeleteRow[]>`
      SELECT id, status, "permanentlyDeleteAt", "hardDeleteProcessingAt"
      FROM "Task"
      WHERE id IN (${Prisma.join(taskIds)})
      ORDER BY id
      FOR UPDATE
    `;
      if (rows.length !== taskIds.length) return null;

      const now = new Date();
      const staleBefore = new Date(
        now.getTime() - HARD_DELETE_PROCESSING_TIMEOUT_MINUTES * 60_000,
      );
      const root = rows.find((row) => row.id === taskId);
      const rootEligible =
        root?.status === "Deleted" &&
        (!options.requireDue ||
          (root.permanentlyDeleteAt != null && root.permanentlyDeleteAt <= now));
      const treeAvailable = rows.every(
        (row) =>
          row.hardDeleteProcessingAt == null ||
          row.hardDeleteProcessingAt <= staleBefore,
      );
      const eligible = rootEligible && treeAvailable;
      if (!eligible) return null;

      if (options.actingUserId != null) {
        for (const id of taskIds) {
          await cancelAgentMutationLeaseForHumanOverride(
            tx,
            id,
            options.actingUserId,
          );
        }
      }
      await tx.task.updateMany({
        where: { parentTaskId: { in: taskIds }, id: { notIn: taskIds } },
        data: { parentTaskId: null },
      });
      const claimedAt = now;
      const claimed = await tx.task.updateMany({
        where: {
          id: { in: taskIds },
          OR: [
            { hardDeleteProcessingAt: null },
            { hardDeleteProcessingAt: { lte: staleBefore } },
          ],
        },
        data: { status: "Deleted", hardDeleteProcessingAt: claimedAt },
      });
      if (claimed.count !== taskIds.length) {
        throw new Error("Task tree changed while acquiring its hard-delete claim");
      }
      return { taskIds, claimedAt };
    },
    { timeout: 30_000 },
  );
}

export const claimAndInvokeTaskDelete = async (taskId: number) => {
  const claim = await claimTaskTreeForHardDelete(taskId, { requireDue: true });

  if (!claim) return "skipped";
  return invokeClaimedTaskDelete(taskId, claim);
};

export const permanentlyDeleteTask = async (
  taskId: number,
  actingUserId: number,
) => {
  const claim = await claimTaskTreeForHardDelete(taskId, {
    actingUserId,
    requireDue: false,
  });

  if (!claim) return "skipped";
  return invokeClaimedTaskDelete(taskId, claim);
};

async function invokeClaimedTaskDelete(taskId: number, claim: HardDeleteClaim) {
  try {
    const result = await invokeTaskDelete(taskId, claim);
    if (result === "error") {
      await releaseHardDeleteClaim(claim);
    }
    return result;
  } catch (error) {
    await releaseHardDeleteClaim(claim);
    throw error;
  }
}

async function releaseHardDeleteClaim(claim: HardDeleteClaim) {
  await prisma.task.updateMany({
    where: {
      id: { in: claim.taskIds },
      status: "Deleted",
      hardDeleteProcessingAt: claim.claimedAt,
    },
    data: { hardDeleteProcessingAt: null },
  });
}

const invokeTaskDelete = async (taskId: number, claim: HardDeleteClaim) => {
  const independentDeletes = [
    deleteReactions,
    deleteAttachments,
    deleteComments,
    taskLabels,
    deletePriority,
    deleteEstimate,
    deleteReminders,
    deleteDrafts,
    deleteAssignees,
    deleteFollowers,
    deleteNotifications,
    deleteDescription,
    deleteShareTask,
    deleteRelations,
    deleteTaskSummary,
    deleteTaskReadState,
    deleteSavedContent,
    deleteTaskMute,
    deleteCustomFieldValues,
    deleteReadStatus,
  ];

  const results = await Promise.all(independentDeletes.map((fn) => fn(taskId)));
  if (results.includes("error")) return "error";

  if ((await deleteSubTasks(taskId, claim)) === "error") return "error";
  if ((await deleteTASK(taskId, claim)) === "error") return "error";

  return "success";
};

const deleteTASK = async (taskId: number, claim: HardDeleteClaim) => {
  console.log("------------ deleting task ==");
  try {
    const task = await prisma.task.deleteMany({
      where: {
        id: taskId,
        status: "Deleted",
        hardDeleteProcessingAt: claim.claimedAt,
      },
    });

    if (task.count !== 1) return "error";

    deleteTaskInTurbopuffer(taskId);

    return "success";
  } catch (error) {
    console.log("🚀 ~ deleteReactions ~ error:", error);
    return "error";
  }
};

const deleteTaskSummary = async (taskId: number) => {
  console.log("------------ deleting Task_Summary ==");
  try {
    const summary = await prisma.task_Summary.deleteMany({
      where: { taskId },
    });
    console.log("🚀 ~ Task_Summary deleted: ", summary);

    return "success";
  } catch (error) {
    console.log("🚀 ~ deleteTaskSummary ~ error:", error);
    return "error";
  }
};

const deleteTaskReadState = async (taskId: number) => {
  console.log("------------ deleting TaskReadState ==");
  try {
    const readState = await prisma.taskReadState.deleteMany({
      where: { taskId },
    });
    console.log("🚀 ~ TaskReadState deleted: ", readState);

    return "success";
  } catch (error) {
    console.log("🚀 ~ deleteTaskReadState ~ error:", error);
    return "error";
  }
};

const deleteSavedContent = async (taskId: number) => {
  console.log("------------ deleting SavedContent ==");
  try {
    const savedContent = await prisma.savedContent.deleteMany({
      where: { taskId },
    });
    console.log("🚀 ~ SavedContent deleted: ", savedContent);

    return "success";
  } catch (error) {
    console.log("🚀 ~ deleteSavedContent ~ error:", error);
    return "error";
  }
};

const deleteTaskMute = async (taskId: number) => {
  console.log("------------ deleting TaskMute ==");
  try {
    const taskMute = await prisma.taskMute.deleteMany({
      where: { taskId },
    });
    console.log("🚀 ~ TaskMute deleted: ", taskMute);

    return "success";
  } catch (error) {
    console.log("🚀 ~ deleteTaskMute ~ error:", error);
    return "error";
  }
};

const deleteCustomFieldValues = async (taskId: number) => {
  console.log("------------ deleting CustomFieldValue ==");
  try {
    const customFieldValues = await prisma.customFieldValue.deleteMany({
      where: { taskId },
    });
    console.log("🚀 ~ CustomFieldValue deleted: ", customFieldValues);

    return "success";
  } catch (error) {
    console.log("🚀 ~ deleteCustomFieldValues ~ error:", error);
    return "error";
  }
};

const deleteReadStatus = async (taskId: number) => {
  console.log("------------ deleting ReadStatus ==");
  try {
    const readStatus = await prisma.readStatus.deleteMany({
      where: { taskId },
    });
    console.log("🚀 ~ ReadStatus deleted: ", readStatus);

    return "success";
  } catch (error) {
    console.log("🚀 ~ deleteReadStatus ~ error:", error);
    return "error";
  }
};

const deleteRelations = async (taskId: number) => {
  console.log("------------ deleting taskRelations ==");
  try {
    const taskRelations = await prisma.taskRelations.deleteMany({
      where: {
        OR: [
          {
            sourceTaskId: taskId,
          },
          {
            targetTaskId: taskId,
          },
        ],
      },
    });
    console.log("🚀 ~ taskRelations: deleted: ", taskRelations);

    return "success";
  } catch (error) {
    console.log("🚀 ~ deleteRelations ~ error:", error);
    return "error";
  }
};

const deleteShareTask = async (taskId: number) => {
  console.log("------------ deleting taskSharing ==");
  try {
    const taskSharing = await prisma.taskSharing.deleteMany({
      where: {
        taskId,
      },
    });
    console.log("🚀 ~ taskSharing: deleted: ", taskSharing);

    return "success";
  } catch (error) {
    console.log("🚀 ~ deleteShareTask ~ error:", error);
    return "error";
  }
};

const deleteDescription = async (taskId: number) => {
  console.log("------------ deleting description ==");
  try {
    const description = await prisma.description.deleteMany({
      where: {
        taskId,
      },
    });
    console.log("🚀 ~ reactions: deleted: ", description);

    return "success";
  } catch (error) {
    console.log("🚀 ~ deleteReactions ~ error:", error);
    return "error";
  }
};

const deleteReactions = async (taskId: number) => {
  console.log("------------ deleting reactions ==");
  try {
    const reactions = await prisma.reaction.deleteMany({
      where: { taskId },
    });
    console.log("🚀 ~ reactions: deleted: ", reactions);

    return "success";
  } catch (error) {
    console.log("🚀 ~ deleteReactions ~ error:", error);
    return "error";
  }
};

const deleteAttachments = async (taskId: number) => {
  console.log("------------ deleting attachments ==");
  try {
    const attachments = await prisma.attachment.deleteMany({
      where: { taskId },
    });
    console.log("🚀 ~ attachments deleted: ", attachments);

    return "success";
  } catch (error) {
    console.log("🚀 ~ deleteReactions ~ error:", error);
    return "error";
  }
};

const deleteComments = async (taskId: number) => {
  console.log("------------ deleting Comments ==");
  try {
    await deleteManyCommentsInTurbopuffer(taskId);
    const Comments = await prisma.comment.deleteMany({
      where: { taskId },
    });

    console.log("🚀 ~ Comments deleted: ", Comments);

    return "success";
  } catch (error) {
    console.log("🚀 ~ deleteReactions ~ error:", error);
    return "error";
  }
};

const taskLabels = async (taskId: number) => {
  console.log("------------ deleting taskLabels ==");
  try {
    const taskLabels = await prisma.taskLabel.deleteMany({
      where: { taskId },
    });
    console.log("🚀 ~ taskLabels deleted: ", taskLabels);

    return "success";
  } catch (error) {
    console.log("🚀 ~ deleteReactions ~ error:", error);
    return "error";
  }
};

const deletePriority = async (taskId: number) => {
  console.log("------------ deleting Priority ==");
  try {
    const Priority = await prisma.priority.deleteMany({
      where: { taskId },
    });
    console.log("🚀 ~ Priority deleted: ", Priority);

    return "success";
  } catch (error) {
    console.log("🚀 ~ deleteReactions ~ error:", error);
    return "error";
  }
};

const deleteEstimate = async (taskId: number) => {
  console.log("------------ deleting Estimate ==");
  try {
    const Estimate = await prisma.estimate.deleteMany({
      where: { taskId },
    });
    console.log("🚀 ~ Estimate deleted: ", Estimate);

    return "success";
  } catch (error) {
    console.log("🚀 ~ deleteReactions ~ error:", error);
    return "error";
  }
};

const deleteReminders = async (taskId: number) => {
  console.log("------------ deleting Reminders ==");
  try {
    const Reminders = await prisma.reminder.deleteMany({
      where: { taskId },
    });
    console.log("🚀 ~ Reminders deleted: ", Reminders);

    return "success";
  } catch (error) {
    console.log("🚀 ~ deleteReactions ~ error:", error);
    return "error";
  }
};

const deleteDrafts = async (taskId: number) => {
  console.log("------------ deleting drafts ==");
  try {
    const drafts = await prisma.drafts.deleteMany({
      where: { taskId },
    });
    console.log("🚀 ~ drafts deleted: ", drafts);

    return "success";
  } catch (error) {
    console.log("🚀 ~ deleteReactions ~ error:", error);
    return "error";
  }
};

const deleteAssignees = async (taskId: number) => {
  console.log("------------ deleting Assignees ==");
  try {
    const Assignees = await prisma.assignees.deleteMany({
      where: { taskId },
    });
    console.log("🚀 ~ Assignees deleted: ", Assignees);

    return "success";
  } catch (error) {
    console.log("🚀 ~ deleteReactions ~ error:", error);
    return "error";
  }
};

const deleteFollowers = async (taskId: number) => {
  console.log("------------ deleting Followers ==");
  try {
    const Followers = await prisma.follower.deleteMany({
      where: { taskId },
    });
    console.log("🚀 ~ Followers deleted: ", Followers);

    return "success";
  } catch (error) {
    console.log("🚀 ~ deleteReactions ~ error:", error);
    return "error";
  }
};

const deleteNotifications = async (taskId: number) => {
  console.log("------------ deleting Notifications ==");
  try {
    const owners = await prisma.notification.findMany({
      where: { taskId },
      select: { userId: true },
      distinct: ["userId"],
    });
    const Notifications = await prisma.notification.deleteMany({
      where: { taskId },
    });
    console.log("🚀 ~ Notifications deleted: ", Notifications);
    void broadcastInboxForTask(
      taskId,
      owners.map((owner) => owner.userId),
    );

    return "success";
  } catch (error) {
    console.log("🚀 ~ deleteReactions ~ error:", error);
    return "error";
  }
};

const deleteSubTasks = async (taskId: number, claim: HardDeleteClaim) => {
  console.log("------------ deleting Subtasks ==");
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        subTasks: {
          orderBy: {
            status: "desc",
          },
        },
      },
    });
    console.log("🚀 ~ deleteSubTasks ~ task:", task);
    if (task?.subTasks && task.subTasks.length > 0) {
      for (const subTask of task.subTasks) {
        if (!claim.taskIds.includes(subTask.id)) return "error";
        if ((await invokeTaskDelete(subTask.id, claim)) === "error")
          return "error";
      }
    }
    return "success";
  } catch (error) {
    console.log("🚀 ~ deleteSubtasks ~ error:", error);
    return "error";
  }
};
