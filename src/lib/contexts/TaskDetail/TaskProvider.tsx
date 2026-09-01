"use client";
import React, {
  createContext,
  useContext,
  ReactNode,
  useState,
  type RefObject,
} from "react";
import {
  IAllCommands,
  IAttachment,
  IComment,
  IDraft,
  ITask,
  IUploadingDescription,
  IUser,
  StackedType,
  TCarousalItems,
} from "@/models/model";
import useTaskDetailGlobalStates, {
  IShow,
  TReturnFocusedEl,
} from "@/hooks/Task Detail/useTaskDetailGlobalStates";
import { ScrollSetting, ViewVisibility } from "@prisma/client";
import { Virtualizer } from "@tanstack/react-virtual";

interface TaskContextProps {
  children?: ReactNode; // Add this line to include children
  parsedTask: string;
  allowPerks: boolean;
  _comments: string;
  _initialStacked: StackedType;
  stack: any;
  scrollSetting: ScrollSetting;
  /** Public share links use server-rendered comments and a non-virtualized layout */
  isShareView?: boolean;
  /** Task detail is mounted inside another scrollable surface, such as SwipeUnread. */
  embedded?: boolean;
  scrollElementRef?: RefObject<HTMLDivElement | null>;
}

export type ITaskDetailEditMode =
  | "title"
  | "description"
  | "assignees"
  | "comment"
  | "new-comment-ai"
  | null
  | "edit-comment"
  | "edit-comment-ai"
  | "description-ai";
// Define the type for the modal state
interface GlobalStates extends TaskContextProps {
  parsedTask: string;
  allowPerks: boolean;
  _comments: string;

  editMode: ITaskDetailEditMode;
  setEditMode: React.Dispatch<React.SetStateAction<ITaskDetailEditMode>>;
  currentTask: ITask | null;
  setCurrentTask: React.Dispatch<React.SetStateAction<ITask | null>>;
  currentId: string;
  setCurrentId: React.Dispatch<React.SetStateAction<string>>;
  focusOn: (
    id: string,
    scroll?: boolean,
    behavior?: ScrollBehavior,
    block?: ScrollLogicalPosition | any,
    avoidDocumentFocus?: boolean
  ) => void;
  currentItemInTasksPlaylist: {
    projectId: number;
    uniqueIndex: any;
  };
  onGoback: () => void;
  editModeCheck: boolean;
  editState: number | null;
  setEditState: React.Dispatch<React.SetStateAction<number | null>>;
  forceOpenEdit: (
    mode: "title" | "description" | "assignees" | "comment" | null
  ) => void;
  loading: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setIsSummaryExpand: React.Dispatch<React.SetStateAction<boolean>>;
  isSummaryExpanded: boolean;
  refocusAndOpenTaskWriter: (prevActive: string) => void;
  EnterCommentCreateMode: (shouldTriggerAi?: boolean) => void;
  editDescriptionHandler: (shouldTriggerAi?: boolean) => void;
  editCommentHandler: (currentIndex: number, shouldTriggerAi?: boolean) => void;
  description: string;
  setDescription: React.Dispatch<React.SetStateAction<string>>;
  descriptionFocusRequest: { taskId: number; nonce: number } | null;
  requestDescriptionFocus: (taskId: number) => void;
  stacked: StackedType;
  setStacked: React.Dispatch<React.SetStateAction<StackedType>>;
  returnCurrentFocusedType(): TReturnFocusedEl;
  CTRL_J_ENTER_Handler: (shouldTriggerAi?: boolean) => void;
  comments: IComment[];
  setComments: React.Dispatch<React.SetStateAction<IComment[]>>;
  newCommentIds: number[];
  setNewCommentIds: React.Dispatch<React.SetStateAction<number[]>>;
  newCommentsSnapshotReady: boolean;
  setNewCommentsSnapshotReady: React.Dispatch<React.SetStateAction<boolean>>;
  toggleSubtaskLinkingModal: () => void;
  showSubtaskLinkingModal: boolean;
  showCommentDeleteModal: boolean;
  setShowCommentDeleteModal: React.Dispatch<React.SetStateAction<boolean>>;
  hasDraft: boolean;
  hasDraftInit: boolean;
  setHasDraftInit: React.Dispatch<React.SetStateAction<boolean>>;
  hasCommentDraft: boolean;
  showTaskDeleteModal: boolean;
  setShowTaskDeleteModal: React.Dispatch<React.SetStateAction<boolean>>;
  showRemindMeModal: boolean;
  setShowRemindMeModal: React.Dispatch<React.SetStateAction<boolean>>;
  showTaskOptionsModal: boolean;
  setShowTaskOptionsModal: React.Dispatch<React.SetStateAction<boolean>>;
  showRemoveSubtaskModal: boolean;
  setShowRemoveSubtaskModal: React.Dispatch<React.SetStateAction<boolean>>;
  handlePinComment: (commentId: string, type: ViewVisibility) => Promise<void>;
  handleStarTask: () => Promise<void>;
  createContextOptionsForHTC: () => IAllCommands;
  replyToCommentHandler: (currentIndex: number) => string | undefined;
  InsertContentInCommentInput: (content: string, quoter: IUser) => void;
  replyQuote: string | null;
  setReplyQuote: React.Dispatch<React.SetStateAction<string | null>>;
  toggleEmojiPicker: (commentIndex: number) => void;
  showEmojiPickerAtComment: IShow | undefined;
  setShowEmojiPickerAtCount: React.Dispatch<
    React.SetStateAction<IShow | undefined>
  >;
  isRecording: boolean;
  toggleRecording: (val: boolean) => void;
  uploadingComments: any[];
  setUploadingComments: (payload: any) => unknown;
  uploadingDescription: IUploadingDescription | undefined;
  setUploadingDescription: React.Dispatch<
    React.SetStateAction<IUploadingDescription | undefined>
  >;
  virtualizer: Virtualizer<any, Element>;
  _count: number;
  scrollVirtualize: (
    type: "new-comment" | "comment" | "description" | "edit-description",
    commentIndex?: number,
    end?: boolean,
    withCommentId?: boolean
  ) => void;
  listRef: React.MutableRefObject<HTMLDivElement | null>;
  stackData: boolean;
  showHistory: boolean;
  toggleHistory: () => void;
  visibleCommentIndices: number[];
  virtualizeIndexes: {
    totalCount: number;
    taskInfoVirtualIndex: number;
    descriptionVirtualIndex: number;
    descriptionBottomVirtualIndex: number;
    commentsStartVirtualIndex: number;
    uploadingCommentsStartVirtualIndex: number;
    numberOfComments: number;
    numberOfUploadingComments: number;
  };
  carousalItems: TCarousalItems;
  setCarousalItems: React.Dispatch<React.SetStateAction<TCarousalItems>>;
  showScrollToTop: boolean;
  setShowScrollToTop: React.Dispatch<React.SetStateAction<boolean>>;
  defaultCommentFocus: () => void;
  draftsFromTQ: IDraft[];
  draftsHydrated: boolean;
}

