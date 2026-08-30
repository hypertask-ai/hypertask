import type { JSONContent } from "@tiptap/react";
import type {
  DraftType,
  EmptySections,
  LogType,
  NotificationType,
  ReminderConditions,
  SortingMode,
  SortingOrder,
  Status,
  SubscriptionPlan,
  SubtaskSetting,
  TaskRelation,
  TaskShareType,
  View_Last_Used,
  ViewVisibility,
} from "@prisma/client";
import {
  ITaskArchiveActivity,
  ITaskAssignedActivity,
  ITaskDueDateActivity,
  ITaskEstimateActivity,
  ITaskLabelActivity,
  ITaskMoveActivity,
  ITaskPriorityActivity,
  ITaskUpdateDescriptionActivity,
  ITaskWaitingOnActivity,
} from "./ActivityModels.ts";
import { IFilter, IFilterSettings } from "@/models/Filters/model.js";
import { TModelProvider } from "@/lib/constants/constants.js";
import type { TByokProviderKey } from "@/lib/aiProviders";
import type { StorePlanKind } from "@/lib/planFromStripePriceId";

/** Matches Prisma enum `ChatRole`. */
export type IChatRole = "human" | "assistant";

/** Mirrors Prisma `ChatSession`. */
export interface IChatSession {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  userId: number;
  user: IUser;
  taskId: number | null;
  projectId?: number | null;
  title: string;
  messages: IChatMessage[];
}

/** Mirrors Prisma `ChatMessage`. */
export interface IChatMessage {
  id: string;
  createdAt: Date;
  content: string;
  role: IChatRole;
  sessionId: string;
  session?: IChatSession;
  isDelivered: boolean;
  attachments?: IAttachment[];
  /** SSE `event: status` steps shown as stacked tool-call rows above the reply */
  statusSteps?: string[];
}

export type RedirectMode =
  | "create-comment"
  | "read-edit-comments"
  | "read-edit-description"
  | "create-task-modal";
export interface NavigateToNextTaskParams {
  archiveNotification?: boolean;
  shouldNavigate?: boolean;
  remindMe?: boolean;
  force?: "forceNavigate";
  inboxFlow?: string | null;
  markAsDone?: boolean;
  taskStatus?: IStatus;
}
export interface RedirectAPIParams {
  content: string;
  id: string;
  text: string;
  navigateToNext: boolean;
  mode: RedirectMode;
  attachments_?: File[] | [];
  inbox?: boolean;
  inboxFlow?: string | null;
  markAsDone?: boolean;
  taskStatus?: IStatus;
}

export type IStatus = "Normal" | "Archive" | "Deleted";

export type ActiveModals = ["assignees", "linksModal" | undefined];
export interface IUser {
  stripe_customer_id: string;
  joinedAt: Date;
  photoURL?: string;
  displayName?: string;
  email?: string;
  uid: string;
  UserSettingId: string;
  UserSetting: IUserSetting;
  id: number;
  assigned?: boolean;
  accountId?: string;
  type?: "boardMember" | "teamMember";
  role?: "Admin" | "Member";
  user_notification_invites?: IUser_Notification_Invites[];
  tasksSharing?: ITaskShare[];
  savedContent?: ISavedContent[];
}

export interface IFollowers {
  id: string;
  mentionById: number;
  taskId: number;
  task: ITask;
  userId: number;
  mentionAt: any;
  user: IUser;
}

export interface IUserPicture {
  id: string;
  userId: number;
  user: IUser;
  photoSet: boolean;
  basePhotoURL?: string;
  nameSet: boolean;
  displayName?: string;
}

export interface IUserSetting {
  id: string;
  userId: number;
  user: IUser;
  notification: boolean;
  shareReadReceipts?: boolean;
  favorites: IFavorites[];
  onboardingTourStatus: boolean;
  onboardingTutorialStatus: boolean;
  trialStatus: boolean;
  isVerified?: boolean;
  calendarViews?: import("./Calendar/model").CalendarViewsPreference | null;
}
export interface Follower {
  photoURL?: string;
  displayName?: string;
  email?: string;
  uid: string;
  id: number;
  assigned?: boolean;
  user?: IUser;
  userId: number;
  taskId: number;
}

