import { NotificationType, Prisma } from "@prisma/client";
import idsToSendNotificationsTo from "../IdsToSendNotificationsTo";
import prisma from "@/lib/prisma";
import { IFCMReqBody } from "@/models/model";
import { sendDataNewCommentFCM } from "../../FCM";
import checkReminderAndCreateNotification from "./check-reminder_create-notification";
import { sendEmailNotification } from "../sendNotification";
import { shouldNotify } from "../shouldNotify";
import { format, isValid } from "date-fns";
interface ICreateNotification {
  taskId: number;
  projectId: number;
  fromUserId: number;
  userId: number;
  type: NotificationType;
  fromAgentId?: string | null;
}

interface ITaskMoveEmailBody {
  senderName: string;
  newSectionTitle: string;
  taskLink: string;
  emailTo: string;
  taskTitle: string;
}

const sendNotificationForTask = async (
  senderId: number,
  type: NotificationType,
  taskId: number,
  projectId: number,
  fromAgentId?: string | null,
) => {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return false;

  // Get list of userIds to notify
  const userIds = await idsToSendNotificationsTo(
    taskId,
    senderId,
    task.userId,
    projectId,
    fromAgentId
  );

  let result = true;
  switch (type) {
    case "TaskMoved":
      result = await notifyUsers(userIds, task, senderId, projectId, fromAgentId, "TaskMoved");
      break;
    case "TaskArchived":
      result = await notifyUsers(userIds, task, senderId, projectId, fromAgentId, "TaskArchived");
      break;
    case "TaskDueDate":
      result = await notifyUsers(userIds, task, senderId, projectId, fromAgentId, "TaskDueDate");
      break;
    case "TaskUpdateDescription":
      result = await notifyUsers(userIds, task, senderId, projectId, fromAgentId, "TaskUpdateDescription");
      break;
    default:
      // no-op
      break;
  }
  return result;
};

// ==================== Notification dispatcher
async function notifyUsers(
  userIds: number[],
  task: any,
  senderId: number,
  projectId: number,
  fromAgentId: string | null | undefined,
  type: NotificationType,
) {
  // Spam protection
  const spamming = await avoidSpamNotification(userIds, task.id);
  const bouncing = !spamming && (await isBounceBackNotification(task, type));

  for (const userId of userIds) {
    const notificationCreated = await createNotification({
      taskId: task.id,
      projectId,
      fromUserId: senderId,
      userId,
      type,
      fromAgentId,
    });
    if (!notificationCreated) continue;

    const devices = await prisma.subscribedDevices.findMany({
      where: { userId },
      include: { user: true },
    });

    // Create notification body variants by type
    let body: IFCMReqBody;
    let emailBody: ITaskMoveEmailBody | undefined;

    switch (type) {
      case "TaskMoved": {
        emailBody = {
          senderName: notificationCreated?.fromUser?.displayName ?? "",
          newSectionTitle: task?.section ?? "",
          taskLink:
            process.env.NEXT_PUBLIC_BASEURL +
            "/" +
            `detail/project-${task?.projectId}/${task?.uniqueIndex}`,
          emailTo: notificationCreated?.user?.email ?? "",
          taskTitle: task?.title ?? "",
        };
        body = {
          type: "taskMoved",
          notificationTitle: `${notificationCreated.fromUser?.displayName} moved a task `,
          notificationBody: `"${task?.title}" moved to "${task?.section}"`,
          devices,
          payload: notificationCreated,
          taskTitle: task?.title ?? "",
          afterAppDomain: `detail/project-${task?.projectId}/${task?.uniqueIndex}`,
        };
        break;
      }
      case "TaskArchived": {
        const archivebody = task?.status === "Archive" ? "archived" : "unarchived";
        body = {
          type,
          notificationTitle: `${notificationCreated.fromUser?.displayName} ${archivebody} "${task?.title}"`,
          notificationBody: `"${task?.title}" has been ${archivebody}.`,
          devices,
          payload: notificationCreated,
          taskTitle: task?.title ?? "",
          afterAppDomain: `detail/project-${task?.projectId}/${task?.uniqueIndex}`,
        };
        break;
      }
      case "TaskDueDate": {
        const dueDate = task?.dueDate ? new Date(task.dueDate) : undefined;
        const hasDueDate = Boolean(dueDate && isValid(dueDate));
        const notificationBody = hasDueDate
          ? `Due ${format(dueDate as Date, "d MMM yyyy")}`
          : `Removed the due date.`;
        const dueDateActor =
          notificationCreated?.fromUser?.displayName?.trim() || "Someone";
        body = {
          type,
          // Title has to track the body: it used to claim a date was set even
          // when the change was a removal.
          notificationTitle: hasDueDate
            ? `${dueDateActor} set a due date on "${task?.title}"`
            : `${dueDateActor} removed the due date on "${task?.title}"`,
          notificationBody,
          devices,
          payload: notificationCreated,
          taskTitle: task?.title ?? "",
          afterAppDomain: `detail/project-${task?.projectId}/${task?.uniqueIndex}`,
        };
        break;
      }
      case "TaskUpdateDescription": {
        body = {
          type,
          notificationTitle: `${notificationCreated.fromUser?.displayName} updated "${task?.title}"`,
          notificationBody: `"${task?.title}" description has been updated`,
          devices,
          payload: notificationCreated,
          taskTitle: task?.title ?? "",
          afterAppDomain: `detail/project-${task?.projectId}/${task?.uniqueIndex}`,
        };
        break;
      }
      default:
        continue;
    }

    await emailAndDeviceNotification(
      spamming || bouncing,
      notificationCreated,
      task,
      userId,
      body,
      emailBody,
    );
  }
  return true;
}

