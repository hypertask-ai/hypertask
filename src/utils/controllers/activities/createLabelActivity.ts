import { ITaskLabel, IUser } from "@/models/model";
import createActivity from "./createActivity";
import { ITaskLabelActivity, TTaskStatus } from "@/models/ActivityModels.ts";
import type { Prisma } from "@prisma/client";

interface IProps {
  userObj: IUser;
  toTaskLabel: ITaskLabel;
  taskId: number;
  status: TTaskStatus;
  transaction?: Prisma.TransactionClient;
  fromAgent?: {
    id: string;
    userId: number;
    displayName: string;
    photoURL?: string | null;
  } | null;
}

const createLabelActivity = async ({
  userObj,
  taskId,
  toTaskLabel,
  status,
  fromAgent,
  transaction,
}: IProps) => {
  const activityBody: ITaskLabelActivity = {
    type: "TaskLabel",
    status,
    data: {
      fromUserId: userObj.id,
      fromUserDisplayName: userObj.displayName ?? "",
      fromUser: userObj,
      fromAgent,
      toLabel: toTaskLabel,
    },
  };

  return createActivity({
    activityBody,
    taskId,
    transaction,
  });
};

export default createLabelActivity;
