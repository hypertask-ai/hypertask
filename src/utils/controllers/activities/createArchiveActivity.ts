import { IUser } from "@/models/model";
import createActivity from "./createActivity";
import { ITaskArchiveActivity } from "@/models/ActivityModels.ts";
import { Status } from "@prisma/client";
interface IProps {
  taskId: number;
  fromUserId: number;
  fromUserDisplayName: string;
  fromUser?: IUser;
  newStatus: Status;
  fromAgent?: {
    id: string;
    userId: number;
    displayName: string;
    photoURL?: string | null;
  } | null;
}

const createArchiveActivity = async ({
  taskId,
  fromUser,
  fromUserId,
  fromUserDisplayName,
  newStatus,
  fromAgent,
}: IProps) => {
  const activityBody: ITaskArchiveActivity = {
    type: "TaskArchive",
    data: {
      fromUserId,
      fromUserDisplayName,
      fromUser,
      fromAgent,
      newStatus,
    },
  };
  createActivity({
    activityBody,
    taskId,
    runTaskSummary: false,
  });
};

export default createArchiveActivity;