export type TPostFollowerBody = {
  userId: number;
  currentTaskId: number;
};

export type TAgentMention = {
  agentId: string;
  taskId: number;
};

export type TAgentMentionId = string;

export type THyperMention =
  | {
      userId: number;
      currentTaskId?: number;
      modelLabel?: string;
      modelOptionId?: string;
      modelSource?: string;
    }
  | undefined;

export type TImageMention =
  | {
      userId: number;
      currentTaskId?: number;
      modelKey: string;
    }
  | undefined;

export interface modifiedHtml {
  html: string;
  urls?: IUrl[];
  relations?: any;
  PostFollowerBody: TPostFollowerBody[];
  agentMentions?: TAgentMentionId[];
  hyperMention?: THyperMention;
  imageMention?: TImageMention;
}
export interface HtmlModificationResult {
  modifiedHtml: string;
}
export interface IUrl {
  id?: number;
  title?: string;
  urlString: string;
  commentId?: number;
  TaskId: number;
  Attachment?: boolean;
  attachmentType?: string;
  /** Real byte size of the uploaded file. Undefined when the caller never measured it. */
  fileSize?: number;
  projectId?: number;
  ticketNumber?: string;
}

export interface ICreateTaskUrl {
  title?: string;
  urlString: string;
  Attachment?: boolean;
  attachmentType?: string;
  /** Real byte size of the uploaded file. Undefined when the caller never measured it. */
  fileSize?: number;
}
export interface TaskSections {
  prev?: TaskSections | null;
  value?: string;
  next?: TaskSections | null;
}

/** Public slice of `TeamByokApiKey` (no ciphertext). Included on team payloads when loaded. */
export interface ITeamByokApiKey {
  provider: TByokProviderKey;
  enabled: boolean;
  ciphertext?: string;
}

export interface ITeam {
  stripe_customer_id: string;
  id: string;
  activeSubscriptionPlanItemId?: string;
  activeSubscriptionPlanId?: string;
  compedUntil?: Date | string | null;
  title: string;
  description?: string;
  projects: IProject[];
  members: any[];
  totalSeats: number;
  subscriptionPlan?: SubscriptionPlan[];
  subscriptionPlanId?: string;
  invites?: any;
  googleAccount: IGoogleAccount;
  googleAccountId: string;
  team_activity: {
    hasCompletedTrial: boolean;
  };
  /** Present when team is loaded with BYOK metadata (e.g. projects getAll). */
  byokApiKeys?: ITeamByokApiKey[];
  /** HTPR-2572: signups on these domains auto-join the team. */
  allowedEmailDomains?: string[];
}

export interface IProject {
  googleAccount: IGoogleAccount;
  googleAccountId?: string;
  filters: IFilterSettings | null | string;
  teamId?: string;
  firstTask?: ITask | null;
  uniqueIdentifier?: string;
  section?: ISection[];

  name: string;
  title?: string;
  description?: string;
  ownerId: string;
  owner: IUser;
  id: number;
  createdAt: string;
  members: IMember[];
  section_title: string[];
  sections: ISection[];
  filteredSections: ISection[];
  team: ITeam;
  tasks?: ITask[] | null;
  priority?: IPriority;
  estimate?: IEstimate;
  status: string;
  sorting_mode: SortingMode;
  timeTrackingEnabled: boolean;
  showTimeTotals?: boolean;
  stalenessEnabled: boolean;
  staleWarnDays?: number | null;
  staleHotDays?: number | null;
  staleNudgeEnabled: boolean;
  autoArchiveAfterDays?: number | null;
  _count?: {
    section: number;
    tasks: number;
    // Sidebar agent indicator: count of agent members (agentId != null).
    members?: number;
  };
  project_view?: IProjectView;
  ai_custom_instructions?: IAiCustomInstructions[];
  tasksSharing?: ITaskShare[];
  savedContent?: ISavedContent[];
}

