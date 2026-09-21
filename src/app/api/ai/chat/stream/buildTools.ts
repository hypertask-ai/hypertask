import { AuthedUser, ToolExecutionRecorder, ToolStartRecorder, applyDurableCommentAttribution, applyEstimateUpdate, applyPriorityUpdate, assertAccessibleProject, buildActivityUser, buildTaskTreeNode, deriveChatAttachmentFilename, dropEmptyPadding, errorMessage, findDraftWithAccess, findRootTaskIdForTree, getAccessibleProjectIds, mapCommentToResponse, mapDraftToResponse, mapTaskSearchItem, mapTaskToDetail, mapTaskToMcpGetResponse, mapViewToResponse, normalizePriorityInput, resolveTaskForTool, sanitizeForJson, stripInlineDataUris, userHasProjectAccess, validateMentionUserIds, validateMentionUsers, withToolErrors } from "./toolSupport";
export { errorMessage } from "./toolSupport";
export type { AuthedUser, ResolveTaskForToolResult, ToolExecution } from "./toolSupport";
import { agentStore } from "@/utils/controllers/agents";
import { labelStore } from "@/utils/controllers/labels";
import { NextRequest } from "next/server";
import { CustomFieldType, DecisionRequestStatus, Prisma } from "@prisma/client";
import { tool } from "ai";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { linkifyTicketRefs } from "@/utils/controllers/comments/linkifyTicketRefs";
import { askFleetAgent } from "./fleetAsk";
import { isNotificationInHeartbeatWindow, type HeartbeatTurnMetadata } from "@/lib/nativeAgent/heartbeatTurnEnvelope";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_6516_AGENT_ATTRIBUTION_FLAG } from "@/lib/flags/keys";
import { searchHelpDocs } from "@/lib/help-docs/searchHelpDocs";
import { retrieveBoardKnowledge } from "@/lib/rag/retrieveBoardKnowledge";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { isLiveTaskListRequest, resolveLiveTaskListProjectId } from "./liveTaskList";
import { getProjectMembers } from "@/utils/controllers/projects/getProjectMembers";
import { createCustomField, getCustomFieldForProjectByName, getCustomFieldsForProject, upsertCustomFieldValue } from "@/utils/controllers/customFields";
import notificationGetAll, { notificationInboxInclude } from "@/utils/controllers/notifications/getAll";
import { getStructuredInboxForAgent } from "@/utils/controllers/notifications/getStructuredInboxForAgent";
import { turbopufferSearchTaskIds } from "@/utils/controllers/search/document";
import { mapVisibleMcpAgent, mcpVisibleAgentSelect } from "@/lib/mcp/agents";
import { resolvePublicAgentDisplayName } from "@/lib/agents/publicAgent";
import { listOwnedAgents } from "@/lib/mcp/agents/ownedAgents";
import { createAgentForUser } from "@/lib/mcp/agents/create";
import { revokeAgentForUser } from "@/lib/mcp/agents/revoke";
import { mintAccountMcpToken, revokeAccountMcpToken } from "@/lib/mcp/accountTokens";
import { listOwnedConnections } from "@/lib/mcp/connections";
import { manageAgentWebhook } from "@/lib/agentWebhooks/management";
import { mapTaskDescriptionContent, mcpTaskUserCommentCount, taskDetailInclude, taskMcpGetInclude } from "@/lib/mcp/tasks/mappers";
import { findTaskByIdentifier, validateTaskIdentifier } from "@/lib/mcp/tasks/resolveTask";
import { extractPrLinks } from "@/lib/mcp/tasks/extractPrLinks";
import { getMyTasksSummary, MY_TASKS_DEFAULT_LIMIT, MY_TASKS_MAX_LIMIT } from "@/lib/mcp/tasks/myTasksSummary";
import { priorityScore } from "@/lib/mcp/tasks/priorityScore";
import { blockerStillOpen } from "@/lib/mcp/tasks/blockerStillOpen";
import { normalizeTaskRelationType } from "@/lib/mcp/tasks/relationType";
import { handleRelatedTasksGet } from "@/lib/mcp/tasks/relatedTasks";
import { elapsedSeconds, listReport, listRunning, logMinutes, pauseTimer, resumeTimer, startTimer, stopTimer, taskSummary, TimeTrackingDisabledError } from "@/lib/timeTracking";
import { createTask, getSectionForTask, mutateTaskLabels, setTaskLabels, validateParentTask, validateProjectAccess, validateProjectMemberIds } from "@/lib/mcp/tasks/services";
import { createView, deleteView, updateView, applyView } from "@/lib/mcp/views/services";
import { SORTING_MODES } from "@/models/Views/model";
import { SUBTASK_SETTINGS } from "@/models/Views/model";
import { getViewUrl } from "@/utils/controllers/projects/views/viewsHelperAPIfunctions";
import { McpAttachmentFetchError, safeFetchAttachmentUrl } from "@/lib/mcp/attachments/safeFetch";
import { parseAndValidateAttachmentsBody } from "@/lib/mcp/attachments/validateBody";
import { bufferMatchesDeclaredMime } from "@/lib/mcp/attachments/magicBytes";
import { MCP_ATTACHMENT_MAX_FILES, normalizeMime } from "@/lib/mcp/attachments/constants";
import { uploadTaskAttachmentToS3 } from "@/lib/storage/uploadTaskAttachmentToS3";
import { validateBoardManifest } from "@/lib/mcp/boards/validateManifest";
import { createBoardFromManifest } from "@/lib/mcp/boards/createBoardFromManifest";
import { parseBoardPlaybook } from "@/lib/mcp/boards/playbook";
import { FREE_BOARD_LIMIT_MESSAGE, isBoardLimitReached } from "@/utils/controllers/projects/boardQuota";
import { columnRole, columnRoleFor } from "@/lib/mcp/boards/columnRole";
import { loadDoneTitlesByProject } from "@/utils/controllers/notifications/inboxZero";
import { updateTaskSingle } from "@/utils/controllers/tasks/single";
import { moveTaskToDifferentBoard } from "@/utils/controllers/tasks/moveToDifferentBoard";
import createArchiveActivity from "@/utils/controllers/activities/createArchiveActivity";
import { broadcastInboxChange, broadcastBoardChange, broadcastTaskChange, broadcastTaskComment } from "@/lib/realtime/server";
import createTaskDueDateActivity from "@/utils/controllers/activities/createTaskDueDateActivity";
import sendNotificationForTask from "@/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove";
import { ensureTaskMovedToInbox } from "@/lib/taskCardActions/inboxState";
import { cancelDueDateJob, scheduleDueDateJob } from "@/pages/api/queues/duedateQueue";
import generateRank from "@/utils/generateRank";
import { PriorityConstants } from "@/lib/constants/constants";
import { createCommentService } from "@/utils/controllers/comments/createCommentService";
import { convertPlainTextMentionsToHtml, resolveTextMentions } from "@/utils/controllers/comments/processMentions";
import { extractTipTapContent } from "@/utils/helperFunctions/multiPages/multipages.functions";
import { sanitizeBoardFilters } from "@/utils/helperFunctions/Views/BoardFilterSanitizer";
import { buildMcpImageUrls, persistUrlsForDescription, persistUrlsForComment } from "@/utils/controllers/urls/extractUrlsFromContent";
import assigneesAssign from "@/utils/controllers/assignees/assign";
import { createSection, updateSection, deleteSection } from "@/lib/mcp/sections/services";
import { updateCommentService } from "@/utils/controllers/comments/updateCommentService";
import { deleteCommentService } from "@/utils/controllers/comments/deleteCommentService";
import { buildMcpTaskUrl } from "@/lib/mcp/boards/links";
import { getPageUrl, parsePageIdentifier } from "@/app/api/mcp/pages/_lib/routeUtils";
import { htmlToMarkdown } from "@/utils/controllers/pages/htmlToMarkdown";
import upsertTaskDescription from "@/utils/controllers/description/common-description-create";
import { toStoredHtml } from "@/utils/helperFunctions/toStoredHtml";
import { archivePage, createPage, getPage, listPageVersions, listPages, PageConflictError, restorePageVersion, searchPages, updatePage } from "@/utils/controllers/pages/pageService";
import { createReport, deleteReport, getReport, getReportUrl, listReports, REPORT_BODY_MAX, REPORT_CAPABILITIES, REPORT_SLUG_RE, ReportValidationError, updateReport } from "@/utils/controllers/reports/reportService";
import { updateOwnProfile } from "@/utils/controllers/users/updateOwnProfile";
import { getUpdateProfileInputSchema } from "@/lib/mcp-server/validations/user.validation";
import getMemberAndOwner from "@/utils/controllers/getMemberAndOwnerForBoard";
import { getAiModelOptionById } from "@/lib/aiModelOptions";
import { addAgentToBoard, getAccessibleAgentBoard, getBoardAgentMembers, isAgentOnBoard } from "@/utils/controllers/agents/boardMembers";
import { addMemberController } from "@/pages/api/invite/createInviteLink";
import { getTeamAgentPresence } from "@/lib/mcp/agents/presence";
import { sanitizeRichHtml } from "@/utils/helperFunctions/sanitizeRichHtml";
import { withActivityMetadata } from "@/lib/mcp/comments/activityMetadata";
import { requireCrossMessageConfirmation } from "@/lib/ai/bulkConfirmation";
import { escapeHtml } from "@/utils/helperFunctions/escapeHtml";
import { assertProjectAccess } from "@/app/api/ai/_lib/customInstructions";
import { assertSkillScopeAccess, getAccessibleSkill } from "@/app/api/ai/_lib/skillAccess";
import { MAX_SKILL_BODY_BYTES, parseSkillMarkdown, slugifySkill } from "@/app/api/ai/_lib/skillMarkdown";
import { importSkillsFromGitHub } from "@/app/api/ai/_lib/skillImport";
import { buildCollectionMetadata, buildBulkOperationKey, buildLimitedScanMetadata, buildSearchTotalMetadata, resolveBulkTaskTargets, updateTasksNeedConfirmation, resolveUserIds, type ToolTaskIdentifierInput } from "./bulkTools";

