import { IUser } from "@/models/model";
import createActivity from "./createActivity";
import { ITaskDueDateActivity } from "@/models/ActivityModels.ts";

interface IProps {
  userObj: IUser;
  toDueDate?: Date;
  fromDueDate?: Date;
  taskId: number;
  fromAgent?: {
    id: string;
    userId: number;
    displayName: string;
    photoURL?: string | null;
  } | null;
}

const createTaskDueDateActivity = async ({
  userObj,
  taskId,
  toDueDate,
  fromDueDate,
  fromAgent,
}: IProps) => {
  const activityBody: ITaskDueDateActivity = {
    type: "TaskDueDate",
    data: {
      fromUserId: userObj.id,
      fromUserDisplayName: userObj.displayName ?? "",
      fromUser: userObj,
      fromAgent,
      toDueDate,
      fromDueDate,
    },
  };

  createActivity({
    activityBody,
    taskId,
    runTaskSummary: false,
  });
};

export default createTaskDueDateActivity;