export interface IAiCustomInstructions {
  id: number;
  visibility: ViewVisibility;
  projectId: number;
  project?: IProject;
  customInstruction: string;
  source_selected?: string;
  model_selected?: string;
  lastUpdatedAt: Date;
  attachments: IAttachment[];
}
export interface IView {
  id: string;
  userId: number;
  owner: IUser;
  createdAt: Date;
  applied_in_project_view?: IProjectView;
  user_project_views: IUserProjectView[];
  visibility: ViewVisibility;
  title: string;
  slug?: string;
  project_view_id: string;
  project_view: IProjectView;
  board_sorting_mode: SortingMode;
  board_sorting_order: SortingOrder;
  board_sorting_stack?: { mode: SortingMode; order: SortingOrder }[] | null;
  board_filters?: object;
  board_columns_view?: object;
  board_subtask_setting?: SubtaskSetting;
  board_empty_sections?: EmptySections;
  board_staleness?: boolean | null;
  board_show_archived?: boolean | null;
  table_sort_column?: string | null;
  table_sort_direction?: string | null;
  board_layout?: "Board" | "Table" | null;
  ViewLastUsed: IView_Last_Used[];
}

export interface IView_Last_Used {
  id: string;
  createdAt: Date;
  lastUsedAt?: Date | null;
  userId: number;
  viewId: string;
  user: IUser;
  view: IView;
}

export interface IProjectView {
  id: string;
  createdAt: Date;
  projectId: number;
  project: IProject;
  allViews?: IView[];
  user_project_views: IUserProjectView[];
  default_view_order?: string[] | null;
  default_view_id?: string;
  default_view?: IView;
}

export interface IUserProjectView {
  id: string;
  createdAt: Date;
  userId: number;
  view_order?: string[] | null;
  appliedViewId?: string;
  appliedView?: IView;
  unsavedViewId?: string;
  unsavedView?: IView;
  project_view_id: string;
  project_view: IProjectView;
}

export interface IMember {
  id: number;
  projectId: number;
  project: IProject;
  userId: number;
  user: IUser;
  status: string;
  invitedAt: string;
  acceptedAt: string;
  role?: "Admin" | "Member";
  agentId?: string;
  agent?: IAgent;
}

export interface IAssignees {
  id: number;
  assignerId: number;
  assigner: IUser;
  userId: number;
  user: IUser;
  taskId: number;
  task: ITask;
  agentId?: string;
  agent?: IAgent;
  agentAssignerId?: string;
  agentAssigner?: IAgent;
}

export interface IAgentLastOAuthMcpClient {
  clientId: string;
  clientName: string | null;
  lastAuthorizedAt: string;
}

export interface IAgent {
  id: string;
  displayName: string;
  photoURL?: string | null;
  createdAt: string;
  revokedAt: string | null;
  userId: number;
  /** Invite modal: on board vs available to add */
  type?: "boardAgent" | "addableAgent";
  boards?: { id: number; name: string }[];
  lastPostedAt?: string | null;
  lastOAuthMcpClient?: IAgentLastOAuthMcpClient | null;
  permissions?: Record<string, unknown> | null;
  postsToImportant?: boolean;
  assigned?: boolean;
  // Client-only: the plaintext key a mint or rotate response just returned,
  // held in page state so it can be copied. No route ever sends it back, and
  // nothing stores it, so this is the one moment it can be read.
  mcpToken?: string | null;
  hasMcpToken?: boolean;
  mcpTokenExpiresAt?: string | null;
  mcpTokensRevokedAt?: string | null;
  runtimeType?: "EXTERNAL" | "NATIVE";
  prompt?: string | null;
  heartbeatAt?: string | null;
}

export interface IComment {
  id: string;
  text: string;
  summary?: string | null;
  createdAt: string;
  taskId: string;
  creatorId?: number;
  task?: ITask;
  creator?: IUser;
  agentId?: string;
  agent?: IAgent;
  seen?: number[];
  project?: IProject;
  attachments?: IAttachment[];
  reactions?: IReaction[];
  savedContent?: ISavedContent[];
  activity?:
    | ITaskMoveActivity
    | ITaskPriorityActivity
    | ITaskAssignedActivity
    | ITaskEstimateActivity
    | ITaskLabelActivity
    | ITaskArchiveActivity
    | ITaskDueDateActivity
    | ITaskUpdateDescriptionActivity
    | ITaskWaitingOnActivity;
}

