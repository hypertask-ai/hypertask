/**
 * @fileoverview
 * Task Detail Page Configuration
 * Centralized constants for the task detail page component.
 * Used by TaskDetailComp.tsx and related task detail components.
 */

import { escapeHtml } from "@/utils/htmlEscape";

const taskDetailConfig = {
  // ==================== ELEMENT IDs ====================
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

  
  // ==================== MODAL IDs ====================
  modals: {
    active: ["assignees", "linksModal", "htc"] as const,
    assignees: "assignees",
    links: "linksModal",
    htc: "htc",
  },

  // ==================== CSS CLASS NAMES ====================
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

  // ==================== QUERY KEYS ====================
  queryKeys: {
    moveTaskModal: "moveTaskModal",
    priority: "priority",
    estimate: "estimate",
    taskLabels: "taskLabels",
    inbox: "inbox",
    projectsAll: "projectsAll",
  },

  // ==================== TIMEOUTS & DELAYS (in milliseconds) ====================
  delays: {
    doubleKeyPress: 500, // Delay for detecting double key presses (g, m+a)
    titleEditMode: 100, // Delay before setting title edit mode
    audioButtonClick: 200, // Delay before clicking audio button
    scrollToElement: 500, // Delay for scrolling to element
    focusCommentInput: 300, // Delay for focusing comment input
    defaultCommentFocus: 400, // Delay for default comment focus
    mobileFocusComment: 500, // Delay for mobile focus comment
  },

  // ==================== UI DIMENSIONS ====================
  dimensions: {
    desktopNavigation: {
      top: 40, // Top position for desktop navigation
    },
    backButton: {
      size: 40, // Width and height of back button
      borderRadius: 20, // Border radius of back button
    },
    tooltip: {
      leftOffset: 45, // Left offset for tooltip
      bottomOffset: 2, // Bottom offset for tooltip
    },
  },

  // ==================== HTTP STATUS CODES ====================
  httpStatus: {
    ok: 200,
  },

  // ==================== TASK STATUS ====================
  taskStatus: {
    deleted: "Deleted",
    move: "Move",
  },

  // ==================== EDIT MODES ====================
  editModes: {
    title: "title",
    description: "description",
    comment: "comment",
    descriptionAi: "description-ai",
    newCommentAi: "new-comment-ai",
    editCommentAi: "edit-comment-ai",
  },

  // ==================== SCROLL SETTINGS ====================
  scrollSettings: {
    none: "None",
    bottom: "Bottom",
  },

  // ==================== TASK ID CONSTANTS ====================
  taskIds: {
    newTask: -1, // ID for newly created tasks
  },

  // ==================== KEYBOARD SHORTCUTS ====================
  keyboard: {
    escape: "Escape",
    escapeCombination: ["ESC"] as const,
  },

  // ==================== URL PATTERNS ====================
  urls: {
    taskDetailPattern: "/detail/project-",
    commentHashPrefix: "#comment-",
    templates: {
      commentLink: (projectId: number, uniqueIndex: string, ticketNumber: string, commentIndex: number) => {
        // SECURITY: Keep staging's shared HTML escape helper and the PR hardening; link text and href path fragments are escaped/encoded before generating HTML.
        const safeProjectId = encodeURIComponent(String(projectId));
        const safeUniqueIndex = encodeURIComponent(uniqueIndex);
        const safeCommentIndex = encodeURIComponent(String(commentIndex));
        return `<a target="_blank" rel="noopener noreferrer nofollow" href="${taskDetailConfig.urls.taskDetailPattern}${safeProjectId}/${safeUniqueIndex}${taskDetailConfig.urls.commentHashPrefix}${safeCommentIndex}">${escapeHtml(ticketNumber)}</a>`;
      },
      mention: (displayName: string, userId: number) => {
        // SECURITY: Display names are user-controlled; escape both rendered text and mention attributes before injecting HTML spans.
        const escapedDisplayName = escapeHtml(displayName);
        const escapedUserId = escapeHtml(userId);
        return `<span data-type="mention" class="mention" data-id="${escapedDisplayName}" data-label="name-${escapedUserId}" uniqueindex="" projectid="">${escapedDisplayName}</span>`;
      },
    },
  },

  // ==================== LOCAL STORAGE KEYS ====================
  localStorage: {
    mentionProjectId: "MENTION_PROJECT_ID",
  },

  // ==================== SEARCH PARAMS ====================
  searchParams: {
    commentId: "commentId",
    reply: "reply",
    audio: "audio",
    inboxFlow: "inboxFlow",
    hash: "hash",
  },

  // ==================== COMMAND MODES ====================
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

  // ==================== COPY FUNCTION TYPES ====================
  copyTypes: {
    id: "ID",
    titleAndId: "TitleAndID",
    private: "Private",
    privateFormatted: "PrivateFormatted",
    public: "Public",
    publicFormatted: "PublicFormatted",
  },

  // ==================== FOCUS TYPES ====================
  focusTypes: {
    description: "Description",
    editComment: "Edit-Comment",
    newComment: "New-Comment",
    others: "Others",
  },

  // ==================== MODAL KEYS ====================
  modalKeys: {
    moveToColumn: "move-to-column-modal-for-task:",
    setPriority: "set-priority-modal-for-task:",
    setSize: "set-size-modal-for-task:",
    tags: "tags-modal-for-task:",
    dueDate: "due-date-modal-for-task:",
  },

  // ==================== API ENDPOINTS ====================
  apiEndpoints: {
    moveTask: "/api/tasks/moveTask",
    moveTaskToInbox: "/api/notifications/moveTaskToInbox",
    unfollowTask: "/api/follower/unFollowTask",
  },

  // ==================== TOAST MESSAGES ====================
  toastMessages: {
    undoNotificationArchive: "Undo notification archive",
    taskDeleted: "Task deleted",
    errorDeletingTask: "Error deleting task",
    taskMovedToInbox: "Task moved to inbox",
    commentLinkCopied: "Link to this comment copied to clipboard!",
    commentContentCopied: "Comment content copied to clipboard!",
    errorCopyCommentContent: "Failed to copy comment content",
  },

  // ==================== DELETE MODAL CONTENT ====================
  deleteModal: {
    confirmationMessage: "Clicking confirm will delete this task! Task can be recovered within 30 days.",
  },

  // ==================== NAVIGATION ROUTES ====================
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

  // ==================== POSITION VALUES ====================
  positions: {
    top: "top",
    forceNavigate: "forceNavigate",
  },

  // ==================== AUDIO BUTTON SUFFIXES ====================
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
