import { logger as htLogger } from "#logger";
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
        SELECT id FROM "Task" WHERE id = ${taskId}
        UNION
        SELECT child.id
        FROM "Task" child
        INNER JOIN task_tree parent ON child."parentTaskId" = parent.id
      )
      SELECT id FROM task_tree ORDER BY id
    `;
      const taskIds = [...new Set(tree.map(({ id }) => id))].sort(
        (a, b) => a - b,
      );
      if (taskIds.length === 0) return null;

      // Hard deletion takes the same per-task fence as agent writes and recovery.
      // A human choosing "delete permanently" explicitly cancels a live agent
      // lease; the background expiry path never does.
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
      // The root owns deletion intent for its tree. Modern soft deletion
      // cascades one deadline to every descendant, but legacy/partial trees can
      // contain Normal children or later child deadlines. Requiring every child
      // to be independently eligible strands the deleted root forever. Lock the
      // whole tree, require only the root's intent/deadline, and ensure no row
      // has a live competing claim before normalizing and claiming the cascade.
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
  // HTPR-3855: these 14 child rows all reference the task and nothing else,
  // so they can be deleted concurrently instead of in 14 sequential round
  // trips. Subtasks (recursive) and the task row itself keep their ordering:
  // the parent task row must be deleted last, after its subtasks stop
  // referencing it.
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
    // HTPR-6040: every model below has a taskId FK to Task with no onDelete
    // cascade in the schema and was never cleared here. A leftover row in
    // any of them fails deleteTASK's final deleteMany with a foreign key
    // violation, forever -- the claim releases and the sweep retries the
    // same task every minute with no way to ever succeed. This list must
    // match every non-cascading taskId relation in schema.prisma -- see
    // tests/task-delete-fk-coverage.test.cjs, which derives the required
    // set from the schema and fails if a future one is added here-less.
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
  htLogger.info("------------ deleting task ==");
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
    // debug.log("🚀 ~ task: deleted: ", task)

    return "success";
  } catch (error) {
    htLogger.info("🚀 ~ deleteReactions ~ error:", error);
    return "error";
  }
};

const deleteTaskSummary = async (taskId: number) => {
  htLogger.info("------------ deleting Task_Summary ==");
  try {
    const summary = await prisma.task_Summary.deleteMany({
      where: { taskId },
    });
    htLogger.info("🚀 ~ Task_Summary deleted: ", summary);

    return "success";
  } catch (error) {
    htLogger.info("🚀 ~ deleteTaskSummary ~ error:", error);
    return "error";
  }
};

const deleteTaskReadState = async (taskId: number) => {
  htLogger.info("------------ deleting TaskReadState ==");
  try {
    const readState = await prisma.taskReadState.deleteMany({
      where: { taskId },
    });
    htLogger.info("🚀 ~ TaskReadState deleted: ", readState);

    return "success";
  } catch (error) {
    htLogger.info("🚀 ~ deleteTaskReadState ~ error:", error);
    return "error";
  }
};

const deleteSavedContent = async (taskId: number) => {
  htLogger.info("------------ deleting SavedContent ==");
  try {
    const savedContent = await prisma.savedContent.deleteMany({
      where: { taskId },
    });
    htLogger.info("🚀 ~ SavedContent deleted: ", savedContent);

    return "success";
  } catch (error) {
    htLogger.info("🚀 ~ deleteSavedContent ~ error:", error);
    return "error";
  }
};

const deleteTaskMute = async (taskId: number) => {
  htLogger.info("------------ deleting TaskMute ==");
  try {
    const taskMute = await prisma.taskMute.deleteMany({
      where: { taskId },
    });
    htLogger.info("🚀 ~ TaskMute deleted: ", taskMute);

    return "success";
  } catch (error) {
    htLogger.info("🚀 ~ deleteTaskMute ~ error:", error);
    return "error";
  }
};

const deleteCustomFieldValues = async (taskId: number) => {
  htLogger.info("------------ deleting CustomFieldValue ==");
  try {
    const customFieldValues = await prisma.customFieldValue.deleteMany({
      where: { taskId },
    });
    htLogger.info("🚀 ~ CustomFieldValue deleted: ", customFieldValues);

    return "success";
  } catch (error) {
    htLogger.info("🚀 ~ deleteCustomFieldValues ~ error:", error);
    return "error";
  }
};

const deleteReadStatus = async (taskId: number) => {
  htLogger.info("------------ deleting ReadStatus ==");
  try {
    const readStatus = await prisma.readStatus.deleteMany({
      where: { taskId },
    });
    htLogger.info("🚀 ~ ReadStatus deleted: ", readStatus);

    return "success";
  } catch (error) {
    htLogger.info("🚀 ~ deleteReadStatus ~ error:", error);
    return "error";
  }
};

const deleteRelations = async (taskId: number) => {
  htLogger.info("------------ deleting taskRelations ==");
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
    htLogger.info("🚀 ~ taskRelations: deleted: ", taskRelations);

    return "success";
  } catch (error) {
    htLogger.info("🚀 ~ deleteRelations ~ error:", error);
    return "error";
  }
};

const deleteShareTask = async (taskId: number) => {
  htLogger.info("------------ deleting taskSharing ==");
  try {
    const taskSharing = await prisma.taskSharing.deleteMany({
      where: {
        taskId,
      },
    });
    htLogger.info("🚀 ~ taskSharing: deleted: ", taskSharing);

    return "success";
  } catch (error) {
    htLogger.info("🚀 ~ deleteShareTask ~ error:", error);
    return "error";
  }
};

const deleteDescription = async (taskId: number) => {
  htLogger.info("------------ deleting description ==");
  try {
    const description = await prisma.description.deleteMany({
      where: {
        taskId,
      },
    });
    htLogger.info("🚀 ~ reactions: deleted: ", description);

    return "success";
  } catch (error) {
    htLogger.info("🚀 ~ deleteReactions ~ error:", error);
    return "error";
  }
};

const deleteReactions = async (taskId: number) => {
  htLogger.info("------------ deleting reactions ==");
  try {
    const reactions = await prisma.reaction.deleteMany({
      where: { taskId },
    });
    htLogger.info("🚀 ~ reactions: deleted: ", reactions);

    return "success";
  } catch (error) {
    htLogger.info("🚀 ~ deleteReactions ~ error:", error);
    return "error";
  }
};

const deleteAttachments = async (taskId: number) => {
  htLogger.info("------------ deleting attachments ==");
  try {
    const attachments = await prisma.attachment.deleteMany({
      where: { taskId },
    });
    htLogger.info("🚀 ~ attachments deleted: ", attachments);

    return "success";
  } catch (error) {
    htLogger.info("🚀 ~ deleteReactions ~ error:", error);
    return "error";
  }
};

const deleteComments = async (taskId: number) => {
  htLogger.info("------------ deleting Comments ==");
  try {
    await deleteManyCommentsInTurbopuffer(taskId);
    const Comments = await prisma.comment.deleteMany({
      where: { taskId },
    });

    htLogger.info("🚀 ~ Comments deleted: ", Comments);

    return "success";
  } catch (error) {
    htLogger.info("🚀 ~ deleteReactions ~ error:", error);
    return "error";
  }
};

const taskLabels = async (taskId: number) => {
  htLogger.info("------------ deleting taskLabels ==");
  try {
    const taskLabels = await prisma.taskLabel.deleteMany({
      where: { taskId },
    });
    htLogger.info("🚀 ~ taskLabels deleted: ", taskLabels);

    return "success";
  } catch (error) {
    htLogger.info("🚀 ~ deleteReactions ~ error:", error);
    return "error";
  }
};

const deletePriority = async (taskId: number) => {
  htLogger.info("------------ deleting Priority ==");
  try {
    const Priority = await prisma.priority.deleteMany({
      where: { taskId },
    });
    htLogger.info("🚀 ~ Priority deleted: ", Priority);

    return "success";
  } catch (error) {
    htLogger.info("🚀 ~ deleteReactions ~ error:", error);
    return "error";
  }
};

const deleteEstimate = async (taskId: number) => {
  htLogger.info("------------ deleting Estimate ==");
  try {
    const Estimate = await prisma.estimate.deleteMany({
      where: { taskId },
    });
    htLogger.info("🚀 ~ Estimate deleted: ", Estimate);

    return "success";
  } catch (error) {
    htLogger.info("🚀 ~ deleteReactions ~ error:", error);
    return "error";
  }
};

const deleteReminders = async (taskId: number) => {
  htLogger.info("------------ deleting Reminders ==");
  try {
    const Reminders = await prisma.reminder.deleteMany({
      where: { taskId },
    });
    htLogger.info("🚀 ~ Reminders deleted: ", Reminders);

    return "success";
  } catch (error) {
    htLogger.info("🚀 ~ deleteReactions ~ error:", error);
    return "error";
  }
};

const deleteDrafts = async (taskId: number) => {
  htLogger.info("------------ deleting drafts ==");
  try {
    const drafts = await prisma.drafts.deleteMany({
      where: { taskId },
    });
    htLogger.info("🚀 ~ drafts deleted: ", drafts);

    return "success";
  } catch (error) {
    htLogger.info("🚀 ~ deleteReactions ~ error:", error);
    return "error";
  }
};

const deleteAssignees = async (taskId: number) => {
  htLogger.info("------------ deleting Assignees ==");
  try {
    const Assignees = await prisma.assignees.deleteMany({
      where: { taskId },
    });
    htLogger.info("🚀 ~ Assignees deleted: ", Assignees);

    return "success";
  } catch (error) {
    htLogger.info("🚀 ~ deleteReactions ~ error:", error);
    return "error";
  }
};

const deleteFollowers = async (taskId: number) => {
  htLogger.info("------------ deleting Followers ==");
  try {
    const Followers = await prisma.follower.deleteMany({
      where: { taskId },
    });
    htLogger.info("🚀 ~ Followers deleted: ", Followers);

    return "success";
  } catch (error) {
    htLogger.info("🚀 ~ deleteReactions ~ error:", error);
    return "error";
  }
};

const deleteNotifications = async (taskId: number) => {
  htLogger.info("------------ deleting Notifications ==");
  try {
    // Collect the owners first: deleteMany does not return rows, and the open
    // inboxes need telling or the deleted task's row sits there until a reload
    // (HTPR-4724).
    const owners = await prisma.notification.findMany({
      where: { taskId },
      select: { userId: true },
      distinct: ["userId"],
    });
    const Notifications = await prisma.notification.deleteMany({
      where: { taskId },
    });
    htLogger.info("🚀 ~ Notifications deleted: ", Notifications);
    void broadcastInboxForTask(
      taskId,
      owners.map((owner) => owner.userId),
    );

    return "success";
  } catch (error) {
    htLogger.info("🚀 ~ deleteReactions ~ error:", error);
    return "error";
  }
};

const deleteSubTasks = async (taskId: number, claim: HardDeleteClaim) => {
  htLogger.info("------------ deleting Subtasks ==");
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
    htLogger.info("🚀 ~ deleteSubTasks ~ task:", task);
    if (task?.subTasks && task.subTasks.length > 0) {
      for (const subTask of task.subTasks) {
        if (!claim.taskIds.includes(subTask.id)) return "error";
        if ((await invokeTaskDelete(subTask.id, claim)) === "error")
          return "error";
      }
    }
    return "success";
  } catch (error) {
    htLogger.info("🚀 ~ deleteSubtasks ~ error:", error);
    return "error";
  }
};