export type TRemoveFromInboxMode = "Task" | "Notification" | "Remind";
export interface IReaction {
  id: string;
  unified: string;
  emoji: string;
  count: number;
  users: IUser[];
  names?: string[];
  user?: IUser;
}
export interface ITask {
  assignees?: IAssignees[];
  notifications?: INotification[];
  title: string;
  ticketNumber?: string;
  description?: string;
  description_: IDescription_;
  id: number;
  ranking?: string;
  section: string;
  uniqueIndex: number;
  index?: number;
  projectId: number;
  status?: Status;
  userId?: string;
  user?: IUser;
  project?: IProject;
  createdAt?: string;
  sectionChangedAt?: string;
  lastCommentAt?: string | null;
  staleNudgedAt?: string | null;
  waitingOnUserId?: number | null;
  waitingOnSetById?: number | null;
  waitingOnSetAt?: string | null;
  dueDate?: Date;
  startDate?: Date;
  recurrence?: string | null;
  deletedAt?: string;
  archivedAt?: string;
  sectionId?: number;
  descriptionJson?: JSONContent;
  commentCount?: number;
  taskLabels?: ITaskLabel[];
  estimate?: IEstimate;
  priority?: IPriority;
  updatedAt?: string;
  permanentlyDeleteAt: Date;
  drafts?: IDraft[];
  Task_Summary?: ITaskSummary[];
  totalComments?: number;
  _count?: {
    notifications: number;
    comments?: number;
    savedContent?: number;
    relatedFromTasks?: number;
    relatedToTasks?: number;
  };
  parentTaskId?: number;
  parentTask?: ITask;
  subTasks: ITask[];
  tasksSharing?: ITaskShare[];
  savedContent?: ISavedContent[];
  comments?: IComment[];
  relatedToTasks?: TaskRelations[];
  relatedFromTasks?: TaskRelations[];
  followers?: IFollowers[];
  updatedByUserIds?: number[];
  agentId?: string;
  agent?: IAgent;
}

export interface TaskRelations {
  id: number;
  createdAt: Date;
  sourceTaskId: number;
  sourceTask?: ITask;
  targetTaskId: number;
  targetTask?: ITask;
  relationType: TaskRelation;
}

export interface IDescription_ {
  id: string;
  content: string;
  creatorId: number;
  creator: IUser;

  attachments: IAttachment[];
  flaggedIncomplete: boolean;
  reactions: IReaction[];
  taskId: number;
  task: ITask;
  agentId?: string | null;
  agent?: IAgent;
}

export interface IReminder {
  id: number;

  userId: number;
  user?: IUser;

  taskId: number;
  task?: ITask;

  updatedAt: Date | null;
  remindAt: Date | null;
  invokeCondition: ReminderConditions;
  status: Status;

  projectId: number;
  project?: IProject;
}

export interface ITaskLabel {
  id: number;
  taskId: number;
  task?: ITask;
  labelId: string;
  label?: ILabel;
}
export interface ILabel {
  id: string;
  createdAt: Date;
  value: string;
  ai_prompt?: string | null;
  _count?: { task: number; archived?: number };
  check?: boolean;
  priority?: number;
  projectId: number;
  project?: IProject;
  task: ITaskLabel[];
}

export interface ISection {
  section_title: string;
  ranking?: string;
  id?: number;
  projectId?: number;
  autoAssignUserId?: number | null;
  autoAssignAgentId?: string | null;
  isDone?: boolean | null;
  visibility?: boolean;
  sectionId?: number;
  deleted?: boolean;
  items: ITask[];
}

