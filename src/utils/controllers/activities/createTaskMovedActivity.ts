import { IUser } from "@/models/model";
import createActivity from "./createActivity";
import { ITaskMoveActivity } from "@/models/ActivityModels.ts";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

// "Quick succession" per HTPR-3793. Long enough to cover walking a card across
// a board with the keyboard, short enough that two deliberate moves minutes
// apart stay two separate history entries.
const COLLAPSE_WINDOW_MS = 60_000;

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
  if (fromSectionId === toSectionId) return;

  // HTPR-3793: walking a card through several columns with the keyboard wrote
  // one history row per stop, so the feed read as noise and the move that
  // actually mattered was buried. Collapse a rapid follow-up move into the
  // previous one so the history shows the real journey: where it started, and
  // where it ended up.
  //
  // Only the task's LATEST activity is collapsed, so nothing that happened in
  // between ever gets reordered or absorbed, and only when the same person or
  // agent made both moves.
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

  const isCollapsible =
    previous &&
    previousActivity?.type === "TaskMove" &&
    sameActor &&
    // The previous move must have ended where this one begins, otherwise these
    // are two separate journeys that happen to be adjacent.
    previousActivity?.data?.toSection?.sectionId === fromSectionId &&
    Date.now() - new Date(previous.createdAt).getTime() <= COLLAPSE_WINDOW_MS;

  if (isCollapsible) {
    const originSectionId = previousActivity.data.fromSection?.sectionId;

    // Moved back where it started: the round trip changed nothing, so leave no
    // trace of it rather than recording a move to the column it never left.
    if (originSectionId === toSectionId) {
      await prisma.comment.delete({ where: { id: previous.id } });
      return;
    }

    return await prisma.comment.update({
      where: { id: previous.id },
      data: {
        activity: {
          ...previousActivity,
          data: {
            ...previousActivity.data,
            toSection: {
              sectionId: toSectionId,
              sectionTitle: toSection_title,
            },
          },
        },
      },
    });
  }

  return await createActivity({
    activityBody,
    taskId,
    runTaskSummary: false,
  });
};

export default createTaskMovedActivity;