const TaskContext = createContext<GlobalStates | undefined>(undefined);

const TasksProvider: React.FC<TaskContextProps> = ({ children, ...props }) => {
  const [loading, setLoading] = useState<boolean>(false);
  const [newCommentIds, setNewCommentIds] = useState<number[]>([]);
  const [newCommentsSnapshotReady, setNewCommentsSnapshotReady] =
    useState<boolean>(false);
  const taskGlobalStates = useTaskDetailGlobalStates(
    JSON.parse(props.parsedTask),
    props._comments,
    props._initialStacked,
    props.stack,
    props.isShareView ?? false,
    props.scrollElementRef,
  );
  // get current task keys
  // ----------------- CLICKING ON MAIN DIVS TO FORCE FOCUS AND SET EDIT MODE FOR STATE
  const forceOpenEdit = (
    mode: "title" | "description" | "assignees" | "comment" | null
  ) => {
    taskGlobalStates.setEditMode(mode);
  };

  // Combine state and setState into an object
  const modalState: GlobalStates = {
    ...props,
    ...taskGlobalStates,
    loading,
    setLoading,
    newCommentIds,
    setNewCommentIds,
    newCommentsSnapshotReady,
    setNewCommentsSnapshotReady,
    forceOpenEdit,
  };

  return (
    <TaskContext.Provider value={modalState}>{children}</TaskContext.Provider>
  );
};

const useTaskDetailGlobalStateContext = () => {
  const context = useContext(TaskContext);
  if (!context) {
    throw new Error("usetaskscontext must be used within a CommentsProvider");
  }
  return context;
};

export { TasksProvider, useTaskDetailGlobalStateContext as useTaskContext };
