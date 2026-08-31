import { IUser } from "@/models/model";
import createActivity from "./createActivity";
import { ITaskMoveActivity } from "@/models/ActivityModels.ts";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import {
  classifyTaskMoveCollapse,
  mergeStatusFlipActivity,
} from "./taskMoveCollapse";

interface IProps {
  userObj: IUser;
  toSectionId: number;
  toSection_title: string;
  fromSectionId: number;
  fromSection_title: string;
  taskId: number;
  fromAgent?: {
    id: string;
    userId: number;
    displayName: string;
    photoURL?: string | null;
  } | null;
}

const createTaskMovedActivity = async ({
  userObj,
  toSectionId,
  toSection_title,
  fromSectionId,
  fromSection_title,
  taskId,
  fromAgent,
}: IProps) => {
  const activityBody: ITaskMoveActivity | any = {
    type: "TaskMove",
    data: {
      fromUserId: userObj.id,
      fromUserDisplayName: userObj.displayName,
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
  };
  if (fromSectionId === toSectionId) {
    return { newComment: null, shouldNotify: false };
  }

  // Only the task's latest activity can be extended. This preserves anything
  // another actor did between moves and keeps the collapsed row at the end of
  // the activity feed.
  const previous = await prisma.comment.findFirst({
    where: { taskId, activity: { not: Prisma.JsonNull } },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, activity: true },
  });

  const previousActivity = previous?.activity as ITaskMoveActivity | any;
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

  if (previous && collapseKind === "status-flip") {
    const newComment = await prisma.comment.update({
      where: { id: previous.id },
      data: {
        activity: mergeStatusFlipActivity(previousActivity, {
          sectionId: toSectionId,
          sectionTitle: toSection_title,
        }) as any,
        createdAt: new Date(),
      },
    });
    return { newComment, shouldNotify: false };
  }

  if (previous && collapseKind === "quick-journey") {
    const originSectionId = previousActivity.data.fromSection?.sectionId;

    // HTPR-3793: a rapid keyboard journey that returns to its starting point
    // leaves no misleading move behind.
    if (originSectionId === toSectionId) {
      await prisma.comment.delete({ where: { id: previous.id } });
      return { newComment: null, shouldNotify: true };
    }

    const newComment = await prisma.comment.update({
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
  });
  return { newComment, shouldNotify: true };
};

export default createTaskMovedActivity;
