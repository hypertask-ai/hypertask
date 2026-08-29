import {
  IEstimateConstants,
  IPrioritiesConstants,
} from "@/lib/constants/constants";

export interface ISubText {
  type: "text" | "key";
  content: string;
}

export interface IHintText extends ISubText {
  active?: boolean;
  index?: number;
}

export interface INewCommentAttachments {
  index: number;
  file: {
    id: number;
    createdAt: number | Date;
    type: string;
    source: string;
    name: string;
    size: string | null | undefined;
    taskId: number;
  };
}

export interface ITutorialScene {
  title: string;
  subtitle: ISubText[];
  hint: IHintText[];
}

export interface ISplitTitle {
  title: string;
  count: string;
  active: boolean;
}

export interface INotification {
  user: string;
  task: {
    identifier: string;
    title: string;
    message: string;
    count: number;
  };
  date: string;
  showDot: boolean;
  priority: IPrioritiesConstants;
  tags: string[];
}

export interface IBoardHeader {
  title: string;
  ownerImg: string;
  memberImgs: string[];
  inboxCount: number;
}

export interface IBoardTask {
  identifier: string;
  title: string;
  labels?: string[];
  priority?: IPrioritiesConstants;
  size?: IEstimateConstants;
  assignee?: string[];
  duedate?: Date;
}

export interface IBoardSection {
  title: string;
  tasks: IBoardTask[];
  showBottomButton: boolean;
}

export interface IBoardTaskPagesComment {
  createdBy: string;
  imgSrc: string;
  text: string;
  createdAt: string;
}

export interface ITaskInfo {
  assignees: { name: string; pfp: string }[];
  id: string;
  status: string;
  dueDate?: Date;
  priority?: IPrioritiesConstants;
  taskSize?: IEstimateConstants;
  project: string;
  tags: string[];
}

export interface IBoardTaskPage {
  headingTitle: string;
  descriptionContainer: string;
  creatorImg?: string;
  creatorName?: string;
  createdAt: string;
  comments: IBoardTaskPagesComment[];
  taskInfo: ITaskInfo;
}

export interface IBoard {
  header: IBoardHeader;
  sections: IBoardSection[];
  taskPages: IBoardTaskPage[];
}

export interface ITutorialAtom {
  index: number;
  phase: number;
  currPage: TTutorialPage;
}

export type TTutorialPage =
  | "landing"
  | "taskDetail"
  | "inbox"
  | "end"
  | undefined;