// ==================== Email + Device Notification
async function emailAndDeviceNotification(
  spamming: boolean,
  notificationCreated: any,
  task: any,
  userId: number,
  fcmBody: IFCMReqBody,
  emailBody?: ITaskMoveEmailBody,
) {
  if (spamming) return;
  // Email notification (for TaskMoved)
  if (
    emailBody &&
    await shouldNotify(userId, "TaskMoved", "email")
  ) {
    sendEmailNotification("TaskMove", {
      sender: emailBody.senderName,
      recipient: emailBody.emailTo,
      title: emailBody.taskTitle,
      link: emailBody.taskLink,
      section: emailBody.newSectionTitle,
      userId,
      taskId: task?.id,
    });
  }
  // FCM notification
  sendDataNewCommentFCM(fcmBody);
}

// ==================== Create notification
async function createNotification(data: ICreateNotification) {
  return await checkReminderAndCreateNotification(
    data.userId,
    data.projectId,
    data.taskId,
    {
      ...data,
      ...(data.fromAgentId ? { fromAgentId: data.fromAgentId } : {}),
    },
  );
}

// ==================== Anti-spam logic: returns true if recently sent/must suppress
async function avoidSpamNotification(userIds: number[], taskId: number) {
  const currentDate = new Date();
  const spamTime = new Date(currentDate.getTime() - 8000); // 8 seconds
  const notifications = await prisma.notification.findMany({
    where: {
      createdAt: {
        gte: spamTime,
        lt: currentDate,
      },
      taskId,
      userId: { in: userIds },
      type: "TaskMoved",
    },
  });

  if (notifications.length > 0) {
    await prisma.notification.deleteMany({
      where: { id: { in: notifications.map((x) => x.id) } },
    });
    return true;
  }
  return false;
}

// ==================== Bounce-back guard: suppress email/push when the task is
// landing on a section/status that was already announced within the window
// (A->B->A flapping). One-way triage moves still notify. The activity comment
// written on every move/archive is the only destination history available —
// Notification rows do not record the section.
const BOUNCE_BACK_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

async function isBounceBackNotification(
  task: { id: number; sectionId: number | null; status: string | null },
  type: NotificationType,
) {
  if (type !== "TaskMoved" && type !== "TaskArchived") return false;
  // Only look at activities from before the 8s spam window: the activity for
  // the current move may already be committed (it is on the archive path),
  // and without this grace period every notification would match itself.
  const now = Date.now();
  const activities = await prisma.comment.findMany({
    where: {
      taskId: task.id,
      createdAt: {
        gte: new Date(now - BOUNCE_BACK_WINDOW_MS),
        lt: new Date(now - 8000),
      },
      activity: { not: Prisma.DbNull },
    },
    select: { activity: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return activities.some(({ activity }) => {
    const a = activity as any;
    if (type === "TaskMoved") {
      return a?.type === "TaskMove" && a?.data?.toSection?.sectionId === task.sectionId;
    }
    return a?.type === "TaskArchive" && a?.data?.newStatus === task.status;
  });
}

export default sendNotificationForTask;
