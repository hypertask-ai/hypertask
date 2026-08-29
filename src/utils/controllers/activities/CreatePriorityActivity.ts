import { IPriority, IUser } from "@/models/model";
import createActivity from "./createActivity";
import { ITaskPriorityActivity } from "@/models/ActivityModels.ts";

interface IProps {
  userObj: IUser;
  toPriority: {
    priority_index: number;
    Priority_Value: string;
    priority?: IPriority;
  };
  fromPriority?: {
    priority_index: number;
    Priority_Value: string;
    priority?: IPriority | undefined;
  };
  taskId: number;
  fromAgent?: {
    id: string;
    userId: number;
    displayName: string;
    photoURL?: string | null;
  };
}

const createPriorityActivity = async ({
  userObj,
  taskId,
  toPriority,
  fromPriority,
  fromAgent,
}: IProps) => {
  const activityBody: ITaskPriorityActivity = {
    type: "TaskPriority",
    data: {
      fromUserId: userObj.id,
      fromUserDisplayName: userObj.displayName ?? "",
      fromUser: userObj,
      toPriority: {
        priority_index: toPriority.priority_index,
        Priority_Value: toPriority.Priority_Value,
        priority: toPriority.priority,
      },
      fromPriority: {
        priority_index: fromPriority?.priority_index,
        Priority_Value: fromPriority?.Priority_Value,
        priority: fromPriority?.priority,
      },
      fromAgent,
    },
  };

  createActivity({
    activityBody,
    taskId,
  });
};

export default createPriorityActivity;