export type SseEvent = "status" | "content" | "title" | "done" | "error" | "agent";

export const PROJECT_ADMIN_MEMBER_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MAX_BULK_TOOL_TARGETS = 50;

export const TOOL_TASK_ID_DESCRIPTION =
  "internal database id -- do NOT derive it from the ticket number; pass ticket_number instead if you only know e.g. ABC-123";

export const bulkTaskTargetCount = (input: {
  task_ids?: number[];
  ticket_numbers?: string[];
}) => (input.task_ids?.length ?? 0) + (input.ticket_numbers?.length ?? 0);

export const bulkUserTargetCount = (input: {
  user_ids?: number[];
  users?: (number | string)[];
}) => (input.user_ids?.length ?? 0) + (input.users?.length ?? 0);

export const createTaskItemSchema = z.object({
  project_id: z.coerce.number().int().positive(),
  title: z.string().min(1).max(500),
  description: z.string().max(20000).optional(),
  section: z
    .union([z.coerce.number().int().positive(), z.string().min(1)])
    .optional(),
  priority: z
    .enum(["No Priority", "Urgent", "High", "Medium", "Low"])
    .optional(),
  due_date: z.string().optional(),
  labels: z.array(z.string()).optional(),
  assignee_ids: z.array(z.coerce.number().int().positive()).optional(),
  parent_task_id: z.coerce.number().int().positive().nullable().optional(),
});