export interface INotification {
  id: string;
  waitingOnSynthetic?: boolean;
  type: NotificationType;
  computedSplit?: string;
  activeNotificationTypes?: NotificationType[];
  /** Event types on this task that only an agent produced (no human authored them). */
  agentOnlyTypes?: NotificationType[];
  /** Event types on this task authored only by agents muted from Important. */
  mutedTypes?: string[];
  /** Set when a snooze returned this row; a returned snooze is always addressed to you. */
  returnedFromReminders?: boolean | null;
  /** Direct response to this user after they explicitly invoked an agent. */
  directReply?: boolean;
  /** Active event types backed by a direct response on this task. */
  directReplyTypes?: NotificationType[];
  /** When the display-swapped earning event (mention/comment) happened. */
  earnedAt?: string;
  comment?: IComment;
  commentId?: number;
  status: string;
  seen: boolean;
  userId: number;
  user: IUser;
  createdAt: string;
  assignId?: number;
  assignee?: IAssignees;
  project?: IProject;
  task: ITask;
  taskId: number;
  unreadCount?: number;
  projectId: number;
  reaction?: IReaction;
  fromUserId: number;
  fromUser: IUser;
  notification_invite?: INotification_Invite;
  agentId?: string | null;
  agent?: IAgent;
  fromAgentId?: string | null;
  fromAgent?: IAgent;
  recentActors?: { displayName: string; photoURL: string | null }[];
  staleNudgeDays?: number;
  /** AgentMessage only: the agent's free-text body, no related entity to derive it from. */
  message?: string | null;
}

export interface INotificationCount {
  all: number;
  unseen: number;
}

export interface ICommentBody {
  comment: IComment;
  commentText: any;
  textOnly: string;
  taskId: number;
  taskTitle: string;
  commentId: any;
  taskLink: string;
  creatorName: string;
  emailArray?: (string | undefined)[];
}

export interface CreateInviteInterface {
  emails: string[];
  userId: number;
  projectId: number;
  projectName: string;
  invitedBy: string;
}

export interface QueryParams {
  [key: string]: string;
}

export interface IFCMReqBody {
  devices: any[];
  to?: string;
  type: string;
  notificationTitle: string;
  notificationBody: string;
  payload: any;
  taskTitle: string;
  afterAppDomain: string;
}
export interface FCMDeviceInfo {
  id: string;
  firebaseId: string;
  sendNotifications: boolean;
  userId: number;
}

export interface CreateCheckoutParams {
  googleAccountId: string;
  returnUrl: string;
  priceId: string;
  stripe_customer_id: string;
  quantity: number;
  teamTitle: string;
  teamId: string;
  mode: "Trial" | "Normal";
  cancelUrl?: string;
  metadata?: any;
}

export interface IHasSubscriptionCheck {
  monthly: boolean;
  yearly: boolean;
  /** Tier from the active Stripe subscription line item. */
  activeStorePlan: StorePlanKind;
  /** Billing interval for that line item. */
  activeBillingInterval: "month" | "year" | null;
}

export interface IPricingSearchParams {
  googleAccountId: string;
  teamId: string;
  totalSeats: number;
  stripe_customer_id: string;
  teamTitle: string;
  hasCompletedTrial?: boolean;
}

export interface ISubscriptionPlan {
  id: string;
  object: string;
  active: boolean;
  aggregate_usage: null | string;
  amount: null | number;
  amount_decimal: null | string;
  billing_scheme: string;
  created: number;
  currency: string;
  interval: string;
  interval_count: number;
  livemode: boolean;
  metadata: Record<string, any>;
  nickname: null | string;
  product: string;
  tiers_mode: string;
  transform_usage: null | string;
  trial_period_days: null | number;
  usage_type: string;
}

export interface IGoogleAccount {
  id: string;
  userId: number;
  stripe_customer_id: string;
  // user User      @relation(fields: [userId], references: [id])
  subscriptionPlans: any[];
  teams: ITeam[];
  members: any[];
  projects: IProject[];
}

// tasks playlist model
export interface ITasksPlaylist {
  id?: number;
  uniqueIndex: number;
  projectId: number;
  notification?: INotification;
}

export interface ILog {
  id: number;
  log: string;
  type: LogType;
  createdAt: Date;
  LoggedById?: number | null;
  LoggedBy?: IUser | null;
  status: Status;
}

export interface ApiResponse<T> {
  status: number;
  json: T;
}

export interface CreateLogInput {
  log: string;
  type: LogType;
  LoggedById: number;
  status: Status;
}

