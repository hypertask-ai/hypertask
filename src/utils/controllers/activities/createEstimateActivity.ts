import { IEstimate, IUser } from "@/models/model";
import createActivity from "./createActivity";
import { ITaskEstimateActivity } from "@/models/ActivityModels.ts";

interface IProps {
  fromUser: IUser;
  taskId: number;
  toEstimate: {
    estimate_index: number;
    estimate_value: string;
    estimate?: IEstimate;
  };
  fromEstimate?: {
    estimate_index: number;
    estimate_value: string;
    estimate?: IEstimate | undefined;
  };
  fromAgent?: {
    id: string;
    userId: number;
    displayName: string;
    photoURL?: string | null;
  } | null;
}

const createEstimateActivity = async ({
  fromUser,
  taskId,
  toEstimate,
  fromEstimate,
  fromAgent,
}: IProps) => {
  const activityBody: ITaskEstimateActivity = {
    type: "TaskEstimate",
    data: {
      fromUserId: fromUser.id,
      fromUserDisplayName: fromUser.displayName ?? "",
      fromUser: fromUser,
      fromAgent,
      toEstimate: {
        estimate_index: toEstimate.estimate_index,
        estimate_value: toEstimate.estimate_value,
        estimate: toEstimate.estimate,
      },
      fromEstimate: {
        estimate_index: fromEstimate?.estimate_index,
        estimate_value: fromEstimate?.estimate_value,
        estimate: fromEstimate?.estimate,
      },
    },
  };
  createActivity({
    activityBody,
    taskId,
  });
};

export default createEstimateActivity;