export const COMMENT_TASK_LINK_RULE =
  'Before adding, drafting, updating, or publishing a comment, validate its final text before the write: every task reference already resolved by a task tool must be an anchor whose href copies that result\'s relative "url" field exactly. Use the task title as the link text when available, and the ticket number only when no title is available. Never leave a resolved ticket number as plain text, and never rebuild its URL. This applies on task detail, Inbox, and every other task-related surface.';

export const statusSchema = z.enum(["Normal", "Archive", "Deleted"]);

export const sortOrderSchema = z.enum(["asc", "desc"]);

export const viewSortingStackSchema = z
  .array(
    z
      .object({
        mode: z.enum(SORTING_MODES).exclude(["Manual"]),
        order: z.enum(["Ascending", "Descending"]),
      })
      .strict()
  )
  .max(2);

export const attachmentSchema = z.object({
  fileName: z.string().optional(),
  url: z.string().optional(),
  mimeType: z.string().nullable().optional(),
});

export const byokProviderFlagSchema = z
  .object({
    provider: z.string().optional().nullable(),
    enabled: z.boolean().optional(),
    ciphertext: z.string().nullable().optional(),
  })
  .passthrough();

export const defaultContextSchema = z
  .object({
    project_id: z.coerce.number().int().positive().optional(),
    task_id: z.coerce.number().int().positive().optional(),
    view_id: z.string().optional().nullable(),
    view_name: z.string().optional().nullable(),
    // Which screen the user is on. Board surfaces carry a project_id; My Tasks,
    // the inbox and the calendar span every board and carry none.
    surface: z.string().optional().nullable(),
    surface_path: z.string().optional().nullable(),
  })
  .passthrough();