export interface IAttachment {
  id: number;
  createdAt: Date | number;
  fileType: string;
  fileSource: string;
  fileName: string;
  fileSize?: string | null;
  commentId?: number;
  descriptionId?: string;
  comment?: IComment; // Assuming you have a Comment model
  taskId?: number;
  task?: ITask; // Assuming you have a Task model
  chatMessageId?: string;
  chatMessage?: IChatMessage;
  AI_Custom_Instructions_id?: number;
  AI_Custom_Instructions?: IAiCustomInstructions;
}

export type preSelectParamPricing =
  "Billing" | "Upgrade" | "Members" | "Settings" | "API Keys";

export interface IFavorites {
  id: string;
  userSettingId: string;
  project: IProject;
  projectId: number;
  index: number;
}

export interface IPriority {
  id: string;
  priority_index: number;
  Priority_Value: string;
  createdAt: Date;
  sectionId: number;
  projectId: number;
  taskId: number;
  addedByUserId: number;
  addedByUser?: IUser;
  addedByAgentId?: string | null;
  addedByAgent?: IAgent;
  task?: ITask;
  section?: ISection;
  project?: IProject;
}

export interface IEstimate {
  id: string;
  estimate_index: number;
  estimate_value: string;
  createdAt: Date;
  sectionId: number;
  projectId: number;
  taskId: number;
  updatedAt?: Date | null;
  addedByUserId: number;
  addedByUser?: IUser;
  addedByAgentId?: string | null;
  addedByAgent?: IAgent;
  task?: ITask;
  section?: ISection;
  project?: IProject;
}

export interface IDraft {
  type: DraftType;
  id: number;
  saved: boolean;
  content: string;

  userId: number;
  projectId: number;
  taskId: number;

  user?: IUser;
  project?: IProject;
  task?: ITask;
  updatedAt?: Date;
}

export interface IProjectsAll {
  /** Account that owns this global query payload. Reject it after account changes. */
  accountId?: number;
  /** Distinguishes an authenticated server bootstrap from local task hydration. */
  dataOrigin?: "network" | "indexeddb";
  /** Exact scoped request that produced this network payload. */
  networkRequestScopeKey?: string;
  networkRequestGeneration?: number;
  networkRequestId?: string;
  /** Whether the requested active board received its task payload. */
  activeBoardPayloadLoaded?: boolean;
  /** Whether fresh authorization published a usable local active board. */
  authorizedLocalBoardPublished?: boolean;
  updatedProjects: IProject[];
  notificationsCount: {
    all: number;
    unseen: number;
  };
}

export interface StackedType {
  [key: number]: boolean;
}

export interface ITips {
  key: string[];
  hint: string;
  startText?: string;
}

export interface INotification_Invite {
  id: number;
  inviteURL: string;
  notificationId: number;
  notification: Notification;
  inviteId: string;
  invite: any;
  createdAt: Date;
  userIdTo: number;
  userTo: IUser_Notification_Invites;
  userIdBy: number;
  userBy: IUser_Notification_Invites;
}

export interface IUser_Notification_Invites {
  id: number;
  userId: number;
  user: IUser;
  notificationInviteBy?: INotification_Invite;
  notificationInviteTo?: INotification_Invite;
}

export interface ITaskSummary {
  id: number;
  createdAt: Date;
  updatedAt?: Date;
  content: string;
  taskId: number;
  task: ITask; // Assuming you have an interface for the Task model
}

export type TDeviceTypes = "Windows" | "MacOS";
export interface IOnboardingScreen {
  onNextScreen: () => void;
}

export interface IUploadingDescription {
  id: "description";
  content: any;
  descriptionAttachments: any[];
  totalAttachments: number;
}

export interface DeleteTasks {
  id: number;
  section: string;
  sectionId: number;
  status: "Deleted" | "Archive";
}

export interface ITestimonial {
  name: string;
  role: string;
  content: string;
  avatar: string;
}

export type TCommentOptionType =
  "Edit" | "React" | "Reply" | "Copy" | "New" | "Delete" | "Star" | "Pin";

export interface ICommentOption {
  title: string;
  type: TCommentOptionType;
  key?: string[];
}

