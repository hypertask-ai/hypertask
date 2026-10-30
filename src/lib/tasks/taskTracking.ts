import prisma from "@/lib/prisma";
import type { AgentTokenTeamScope } from "@/lib/mcp/auth/types";
import { createFollowerService } from "@/utils/controllers/followers/createFollowerService";
import { withTaskStarWriteLock } from "@/lib/taskCardActions/writeLocks";
import { taskAccessWhere } from "@/utils/controllers/tasks/assertTaskAccess";
import { nextReminderRevision } from "@/utils/controllers/reminders/revision";
import { syncMyTasksSnoozeFromReminder } from "@/utils/controllers/tasks/myTasksSnooze";
import { isFeatureEnabled, MY_TASKS_SNOOZE_FLAG } from "@/lib/flags";
import { broadcastInboxChange } from "@/lib/realtime/server";
import {
  cancelInboxReminderJob,
  cancelInboxReminderRevisionJob,
  cancelLegacyInboxReminderJobIfSafe,
  scheduleInboxReminderJob,
} from "@/pages/api/queues/inboxQueue";

const REMINDER_LOCK_CLASS = 1_446_420_610;

export type TaskTrackingAction = "follow" | "unfollow" | "star" | "unstar" | "remind" | "read";

type TrackingContext = {
  currentUser: { id: number };
  agentId?: string | null;
  teamScope?: AgentTokenTeamScope | null;
};

export type TaskTrackingState = {
  following: boolean;
  starred: boolean;
  remindAt: string | null;
  reminderId: number | null;
};

export async function readTaskTracking({
  taskId,
  currentUser,
  agentId,
}: { taskId: number } & TrackingContext): Promise<TaskTrackingState> {
  const [follower, starred, reminder] = await Promise.all([
    prisma.follower.findFirst({
      where: { taskId, userId: currentUser.id, agentId: agentId ?? null },
      select: { id: true },
    }),
    prisma.savedContent.findFirst({
      where: { taskId, userId: currentUser.id, type: "Private", commentId: null },
      select: { id: true },
    }),
    prisma.reminder.findFirst({
      where: { taskId, userId: currentUser.id, status: "Normal" },
      orderBy: { id: "desc" },
      select: { id: true, remindAt: true },
    }),
  ]);
  return {
    following: Boolean(follower),
    starred: Boolean(starred),
    remindAt: reminder?.remindAt?.toISOString() ?? null,
    reminderId: reminder?.id ?? null,
  };
}

async function findTask(taskId: number, { currentUser, agentId, teamScope }: TrackingContext) {
  return prisma.task.findFirst({
    where: taskAccessWhere(currentUser.id, taskId, { agentId, teamScope }),
    select: { id: true, projectId: true },
  });
}

export async function setTaskTracking({
  action,
  taskId,
  remindAt,
  ...context
}: {
  action: TaskTrackingAction;
  taskId: number;
  remindAt?: string | null;
} & TrackingContext): Promise<{ status: number; body: Record<string, unknown> }> {
  const task = await findTask(taskId, context);
  if (!task) return { status: 404, body: { message: "Task not found" } };

  if (action === "follow") {
    const result = await createFollowerService({
      userId: context.currentUser.id,
      taskId,
      mentionById: context.currentUser.id,
      agentId: context.agentId ?? null,
    });
    if (result.status !== 200 && result.status !== 201) {
      return { status: result.status, body: { message: result.body?.message ?? "Task not found" } };
    }
  }

  if (action === "unfollow") {
    await prisma.follower.deleteMany({
      where: { taskId, userId: context.currentUser.id, agentId: context.agentId ?? null },
    });
  }

  if (action === "star" || action === "unstar") {
    const where = {
      taskId,
      userId: context.currentUser.id,
      type: "Private" as const,
      commentId: null,
    };
    await withTaskStarWriteLock(taskId, async (tx) => {
      const existing = await tx.savedContent.findFirst({ where, select: { id: true } });
      if (action === "star" && !existing) {
        await tx.savedContent.create({
          data: { ...where, projectId: task.projectId },
        });
      }
      if (action === "unstar" && existing) {
        await tx.savedContent.deleteMany({ where });
      }
    });
  }

  if (action === "remind") {
    const remindAtDate = remindAt ? new Date(remindAt) : null;
    if (!remindAtDate || Number.isNaN(remindAtDate.getTime())) {
      return { status: 400, body: { message: "remindAt must be a valid date" } };
    }
    const userId = context.currentUser.id;
    const hideOnMyTasks = await isFeatureEnabled(MY_TASKS_SNOOZE_FLAG, userId);
    const saved = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${REMINDER_LOCK_CLASS}::int, ${taskId}::int)`;
      const existing = await tx.reminder.findMany({
        where: { userId, taskId },
        orderBy: { id: "asc" },
      });
      const writeRevision = nextReminderRevision(existing);
      const active = existing.filter((item) => item.status === "Normal");
      if (active.length > 1) {
        await tx.reminder.updateMany({
          where: { id: { in: active.slice(1).map((item) => item.id) } },
          data: { status: "Archive", updatedAt: writeRevision },
        });
      }
      const previous = active[0] ?? null;
      const reminder = previous
        ? await tx.reminder.update({
            where: { id: previous.id },
            data: {
              projectId: task.projectId,
              remindAt: remindAtDate,
              updatedAt: writeRevision,
              invokeCondition: "DurationComplete",
            },
          })
        : await tx.reminder.create({
            data: {
              userId,
              taskId,
              projectId: task.projectId,
              remindAt: remindAtDate,
              updatedAt: writeRevision,
              invokeCondition: "DurationComplete",
            },
          });
      await tx.notification.updateMany({
        where: { userId, taskId, status: "Normal" },
        data: { status: "Archive", archivedAt: new Date() },
      });
      if (hideOnMyTasks) {
        await syncMyTasksSnoozeFromReminder({
          userId,
          taskId,
          snoozeUntil: remindAtDate,
          client: tx,
        });
      }
      return { reminder, previous };
    });
    await cancelInboxReminderJob(saved.reminder.userId, saved.reminder.taskId);
    await cancelInboxReminderRevisionJob(saved.previous);
    await cancelLegacyInboxReminderJobIfSafe(saved.reminder.userId, saved.reminder.taskId);
    await scheduleInboxReminderJob(saved.reminder, remindAtDate);
    void broadcastInboxChange(userId, { originUserId: userId });
  }

  const state = await readTaskTracking({ taskId, ...context });
  return { status: 200, body: { taskId, action, ...state } };
}
