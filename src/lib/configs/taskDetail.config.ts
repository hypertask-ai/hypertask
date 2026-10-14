
import { escapeHtml } from "@/utils/htmlEscape";

const taskDetailConfig = {
  elementIds: {
    descriptionContainer: "description-container",
    taskDetailPageBackButton: "task-detail-page-back-button",
    taskInfoCommentsDescriptionContainer: "taskInfo_comments_description_container",
    markAsDone: "markAsDone",
    copyTaskUrlButton: "copy-task-url-button",
    title: "title",
    commentInput: "comment-input",
    comment: "comment",
    bottom: "bottom",
    carouselContainer: "carousel-container",
    modalButtons: "modalButtons",
    htc: "htc",
    boardManager: "boardManager",
  },

  
  modals: {
    active: ["assignees", "linksModal", "htc"] as const,
    assignees: "assignees",
    links: "linksModal",
    htc: "htc",
  },

  classNames: {
    tipTap: "tiptap ProseMirror ProseMirror-focused",
    proseMirror: "ProseMirror ProseMirror-focused",
    returnFrom: [
      "modal-open",
      "ProseMirror ProseMirror-focused",
      undefined,
    ] as const,
    inputFocused: [
      "input",
      "textarea",
      "textbox",
      "ProseMirror",
    ] as const,
  },

  queryKeys: {
    moveTaskModal: "moveTaskModal",
    priority: "priority",
    estimate: "estimate",
    taskLabels: "taskLabels",
    inbox: "inbox",
    projectsAll: "projectsAll",
  },

  delays: {
    doubleKeyPress: 500,
    titleEditMode: 100,
    audioButtonClick: 200,
    scrollToElement: 500,
    focusCommentInput: 300,
    defaultCommentFocus: 400,
    mobileFocusComment: 500,
  },

  dimensions: {
    desktopNavigation: {
      top: 40,
    },
    backButton: {
      size: 40,
      borderRadius: 20,
    },
    tooltip: {
      leftOffset: 45,
      bottomOffset: 2,
    },
  },

  httpStatus: {
    ok: 200,
  },

  taskStatus: {
    deleted: "Deleted",
    move: "Move",
  },

  editModes: {
    title: "title",
    description: "description",
    comment: "comment",
    descriptionAi: "description-ai",
    newCommentAi: "new-comment-ai",
    editCommentAi: "edit-comment-ai",
  },

  scrollSettings: {
    none: "None",
    bottom: "Bottom",
  },

  taskIds: {
    newTask: -1,
  },

  keyboard: {
    escape: "Escape",
    escapeCombination: ["ESC"] as const,
  },

  urls: {
    taskDetailPattern: "/detail/project-",
    commentHashPrefix: "#comment-",
    templates: {
      commentLink: (projectId: number, uniqueIndex: string, ticketNumber: string, commentIndex: number) => {
        const safeProjectId = encodeURIComponent(String(projectId));
        const safeUniqueIndex = encodeURIComponent(uniqueIndex);
        const safeCommentIndex = encodeURIComponent(String(commentIndex));
        return `<a target="_blank" rel="noopener noreferrer nofollow" href="${taskDetailConfig.urls.taskDetailPattern}${safeProjectId}/${safeUniqueIndex}${taskDetailConfig.urls.commentHashPrefix}${safeCommentIndex}">${escapeHtml(ticketNumber)}</a>`;
      },
      mention: (displayName: string, userId: number) => {
        const escapedDisplayName = escapeHtml(displayName);
        const escapedUserId = escapeHtml(userId);
        return `<span data-type="mention" class="mention" data-id="${escapedDisplayName}" data-label="name-${escapedUserId}" uniqueindex="" projectid="">${escapedDisplayName}</span>`;
      },
    },
  },

  localStorage: {
    mentionProjectId: "MENTION_PROJECT_ID",
  },

  searchParams: {
    commentId: "commentId",
    reply: "reply",
    audio: "audio",
    inboxFlow: "inboxFlow",
    hash: "hash",
  },

  commandModes: {
    delete: "DELETE",
    archive: "ARCHIVE",
    dueDate: "DueDate",
    assignees: "Assignees",
    openAiWriter: "OpenAiWriter",
    viewSubTasks: "ViewSubTasks",
    copyCommentLinkUrl: "CopyCommentLinkURL",
    copyCommentContent: "CopyCommentContent",
    createTaskFromComment: "CreateTaskFromComment",
    editComment: "EditComment",
    replyToComment: "ReplyToComment",
    reactToComment: "ReactToComment",
    addSubtask: "AddSubtask",
    moveTaskToInbox: "MoveTaskToInbox",
    starTask: "StarTask",
    starComment: "StarComment",
    copyFunctions: "CopyFunctions",
    archiveTaskNotification: "ArchiveTaskNotification",
    setReminder: "SetReminder",
    removeParent: "RemoveParent",
    removeSubtask: "RemoveSubtask",
    addRelation: "AddRelation",
    acceptTask: "AcceptTask",
    followTask: "FollowTask",
    unfollowTask: "UnfollowTask",
    speechToText: "SpeechToText",
    branchInNewChat: "BranchInNewChat",
    copyCommentToAiChat: "CopyCommentToAiChat",
    summarizeComment: "SummarizeComment",
    summarizeTicket: "SummarizeTicket",
    fastLikeComment: "FastLikeComment",
    toggleTimeTracking: "ToggleTimeTracking",
  },

  copyTypes: {
    id: "ID",
    titleAndId: "TitleAndID",
    private: "Private",
    privateFormatted: "PrivateFormatted",
    public: "Public",
    publicFormatted: "PublicFormatted",
  },

  focusTypes: {
    description: "Description",
    editComment: "Edit-Comment",
    newComment: "New-Comment",
    others: "Others",
  },

  modalKeys: {
    moveToColumn: "move-to-column-modal-for-task:",
    setPriority: "set-priority-modal-for-task:",
    setSize: "set-size-modal-for-task:",
    tags: "tags-modal-for-task:",
    dueDate: "due-date-modal-for-task:",
  },

  apiEndpoints: {
    moveTask: "/api/tasks/moveTask",
    moveTaskToInbox: "/api/notifications/moveTaskToInbox",
    unfollowTask: "/api/follower/unFollowTask",
  },

  toastMessages: {
    undoNotificationArchive: "Undo notification archive",
    taskDeleted: "Task deleted",
    errorDeletingTask: "Error deleting task",
    taskMovedToInbox: "Task moved to inbox",
    commentLinkCopied: "Link to this comment copied to clipboard!",
    commentContentCopied: "Comment content copied to clipboard!",
    errorCopyCommentContent: "Failed to copy comment content",
  },

  deleteModal: {
    confirmationMessage: "Clicking confirm will delete this task! Task can be recovered within 30 days.",
  },

  navigation: {
    back: "Back",
    refresh: "Refresh",
    scheduled: "Scheduled",
    drafts: "Drafts",
    pinned: "Pinned",
    starred: "Starred",
    allTasks: "All Tasks",
    unauthorized: "/unauthorized",
  },

  positions: {
    top: "top",
    forceNavigate: "forceNavigate",
  },

  audioButtons: {
    suffix: "audio-button",
    improveSuffix: "-improve",
    createComment: "create-comment",
    readEditDescription: "read-edit-description",
    popoverWrapperPrefix: "popover-wrapper-",
  },
} as const;

export const taskDetailSpacing = {
  mobile: {
    commentAndDescriptionContainer: "py-2 px-[10px]",
    taskInfoContainer:"py-2 px-[10px]",
    descriptionContainer:"xs:py-2 xs:px-[10px]",
  },
};

export default taskDetailConfig;
