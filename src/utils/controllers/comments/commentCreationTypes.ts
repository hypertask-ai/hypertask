import type { WebhookDelivery } from '@/lib/mcp/webhooks/events';
import type { AgentRunActivityPersistenceInput, AgentRunSelectionPersistenceInput } from '@/lib/agentRuns/persistence';

export interface CreateCommentParams {
  text: string;
  kind?: "question" | "qa" | "done";
  creatorId: number;
  taskId: number;
  ownerId: number;
  currentUser: {
    id: number;
    email?: string | null;
    displayName?: string | null;
    photoURL?: string | null;
  };
  agentId?: string | null;
  directReplyUserId?: number | null;
  directReplySourceCommentId?: number | null;
  directReplyInvocationId?: number | null;
  accessUserId?: number;
  processTaskReferences?: boolean;
  trustedCaller?: boolean;
  inboundEmailId?: string;
  agentRunActivity?: AgentRunActivityPersistenceInput;
  agentRunSelection?: AgentRunSelectionPersistenceInput;
  agentRunReplayComment?: {
    id: number;
    activityId: string;
    agentWebhookDeliveryIds: string[];
    boardWebhookDeliveryIds: string[];
    notificationsCompletedAt: Date | null;
  };
  extraBoardWebhookEvents?: WebhookDelivery[];
}

export interface CommentDependencies {
  prisma: typeof import("@/lib/prisma").default;
  idsToSendNotificationsTo: typeof import("@/utils/controllers/notifications/IdsToSendNotificationsTo").default;
  broadcastBoardChange: typeof import("@/lib/realtime/server").broadcastBoardChange;
  broadcastInboxChange: typeof import("@/lib/realtime/server").broadcastInboxChange;
  broadcastTaskComment: typeof import("@/lib/realtime/server").broadcastTaskComment;
  checkRemindersAndCreateNotifications: typeof import("@/utils/controllers/notifications/creation-service/check-reminder_create-notification").checkRemindersAndCreateNotifications;
  includeSenderInRecipients: typeof import("@/utils/controllers/notifications/agentActionRecipients").includeSenderInRecipients;
  shouldNotifyTaskOwnerForComment: typeof import("@/utils/controllers/notifications/agentActionRecipients").shouldNotifyTaskOwnerForComment;
  scheduleTaskSummaryGeneration: typeof import("@/pages/api/queues/FAST/generateSummary").default;
  upsertCommentToTurbopuffer: typeof import("@/utils/controllers/turbopuffer/turbopufferHelper").upsertCommentToTurbopuffer;
  getMentionedUserIdsFromCommentText: typeof import("@/utils/controllers/comments/processMentions").getMentionedUserIdsFromCommentText;
  processMentionsFromCommentText: typeof import("@/utils/controllers/comments/processMentions").processMentionsFromCommentText;
  extractTaskReferencesFromCommentText: typeof import("@/utils/controllers/comments/extractTaskReferences").extractTaskReferencesFromCommentText;
  addRelatedTasks: typeof import("@/utils/controllers/tasks/addRelatedTasks").addRelatedTasks;
  sendDataOnlyFcm: typeof import("@/utils/controllers/FCM").sendDataOnlyFcm;
  shouldNotify: typeof import("@/utils/controllers/notifications/shouldNotify").shouldNotify;
  sendEmailNotification: typeof import("@/utils/controllers/notifications/sendNotification").sendEmailNotification;
  scheduleCommentSummaryGeneration: typeof import("@/pages/api/queues/FAST/generateCommentSummary").default;
  taskWriteAccessWhere: typeof import("@/utils/controllers/projects/getAllIncludes").taskWriteAccessWhere;
  recordHyperAiCommentOrigin: typeof import("@/lib/ai/hyperAiConfirmation").recordHyperAiCommentOrigin;
  persistAgentRunTriggerWebhooks: typeof import("@/lib/agentWebhooks/outbox").persistAgentRunTriggerWebhooks;
  persistAgentTaskRunPromptWebhooks: typeof import("@/lib/agentWebhooks/outbox").persistAgentTaskRunPromptWebhooks;
  persistAgentWebhookEvent: typeof import("@/lib/agentWebhooks/outbox").persistAgentWebhookEvent;
  persistAgentWebhookEvents: typeof import("@/lib/agentWebhooks/outbox").persistAgentWebhookEvents;
  publishAgentWebhookDeliveries: typeof import("@/lib/agentWebhooks/outbox").publishAgentWebhookDeliveries;
  persistBoardWebhookEvents: typeof import("@/lib/mcp/webhooks/outbox").persistBoardWebhookEvents;
  publishBoardWebhookDeliveries: typeof import("@/lib/mcp/webhooks/outbox").publishBoardWebhookDeliveries;
  claimPendingAgentInvocation: typeof import("@/utils/controllers/comments/agentInvocationCorrelation").claimPendingAgentInvocation;
  claimInboundEmailProcessing: typeof import("@/utils/controllers/comments/inboundEmailReceipt").claimInboundEmailProcessing;
  completeInboundEmailProcessing: typeof import("@/utils/controllers/comments/inboundEmailReceipt").completeInboundEmailProcessing;
  findInboundEmailReceipt: typeof import("@/utils/controllers/comments/inboundEmailReceipt").findInboundEmailReceipt;
  recordInboundEmailComment: typeof import("@/utils/controllers/comments/inboundEmailReceipt").recordInboundEmailComment;
  releaseInboundEmailProcessing: typeof import("@/utils/controllers/comments/inboundEmailReceipt").releaseInboundEmailProcessing;
  requireInboundEmailComment: typeof import("@/utils/controllers/comments/inboundEmailReceipt").requireInboundEmailComment;
  persistAgentRunActivity: typeof import("@/lib/agentRuns/persistence").persistAgentRunActivity;
  persistAgentRunSelection: typeof import("@/lib/agentRuns/persistence").persistAgentRunSelection;
  AgentRunActivityInProgressError: typeof import("@/lib/agentRuns/model").AgentRunActivityInProgressError;
  serializeAgentRun: typeof import("@/lib/agentRuns/model").serializeAgentRun;
}
