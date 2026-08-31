import { IUser } from "@/models/model";
import createActivity from "./createActivity";
import { ITaskMoveActivity } from "@/models/ActivityModels.ts";
import { Prisma } from "@prisma/client";
import {
  classifyTaskMoveCollapse,
  mergeStatusFlipActivity,
} from "./taskMoveCollapse";

export interface TaskMovedActivityProps {
  userObj: IUser;
  toSectionId: number | null;
  toSection_title: string;
  fromSectionId: number | null;
  fromSection_title: string;
  taskId: number;
  fromAgent?: {
    id: string;
    userId: number;
    displayName: string;
    photoURL?: string | null;
  } | null;
  sendNotification?: () => Promise<unknown>;
}

type StoredMoveActivity = Parameters<
  typeof classifyTaskMoveCollapse
>[0]["previousActivity"];

export async function createTaskMovedActivityInTransaction({
  transaction,
  userObj,
  toSectionId,
  toSection_title,
  fromSectionId,
  fromSection_title,
  taskId,
  fromAgent,
}: Omit<TaskMovedActivityProps, "sendNotification"> & {
  transaction: Prisma.TransactionClient;
}) {
  const activityBody = {
    type: "TaskMove",
    data: {
      fromUserId: userObj.id,
      fromUserDisplayName: userObj.displayName ?? "",
      fromUser: userObj,
      fromAgent,
      toSection: {
        sectionId: toSectionId,
        sectionTitle: toSection_title,
      },
      fromSection: {
        sectionId: fromSectionId,
        sectionTitle: fromSection_title,
      },
    },
  } as unknown as ITaskMoveActivity;
  if (fromSectionId === toSectionId) {
    return { newComment: null, shouldNotify: false };
  }

  // Only the task's latest activity can be extended. This preserves anything
  // another actor did between moves and keeps the collapsed row at the end of
  // the activity feed.
  const previous = await transaction.comment.findFirst({
    where: { taskId, activity: { not: Prisma.JsonNull } },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, activity: true },
  });

  const previousActivity = previous?.activity as unknown as StoredMoveActivity;
  const sameActor = fromAgent
    ? previousActivity?.data?.fromAgent?.id === fromAgent.id
    : !previousActivity?.data?.fromAgent &&
      previousActivity?.data?.fromUserId === userObj.id;

  const collapseKind = previous
    ? classifyTaskMoveCollapse({
        previousActivity,
        previousCreatedAt: previous.createdAt,
        sameActor,
        fromSectionId,
        toSectionId,
      })
    : null;

  if (previous && previousActivity && collapseKind === "status-flip") {
    const newComment = await transaction.comment.update({
      where: { id: previous.id },
      data: {
        // Prisma requires an index signature for JSON input, while the typed
        // activity model lists its serializable fields explicitly.
        activity: mergeStatusFlipActivity(
          previousActivity as unknown as ITaskMoveActivity,
          {
            sectionId: toSectionId,
            sectionTitle: toSection_title,
          },
        ) as unknown as Prisma.InputJsonValue,
        createdAt: new Date(),
      },
    });
    return { newComment, shouldNotify: false };
  }

  if (previous && previousActivity && collapseKind === "quick-journey") {
    const originSectionId = previousActivity.data?.fromSection?.sectionId;

    // HTPR-3793: a rapid keyboard journey that returns to its starting point
    // leaves no misleading move behind.
    if (originSectionId === toSectionId) {
      await transaction.comment.delete({ where: { id: previous.id } });
      return { newComment: null, shouldNotify: true };
    }

    const newComment = await transaction.comment.update({
      where: { id: previous.id },
      data: {
        activity: {
          ...previousActivity,
          data: {
            ...previousActivity.data,
            quickMoveCollapsed: true,
            toSection: {
              sectionId: toSectionId,
              sectionTitle: toSection_title,
            },
          },
        },
      },
    });
    return { newComment, shouldNotify: true };
  }

  const newComment = await createActivity({
    activityBody,
    taskId,
    runTaskSummary: false,
    transaction,
  });
  return { newComment, shouldNotify: true };
}
