import { Status } from "@prisma/client";
import { IAgent, IEstimate, IPriority, ITaskLabel, IUser } from "../model";

export interface ITaskMoveActivity {
  type: "TaskMove";
  data: {
    fromUserId: number;
    fromUserDisplayName: string;
    fromUser?: IUser;
    fromAgent?: IAgent | null;
    toSection?: {
      sectionId: number;
      sectionTitle: string;
    };
    fromSection?: {
      sectionId: number;
      sectionTitle: string;
    };
    currentSection?: {
      sectionId: number;
      sectionTitle: string;
    };
    statusFlipCount?: number;
    quickMoveCollapsed?: boolean;
  };
}

export interface ITaskUpdateDescriptionActivity {
  type: "TaskDescriptionUpdate";
  data: {
    fromUserId: number;
    fromUserDisplayName: string;
    fromUser?: IUser;
    fromAgent?: {
      id: string;
      userId: number;
      displayName: string;
      photoURL?: string | null;
    } | null;
  };
}

export interface ITaskWaitingOnActivity {
  type: "TaskWaitingOn";
  data: {
    fromUserId: number;
    fromUser: IUser;
    waitingOnDisplayName?: string | null;
  };
}

export interface ITaskDueDateActivity {
  type: "TaskDueDate";
  data: {
    fromUserId: number;
    fromUserDisplayName: string;
    fromUser?: IUser;
    fromAgent?: {
      id: string;
      userId: number;
      displayName: string;
      photoURL?: string | null;
    } | null;
    toDueDate?: Date;
    fromDueDate?: Date;
  };
}
export interface ITaskArchiveActivity {
  type: "TaskArchive";
  data: {
    fromUserId: number;
    fromUserDisplayName: string;
    fromUser?: IUser;
    fromAgent?: {
      id: string;
      userId: number;
      displayName: string;
      photoURL?: string | null;
    } | null;
    newStatus: Status;
  };
}

export interface ITaskPriorityActivity {
  type: "TaskPriority";
  data: {
    fromUserId: number;
    fromUserDisplayName: string;
    fromUser?: IUser;
    fromAgent?: {
      id: string;
      userId: number;
      displayName: string;
      photoURL?: string | null;
    };
    toPriority?: {
      priority_index: number;
      Priority_Value: string;
      priority?: IPriority;
    };
    fromPriority?: {
      priority_index?: number;
      Priority_Value?: string;
      priority?: IPriority;
    };
  };
}

export interface ITaskAssignedActivity {
  type: "TaskAssigned";
  data: {
    fromUser: {
      userId: number;
      displayName: string;
      user: any;
    };
    toUser: {
      userId: number;
      displayName: string;
      user: any;
    };
    fromAgent?: {
      id: string;
      userId: number;
      displayName: string;
      photoURL?: string | null;
    };
    toAgent?: {
      id: string;
      userId: number;
      displayName: string;
      photoURL?: string | null;
    };
    updatedStatus: "Assigned" | "Unassigned";
    fromUserId: number;
  };
}

export interface ITaskEstimateActivity {
  type: "TaskEstimate";
  data: {
    fromUserId: number;
    fromUserDisplayName: string;
    fromUser?: IUser;
    fromAgent?: {
      id: string;
      userId: number;
      displayName: string;
      photoURL?: string | null;
    } | null | undefined;
    toEstimate: {
      estimate_index: number;
      estimate_value: string;
      estimate?: IEstimate;
    };
    fromEstimate?: {
      estimate_index?: number;
      estimate_value?: string;
      estimate?: IEstimate;
    };
  };
}

export type TTaskStatus = "Created" | "Assigned" | "Removed";
export interface ITaskLabelActivity {
  type: "TaskLabel";
  status: TTaskStatus;
  data: {
    fromUserId: number;
    fromUserDisplayName: string;
    fromUser?: IUser;
    fromAgent?: {
      id: string;
      userId: number;
      displayName: string;
      photoURL?: string | null;
    } | null;
    toLabel: ITaskLabel;
  };
}