export type TTaskOptionType =
  | "Remind"
  | "CopyURL"
  | "CopyFormattedURL"
  | "CopyShareURL"
  | "CopyShareFormattedURL"
  | "CopyTaskID"
  | "CopyTaskTitleAndTicketNumber"
  | "Archive"
  | "Delete"
  | "RemoveNotification"
  | "ShareTask"
  | "MoveInbox"
  | "RemoveSubtask"
  | "RemoveParent"
  | "Star"
  | "Duplicate"
  | "Follow"
  | "Unfollow";

export interface ITaskOption {
  title: string;
  type: TTaskOptionType;
  key: string[];
}

export interface IViewType {
  view: IView;
  type: "Unsaved" | "Applied" | "Default";
}

export type TViewAPICall =
  "switch" | "rename" | "unsaved" | "update" | "reset" | "delete";
export interface IViewAPI {
  call: TViewAPICall;
  view?: IView;
}

export interface IRemindAll {
  display: string;
  type: ReminderConditions;
}

export type TShareTaskType = "Domain" | "Anyone";

export interface IShareTaskOption {
  display: string;
  type: TShareTaskType;
}

export interface ITaskShare {
  id: string;
  user?: IUser;
  userId: number;
  createdAt: Date;
  expiresAt?: Date;
  task?: ITask;
  taskId: number;
  projectId: number;
  project?: IProject;
  expired: boolean;
  shareType: TaskShareType;
}

export interface ISavedContent {
  id: string;
  userId: number;
  user?: IUser;
  createdAt: Date;
  updatedAt?: Date | null;
  deletedAt?: Date | null;
  task: ITask;
  taskId: number;
  comment?: IComment;
  commentId?: number;
  project?: IProject;
  projectId: number;
  type: ViewVisibility;
}

export type HTCContext = "Task" | "Kanban" | "Inbox" | "Others";

export interface IAllCommands {
  context: HTCContext;
  bulkSelectionCount?: number;
  task?: {
    taskId: number;
    projectId: number;
    sectionId: number | null;
  };
  appShellRailOn?: boolean;
  showArchivedOnBoard?: boolean;
  searchOptions?: {
    includeArchived: boolean;
  };
  projectOptions?: {
    stalenessEnabled: boolean;
    stalenessViewEnabled?: boolean;
    autoArchiveEnabled?: boolean;
  };
  taskOptions?: {
    isApple: boolean;
    isArchived: boolean;
    hasNotifications: boolean;
    isKanban: boolean;
    hasSubtasks: boolean;
    hasParent: boolean;
    isStarred: boolean;
    showHistory?: boolean;
    timeTrackingEnabled: boolean;
  };
  commentOptions?: {
    isApple: boolean;
    isCurrentUserCreator: boolean;
    isPinned: boolean;
    isStarred: boolean;
    creatorId?: number;
  };
}

export type TCarousalItems =
  | {
      attachments: IAttachment[];
      currentIndex: number;
    }
  | undefined;

export interface ITypedTask {
  highlight: any;
  taskId: number;
  commentId?: number;
  projectId: number;
  projectTitle: string;
  taskTitle: string;
  ticketNumber: string;
  status: string;
  updatedAt: string;
  uniqueIndex: number;
  commentText?: string;
  descriptionText?: string;
}

export type IgnoreItemType =
  | "peopleHeading"
  | "modelHeading"
  | "agentHeading"
  | "taskHeading"
  | "projectHeading"
  | "loading"
  | "no-results"
  | "error";

export interface BaseMentionItem {
  type: string;
  name: string;
  count?: number;
}

export interface TaskMentionItem extends BaseMentionItem {
  type: "task";
  project_id: number;
  id: number;
  index: number;
  ticketNumber: string;
  status?: string;
}

export interface ProjectMentionItem extends BaseMentionItem {
  type: "project";
  id: number;
  identifier: string;
  uniqueIdentifier?: string;
}

export interface NameMentionItem extends BaseMentionItem {
  type: "name";
  id: number;
}

export interface AgentMentionItem extends BaseMentionItem {
  type: "agent";
  id: string;
  photoURL?: string | null;
}

export interface HeadingMentionItem extends BaseMentionItem {
  type: IgnoreItemType;
  count?: number;
}

export type MentionItem =
  | TaskMentionItem
  | ProjectMentionItem
  | NameMentionItem
  | AgentMentionItem
  | HeadingMentionItem;
