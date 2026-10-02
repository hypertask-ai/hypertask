import { IComment, IUser, ITaskLabel, IAttachment, ISection, IAssignees } from "@/models/model";
import { ViewVisibility } from "@prisma/client";
import type { TaskDetailState } from "./TaskDetailState";
export type TaskDetailContext = TaskDetailState & createTaskDetailActionsHandlers;

export interface createTaskDetailActionsHandlers {
  taskUpdateCommentsInCache: (newComment: IComment) => void;
  moveTaskToNextColumn: (sectionToMoveTo: ISection) => Promise<void>;
  returnCurrentFocusedType: () => "Description" | "Edit-Comment" | "New-Comment" | "Others";
  titleEscapeHandler: () => void;
  gPressHandler: (e: any, shift: boolean) => void;
  EnterHandler: (e: any) => void;
  CTRL_ENTERHandler: (e: any) => void;
  undoHandler: (data: any, toastId: string) => Promise<void>;
  toggleLabelModal: (taskLabels?: ITaskLabel[], refresh?: boolean, shouldCloseOnUpdate?: boolean) => void;
  aHandler: () => void;
  toggleMoveToBoardModal: () => void;
  returnFocusToComment: () => void;
  callback: (payload: any, mode: string) => Promise<void> | undefined;
  toggleTimeTracking: () => Promise<void>;
  branchInNewChat: () => void;
  copyFocusedCommentToAiChat: () => void;
  summarizeFocusedComment: () => void;
  fastLikeFocusedComment: () => void;
  audioInputHandler: (improve?: boolean) => void;
  moveTaskModalCallback: (section: ISection) => void;
  moveTaskToInbox: (userId: number, projectId: number, taskId: number) => Promise<void>;
  handleCopyFunctionsFromHTC: (payload: | "Private"
      | "PrivateFormatted"
      | "Public"
      | "PublicFormatted"
      | "TitleAndID"
      | "ID") => void;
  getCurrentCommentIndex: (createTask?: boolean) => number | undefined;
  handleReactToCommentFromHTC: () => void;
  handleReplyCommentFromHTC: () => void;
  handleEditCommentFromHTC: () => void;
  handleStarCommentFromHTC: (type: ViewVisibility) => void;
  createTaskFromCommentHTC: () => void;
  processAttachmentsForNewTask: (attachments?: IAttachment[]) => any[];
  copyCommentURLFromHTC: () => void;
  copyCommentContentFromHTC: () => Promise<void>;
  viewSubTasksfromHtc: () => void;
  openAifromHtc: () => void;
  deleteComment: (id: number) => Promise<void>;
  updateActiveItemAndItemInView: (taskId: number | null) => void;
  toggleModal: (_assignees?: IAssignees[], keepOpen?: boolean) => void;
  toggleDeleteModal: () => void;
  linksModalToggle: (_assignees?: IUser[]) => void;
  toggleMoveModal: () => void;
  togglePriorityModal: (refresh?: boolean) => void;
  toggleRemindMeModal: (refresh?: boolean) => Promise<void>;
  toggleEstimateModal: (refresh?: boolean) => void;
  setDueDateCallback: (date: Date | undefined) => void;
  toggleDueDate: (refresh?: boolean) => void;
  toggleRemoveSubtaskModal: () => void;
  deleteTask: (state: boolean) => Promise<void>;
  getTask: () => Promise<void>;
  UnFollowCallback: () => void;
  UnFollow: (id: any) => Promise<void>;
  removeRelationHandler: (relationId: number) => Promise<void>;
}
