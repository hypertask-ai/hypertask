import createActivity from "./createActivity";
import { ITaskAssignedActivity } from "@/models/ActivityModels.ts";
import { Prisma } from "@prisma/client";

export const assignmentActivityUserSelect = {
  id: true,
  email: true,
  displayName: true,
  photoURL: true,
} satisfies Prisma.UserSelect;

interface IProps {
  fromUser: {
    userId: number;
    displayName: string;
    user: any;
  };
  taskId: number;
  toUser: {
    userId: number;
    displayName: string;
    user: any;
  };
  updatedStatus: "Assigned" | "Unassigned";
  fromAgent?: {
    id: string;
    userId: number;
    displayName: string;
    photoURL?: string | null;
  } | null;
  toAgent?: {
    id: string;
    userId: number;
    displayName: string;
    photoURL?: string | null;
  } | null;
}

const createAssignedActivity = async ({
  fromUser,
  taskId,
  toUser,
  updatedStatus,
  fromAgent,
  toAgent,
}: IProps) => {
  const activityBody: ITaskAssignedActivity = {
    type: "TaskAssigned",
    data: {
      fromUser: {
        userId: fromUser.userId,
        displayName: fromUser.displayName ?? "",
        user: fromUser.user,
      },
      updatedStatus: updatedStatus,
      fromUserId: fromUser.userId,
      toUser: {
        userId: toUser.userId,
        displayName: toUser.displayName ?? "",
        user: toUser.user,
      },
      fromAgent: fromAgent ?? undefined,
      toAgent: toAgent ?? undefined,
    },
  };
  const comment = await createActivity({
    activityBody,
    taskId,
  });
  return Number.isSafeInteger(Number(comment?.id)) ? Number(comment.id) : null;
};

export default createAssignedActivity;