export const chatRequestSchema = z.object({
  message: z.string().min(1),
  session_id: z.string().uuid().optional(),
  user_message_id: z.string().uuid().optional(),
  assistant_message_id: z.string().uuid().optional(),
  stream_id: z.string().uuid().optional(),
  heartbeat_execution_id: z.string().uuid().optional(),
  modelOptionId: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  provider: z.string().optional().nullable(),
  aiFeature: z.enum(["aiChat", "askAi"]).optional().default("aiChat"),
  teamId: z.string().optional().nullable(),
  context_list: z.array(z.unknown()).nullable().optional(),
  default_context: defaultContextSchema.nullable().optional(),
  user_context: z.record(z.string(), z.unknown()).nullable().optional(),
  chat_history: z
    .array(
      z
        .object({
          content: z.string().optional().default(""),
          role: z.string().optional().default("human"),
        })
        .passthrough()
    )
    .nullable()
    .optional(),
  images64: z.array(attachmentSchema).nullable().optional(),
  pdfs64: z.array(attachmentSchema).nullable().optional(),
  docx64: z.array(attachmentSchema).nullable().optional(),
  attachments: z.array(attachmentSchema).nullable().optional(),
  byokProviderFlags: z.array(byokProviderFlagSchema).nullable().optional(),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export type SendSse = (event: SseEvent, data: Record<string, unknown>) => void;

export const toolStatus: Record<string, string> = {
  hypertask_agent_webhook: "Managing the agent webhook...",
  hypertask_get_user_context: "Loading your Hypertask context...",
  hypertask_ask_agent: "Asking the board agent...",
  hypertask_list_projects: "Checking your projects...",
  hypertask_list_project_members: "Checking project members...",
  hypertask_list_custom_fields: "Loading custom fields...",
  hypertask_set_custom_field_value: "Setting custom field value...",
  hypertask_list_tasks: "Checking tasks...",
  hypertask_get_tasks: "Loading task details...",
  hypertask_search_tasks: "Searching tasks...",
  hypertask_get_comments_for_task: "Loading task comments...",
  hypertask_inbox_list: "Checking your inbox...",
  hypertask_move_task_to_inbox: "Moving task to inbox...",
  hypertask_section: "Managing project sections...",
  hypertask_board_manifest: "Loading board manifest...",
  hypertask_get_board_playbook: "Loading board playbook...",
  hypertask_board_config: "Managing board AI configuration...",
  hypertask_project_admin: "Managing board administration...",
  hypertask_create_task: "Creating task...",
  hypertask_update_task: "Updating task...",
  hypertask_task_context: "Loading task context...",
  hypertask_task_description_history: "Managing task description history...",
  hypertask_page_history: "Managing page history...",
  hypertask_next_tasks: "Finding next tasks...",
  hypertask_link_tasks: "Linking tasks...",
  hypertask_find_related_tasks: "Finding related tasks...",
  hypertask_add_comment: "Adding comment...",
  hypertask_decision_request: "Creating decision request...",
  hypertask_update_comment: "Updating comment...",
  hypertask_delete_comment: "Deleting comment...",
  hypertask_assign_user: "Assigning user...",
  hypertask_unassign_user: "Unassigning user...",
  hypertask_move_task_between_boards: "Moving task between boards...",
  hypertask_inbox_archive: "Archiving inbox notifications...",
  hypertask_inbox_unarchive: "Unarchiving inbox notifications...",
  hypertask_attach_files: "Attaching files...",
  hypertask_list_labels: "Loading project labels...",
  hypertask_create_label: "Creating label...",
  hypertask_create_board: "Creating board...",
  hypertask_draft: "Managing drafts...",
  hypertask_get_task_tree: "Loading task tree...",
  hypertask_list_views: "Loading views...",
  hypertask_get_view: "Loading view...",
  hypertask_create_view: "Creating view...",
  hypertask_update_view: "Updating view...",
  hypertask_switch_view: "Switching view...",
  hypertask_delete_view: "Deleting view...",
  hypertask_start_timer: "Starting timer...",
  hypertask_stop_timer: "Stopping timer...",
  hypertask_pause_timer: "Pausing timer...",
  hypertask_resume_timer: "Resuming timer...",
  hypertask_time_status: "Checking time status...",
  hypertask_time_report: "Reading time entries...",
  hypertask_running_timers: "Checking running timers...",
  hypertask_log_time: "Logging time...",
  hypertask_agent_presence: "Checking agent presence...",
  hypertask_list_agents: "Listing managed agents...",
  hypertask_create_agent: "Creating an agent identity...",
  hypertask_revoke_agent: "Revoking an agent identity...",
  hypertask_mint_token: "Minting an MCP token...",
  hypertask_revoke_token: "Revoking MCP tokens...",
  hypertask_list_connections: "Listing OAuth connections...",
  hypertask_create_skill: "Creating skill...",
  hypertask_get_skill: "Loading skill...",
  hypertask_list_skills: "Loading skills...",
  hypertask_update_skill: "Updating skill...",
  hypertask_delete_skill: "Deleting skill...",
  hypertask_import_skills: "Importing skills...",
  hypertask_list_reports: "Reading reports...",
  hypertask_get_report: "Reading report...",
  hypertask_create_report: "Writing report...",
  hypertask_update_report: "Updating report...",
  hypertask_delete_report: "Deleting report...",
  hypertask_update_profile: "Updating your profile...",
  rag_retrieval: "Searching Hypertask knowledge...",
  web_search: "Searching the web...",
  search_help_docs: "Searching the help center...",
};

export const commentInclude = (userId: number, projectId: number) => ({
  creator: {
    select: {
      id: true,
      email: true,
      displayName: true,
    },
  },
  agent: {
    select: mcpVisibleAgentSelect(userId, projectId),
  },
  attachments: {
    select: {
      id: true,
      fileName: true,
      fileType: true,
      fileSize: true,
      fileSource: true,
    },
  },
  reactions: {
    where: {
      isDeleted: false,
    },
    select: {
      id: true,
      emoji: true,
      userId: true,
    },
  },
}) satisfies Prisma.CommentInclude;

export function createChatToolContext(
  user: AuthedUser,
  body: ChatRequest,
  send: SendSse,
  recordToolExecution: ToolExecutionRecorder,
  actingAgentId: string | null = null,
  recordToolStart?: ToolStartRecorder,
  heartbeatTurn?: HeartbeatTurnMetadata
) {
  const requestingUserId = user.id;
  const sendStatus = (toolName: string) => {
    const content = toolStatus[toolName];
    if (content) send("status", { content });
  };

  // HTPR-4218: a wide or destructive write must be shown to the user before it
  // runs. Keys of previews issued during THIS request, so the model cannot
  // preview and then confirm itself in the same turn -- confirmation has to
  // come back from the user in a new message.
  const bulkPreviewsIssued = new Set<string>();
  const confirmationSessionId = body.session_id ?? "no-session";
  const invokeAgentManagementHandler = async (
    operation: "create" | "revoke",
    input: Record<string, unknown>
  ) => {
    const request = new NextRequest(
      "http://localhost/api/mcp/admin/agents",
      {
        method: operation === "create" ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }
    );
    const response =
      operation === "create"
        ? await createAgentForUser(request, user)
        : await revokeAgentForUser(request, user);
    return sanitizeForJson(await response.json());
  };

  const requireAccountManagementConfirmation = async (
    operation: string,
    input: Record<string, unknown>,
    confirmed: boolean | undefined,
    message: string
  ) => {
    const outcome = await requireCrossMessageConfirmation({
      userId: user.id,
      sessionId: confirmationSessionId,
      operationKey: `account-management:${operation}:${JSON.stringify(input)}`,
      confirmed,
      previewsIssuedThisRequest: bulkPreviewsIssued,
    });
    return outcome === "preview"
      ? sanitizeForJson({
          success: false,
          confirmation_required: true,
          message:
            `${message} Nothing has been changed yet. ` +
            "End your turn now and ask the user to confirm. Only after they say yes in a new message, repeat this exact tool call with confirmed=true.",
        })
      : null;
  };

  const mutateTaskAssignees = async (
    input: ToolTaskIdentifierInput & {
      task_ids?: number[];
      ticket_numbers?: string[];
      user_ids?: number[];
      users?: (number | string)[];
      confirmed?: boolean;
    },
    intent: "assign" | "unassign"
  ) => {
    const targets = resolveBulkTaskTargets(input);
    if (!(input.user_ids?.length || input.users?.length)) {
      return {
        success: false,
        changed: 0,
        tasks: [],
        failures: [{ error: "Provide at least one person or agent in users or user_ids" }],
      };
    }

    const resolvedTargets = await Promise.all(
      targets.map(async (identifier) => ({
        identifier,
        resolution: await resolveTaskForTool(user, identifier),
      }))
    );
    const seenTaskIds = new Set<number>();
    const operationTargets = resolvedTargets.filter(({ resolution }) => {
      const taskId = resolution.task?.id;
      if (!taskId) return true;
      if (seenTaskIds.has(taskId)) return false;
      seenTaskIds.add(taskId);
      return true;
    });
    const projectMembers = new Map<
      number,
      ReturnType<typeof getProjectMembers>
    >();
    const getMembers = (projectId: number) => {
      const existing = projectMembers.get(projectId);
      if (existing) return existing;
      const pending = getProjectMembers(projectId, undefined, requestingUserId);
      projectMembers.set(projectId, pending);
      return pending;
    };

    if (targets.length >= 4) {
      const assigneeChanges = new Set<string>();
      const assigneeReferences = [
        ...(input.user_ids ?? []),
        ...(input.users ?? []),
      ];
      const projectIds = new Set(
        operationTargets.flatMap(({ resolution }) =>
          resolution.task ? [resolution.task.projectId] : []
        )
      );
      for (const projectId of projectIds) {
        const memberResult = await getMembers(projectId);
        if (memberResult.error) {
          for (const reference of assigneeReferences) {
            assigneeChanges.add(
              `unresolved-assignee:${projectId}:${JSON.stringify(reference)}`
            );
          }
          continue;
        }
        const userResolution = resolveUserIds(input, user.id, memberResult.members);
        for (const userId of userResolution.userIds) {
          assigneeChanges.add(`user:${userId}`);
        }
        for (const agentId of userResolution.agentIds) {
          assigneeChanges.add(`agent:${agentId}`);
        }
        for (const failure of userResolution.failures) {
          const reference =
            typeof failure.user === "string"
              ? failure.user.trim().toLowerCase()
              : failure.user;
          assigneeChanges.add(
            `unresolved-assignee:${projectId}:${JSON.stringify(reference)}`
          );
        }
      }
      if (projectIds.size === 0) {
        for (const reference of assigneeReferences) {
          const normalized =
            typeof reference === "string"
              ? reference.trim().toLowerCase()
              : reference;
          assigneeChanges.add(
            `unresolved-assignee:${JSON.stringify(normalized)}`
          );
        }
      }
      const operationKey = buildBulkOperationKey(
        `task-assignees:${intent}`,
        operationTargets.map(({ identifier, resolution }) => ({
          identifier,
          resolvedTaskId: resolution.task?.id ?? null,
        })),
        [...assigneeChanges]
      );
      if (
        await requireCrossMessageConfirmation({
          userId: user.id,
          sessionId: confirmationSessionId,
          operationKey,
          confirmed: input.confirmed,
          previewsIssuedThisRequest: bulkPreviewsIssued,
        }) === "preview"
      ) {
        const affected = await Promise.all(
          resolvedTargets.map(async ({ identifier, resolution }) => {
            if (!resolution.task) {
              return { ...identifier, error: resolution.error ?? "Not found" };
            }
            const details = await prisma.task.findUnique({
              where: { id: resolution.task.id },
              select: { id: true, title: true, projectId: true, uniqueIndex: true },
            });
            return details
              ? {
                  task_id: details.id,
                  title: details.title,
                  url: buildMcpTaskUrl(details.projectId, details.uniqueIndex),
                }
              : { ...identifier, error: "Not found" };
          })
        );
        return sanitizeForJson({
          success: false,
          confirmation_required: true,
          affected,
          message:
            `This would ${intent} assignees ${intent === "assign" ? "to" : "from"} ${targets.length} tasks. Nothing has been changed yet. ` +
            "End your turn now: list the affected tasks for the user and ask them to confirm. Only after they say yes, in a new message, call this tool again with confirmed: true.",
        });
      }
    }

    const userObj = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, email: true, displayName: true, photoURL: true },
    });
    if (!userObj) {
      return {
        success: false,
        changed: 0,
        tasks: [],
        failures: [{ error: "User not found" }],
      };
    }
    const activityUser = buildActivityUser(userObj);

    const mutateOneTask = async ({
      identifier,
      resolution: taskResult,
    }: (typeof operationTargets)[number]) => {
      if (taskResult.error || !taskResult.task) {
        return {
          success: false,
          error: taskResult.error ?? "Task not found or access denied",
        };
      }
      const task = await prisma.task.findUnique({
        where: { id: taskResult.task.id },
        select: { id: true, title: true, projectId: true, uniqueIndex: true },
      });
      if (!task) return { success: false, error: "Task not found" };

      const memberResult = await getMembers(task.projectId);
      if (memberResult.error) {
        return { success: false, error: memberResult.error.message };
      }
      const userResolution = resolveUserIds(
        input,
        user.id,
        memberResult.members
      );
      const taskFailures: {
        task_id: number;
        title: string;
        url: string;
        user?: number | string;
        agent?: string;
        error: string;
      }[] = userResolution.failures.map((failure) => ({
        task_id: task.id,
        title: task.title,
        url: buildMcpTaskUrl(task.projectId, task.uniqueIndex),
        ...failure,
      }));
      const currentAssignees = await prisma.assignees.findMany({
        where: { taskId: task.id },
        select: { userId: true, agentId: true },
      });
      const assignedUserIds = new Set(
        currentAssignees
          .filter((row) => row.agentId === null)
          .map((row) => row.userId)
      );
      const assignedAgentIds = new Set(
        currentAssignees
          .map((row) => row.agentId)
          .filter((agentId): agentId is string => agentId !== null)
      );
      const changedUserIds: number[] = [];
      const changedAgentIds: string[] = [];

      for (const userId of userResolution.userIds) {
        const wasAssigned = assignedUserIds.has(userId);
        let response: Awaited<ReturnType<typeof assigneesAssign>>;
        try {
          response = await assigneesAssign(
            activityUser,
            userId,
            task.id,
            undefined,
            actingAgentId ?? undefined,
            { intent }
          );
        } catch (error) {
          taskFailures.push({
            task_id: task.id,
            title: task.title,
            url: buildMcpTaskUrl(task.projectId, task.uniqueIndex),
            user: userId,
            error: errorMessage(error),
          });
          continue;
        }
        if (response.status !== 200) {
          taskFailures.push({
            task_id: task.id,
            title: task.title,
            url: buildMcpTaskUrl(task.projectId, task.uniqueIndex),
            user: userId,
            error:
              (response.json as { message?: string }).message ??
              `${intent === "assign" ? "Assign" : "Unassign"} failed`,
          });
          continue;
        }

        const responseRows = (
          response.json as { body?: { userId: number; agentId: string | null }[] }
        ).body;
        const nowAssigned = Array.isArray(responseRows)
          ? responseRows.some(
              (row) => row.userId === userId && row.agentId === null
            )
          : intent === "assign";
        if (
          (intent === "assign" && !wasAssigned && nowAssigned) ||
          (intent === "unassign" && wasAssigned && !nowAssigned)
        ) {
          changedUserIds.push(userId);
        }
        if (nowAssigned) assignedUserIds.add(userId);
        else assignedUserIds.delete(userId);
      }

      for (const agentId of userResolution.agentIds) {
        // Same rule the REST route enforces: you may only assign an agent you
        // own, not any agent that happens to share the board.
        const ownedAgent = await prisma.agent.findFirst({
          where: { id: agentId, userId: user.id },
          select: { id: true },
        });
        if (!ownedAgent) {
          taskFailures.push({
            task_id: task.id,
            title: task.title,
            url: buildMcpTaskUrl(task.projectId, task.uniqueIndex),
            agent: agentId,
            error: `Agent ${agentId} not found or not owned by you.`,
          });
          continue;
        }
        if (!(await isAgentOnBoard(task.projectId, agentId))) {
          taskFailures.push({
            task_id: task.id,
            title: task.title,
            url: buildMcpTaskUrl(task.projectId, task.uniqueIndex),
            agent: agentId,
            error: `Agent ${agentId} is not a member of this task's board.`,
          });
          continue;
        }

        const wasAssigned = assignedAgentIds.has(agentId);
        let response: Awaited<ReturnType<typeof assigneesAssign>>;
        try {
          const assignee = { agent_id: agentId };
          response = await assigneesAssign(
            activityUser,
            user.id,
            task.id,
            assignee.agent_id,
            actingAgentId ?? undefined,
            { intent }
          );
        } catch (error) {
          taskFailures.push({
            task_id: task.id,
            title: task.title,
            url: buildMcpTaskUrl(task.projectId, task.uniqueIndex),
            agent: agentId,
            error: errorMessage(error),
          });
          continue;
        }
        if (response.status !== 200) {
          taskFailures.push({
            task_id: task.id,
            title: task.title,
            url: buildMcpTaskUrl(task.projectId, task.uniqueIndex),
            agent: agentId,
            error:
              (response.json as { message?: string }).message ??
              `${intent === "assign" ? "Assign" : "Unassign"} failed`,
          });
          continue;
        }

        const responseRows = (
          response.json as { body?: { userId: number; agentId: string | null }[] }
        ).body;
        const nowAssigned = Array.isArray(responseRows)
          ? responseRows.some((row) => row.agentId === agentId)
          : intent === "assign";
        if (
          (intent === "assign" && !wasAssigned && nowAssigned) ||
          (intent === "unassign" && wasAssigned && !nowAssigned)
        ) {
          changedAgentIds.push(agentId);
        }
        if (nowAssigned) assignedAgentIds.add(agentId);
        else assignedAgentIds.delete(agentId);
      }

      void broadcastBoardChange(task.projectId, { originUserId: user.id });

      return {
        success: true,
        task: {
          task_id: task.id,
          title: task.title,
          url: buildMcpTaskUrl(task.projectId, task.uniqueIndex),
          assignees: [...assignedUserIds],
          agent_assignees: [...assignedAgentIds],
          changed: changedUserIds.length + changedAgentIds.length,
          changed_user_ids: changedUserIds,
          changed_agent_ids: changedAgentIds,
        },
        failures: taskFailures,
      };
    };

    const results = await Promise.all(
      operationTargets.map(async (target) => {
        try {
          return await mutateOneTask(target);
        } catch (error) {
          return { success: false, error: errorMessage(error) };
        }
      })
    );
    const tasks: {
      task_id: number;
      title: string;
      url: string;
      assignees: number[];
      changed: number;
      changed_user_ids: number[];
      agent_assignees: string[];
      changed_agent_ids: string[];
    }[] = [];
    const failures: Record<string, unknown>[] = [];
    results.forEach((result, index) => {
      if (result.success && "task" in result && result.task) {
        tasks.push(result.task);
        if ("failures" in result && Array.isArray(result.failures)) {
          failures.push(...result.failures);
        }
      } else {
        failures.push({
          ...operationTargets[index].identifier,
          error: "error" in result ? result.error : "Task assignment failed",
        });
      }
    });
    return sanitizeForJson({
      success: tasks.length > 0,
      changed: tasks.reduce((count, task) => count + task.changed, 0),
      tasks,
      failures,
    });
  };


  return { COMMENT_TASK_LINK_RULE, CustomFieldType, DecisionRequestStatus, FREE_BOARD_LIMIT_MESSAGE, HTPR_6516_AGENT_ATTRIBUTION_FLAG, MAX_BULK_TOOL_TARGETS, MAX_SKILL_BODY_BYTES, MCP_ATTACHMENT_MAX_FILES, MY_TASKS_DEFAULT_LIMIT, MY_TASKS_MAX_LIMIT, McpAttachmentFetchError, NextRequest, PROJECT_ADMIN_MEMBER_UUID_PATTERN, PageConflictError, PriorityConstants, Prisma, REPORT_BODY_MAX, REPORT_CAPABILITIES, REPORT_SLUG_RE, ReportValidationError, SORTING_MODES, SUBTASK_SETTINGS, TOOL_TASK_ID_DESCRIPTION, TimeTrackingDisabledError, actingAgentId, addAgentToBoard, addMemberController, agentStore, applyDurableCommentAttribution, applyEstimateUpdate, applyPriorityUpdate, applyView, archivePage, askFleetAgent, assertAccessibleProject, assertProjectAccess, assertSkillScopeAccess, blockerStillOpen, body, broadcastBoardChange, broadcastInboxChange, broadcastTaskChange, broadcastTaskComment, bufferMatchesDeclaredMime, buildActivityUser, buildBulkOperationKey, buildCollectionMetadata, buildLimitedScanMetadata, buildMcpImageUrls, buildMcpTaskUrl, buildSearchTotalMetadata, buildTaskTreeNode, bulkPreviewsIssued, bulkTaskTargetCount, bulkUserTargetCount, cancelDueDateJob, columnRole, columnRoleFor, commentInclude, confirmationSessionId, convertPlainTextMentionsToHtml, createArchiveActivity, createBoardFromManifest, createCommentService, createCustomField, createPage, createReport, createSection, createTask, createTaskDueDateActivity, createTaskItemSchema, createView, deleteCommentService, deleteReport, deleteSection, deleteView, deriveChatAttachmentFilename, dropEmptyPadding, elapsedSeconds, ensureTaskMovedToInbox, errorMessage, escapeHtml, extractPrLinks, extractTipTapContent, findDraftWithAccess, findRootTaskIdForTree, findTaskByIdentifier, generateRank, getAccessibleAgentBoard, getAccessibleProjectIds, getAccessibleSkill, getAiModelOptionById, getBoardAgentMembers, getCustomFieldForProjectByName, getCustomFieldsForProject, getMemberAndOwner, getMyTasksSummary, getPage, getPageUrl, getProjectMembers, getProjectWhere, getReport, getReportUrl, getSectionForTask, getStructuredInboxForAgent, getTeamAgentPresence, getUpdateProfileInputSchema, getViewUrl, handleRelatedTasksGet, heartbeatTurn, htmlToMarkdown, importSkillsFromGitHub, invokeAgentManagementHandler, isBoardLimitReached, isFeatureEnabled, isLiveTaskListRequest, isNotificationInHeartbeatWindow, labelStore, linkifyTicketRefs, listOwnedAgents, listOwnedConnections, listPageVersions, listPages, listReport, listReports, listRunning, loadDoneTitlesByProject, logMinutes, manageAgentWebhook, mapCommentToResponse, mapDraftToResponse, mapTaskDescriptionContent, mapTaskSearchItem, mapTaskToDetail, mapTaskToMcpGetResponse, mapViewToResponse, mapVisibleMcpAgent, mcpTaskUserCommentCount, mcpVisibleAgentSelect, mintAccountMcpToken, moveTaskToDifferentBoard, mutateTaskAssignees, mutateTaskLabels, normalizeMime, normalizePriorityInput, normalizeTaskRelationType, notificationGetAll, notificationInboxInclude, parseAndValidateAttachmentsBody, parseBoardPlaybook, parsePageIdentifier, parseSkillMarkdown, pauseTimer, persistUrlsForComment, persistUrlsForDescription, priorityScore, prisma, requestingUserId, requireAccountManagementConfirmation, requireCrossMessageConfirmation, resolveBulkTaskTargets, resolveLiveTaskListProjectId, resolvePublicAgentDisplayName, resolveTaskForTool, resolveTextMentions, restorePageVersion, resumeTimer, retrieveBoardKnowledge, revokeAccountMcpToken, safeFetchAttachmentUrl, sanitizeBoardFilters, sanitizeForJson, sanitizeRichHtml, scheduleDueDateJob, searchHelpDocs, searchPages, sendNotificationForTask, sendStatus, setTaskLabels, slugifySkill, sortOrderSchema, startTimer, statusSchema, stopTimer, stripInlineDataUris, taskDetailInclude, taskMcpGetInclude, taskSummary, toStoredHtml, tool, turbopufferSearchTaskIds, updateCommentService, updateOwnProfile, updatePage, updateReport, updateSection, updateTaskSingle, updateTasksNeedConfirmation, updateView, uploadTaskAttachmentToS3, upsertCustomFieldValue, upsertTaskDescription, user, userHasProjectAccess, validateBoardManifest, validateMentionUserIds, validateMentionUsers, validateParentTask, validateProjectAccess, validateProjectMemberIds, validateTaskIdentifier, viewSortingStackSchema, withActivityMetadata, withToolErrors, z };
}

export type ChatToolContext = ReturnType<typeof createChatToolContext>;
export type CreateTaskItemInput = z.infer<typeof createTaskItemSchema>;
export type { ToolTaskIdentifierInput } from "./bulkTools";
