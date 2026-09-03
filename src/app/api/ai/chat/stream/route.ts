import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { CustomFieldType, DecisionRequestStatus, Prisma } from "@prisma/client";
import {
  generateText,
  stepCountIs,
  streamText,
  tool,
  type FilePart,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
  type UserContent,
} from "ai";
import { z } from "zod";

import prisma from "@/lib/prisma";
import { linkifyTicketRefs } from "@/utils/controllers/comments/linkifyTicketRefs";
import { persistAssistantMessage } from "./persistAssistantMessage";
import {
  ensureNativeChatTurn,
  findNativeAssistantReplay,
} from "./ensureNativeChatTurn";
import {
  acquireAiChatStreamLease,
  acquireAiChatCompletionFence,
  acquireAiChatToolFence,
  assertAiChatToolCanStart,
  finishAiChatCompletionFence,
  keepAiChatCompletionFenceAlive,
  releaseAiChatStreamLease,
  releaseAiChatCompletionFence,
  watchAiChatCancellation,
} from "./streamLease";
import {
  completeHeartbeatExecution,
  failHeartbeatExecution,
  markHeartbeatMutationStarted,
  startHeartbeatExecution,
} from "@/app/api/ai/_lib/heartbeatExecution";
import {
  decodeHeartbeatTurnMessage,
  isNotificationInHeartbeatWindow,
  type HeartbeatTurnMetadata,
} from "@/lib/nativeAgent/heartbeatTurnEnvelope";
import { resolveAgentModelPin } from "@/lib/nativeAgent/modelPin";
import { reportError } from "@/lib/errors/reportError";
import { searchHelpDocs } from "@/lib/help-docs/searchHelpDocs";
import { retrieveBoardKnowledge } from "@/lib/rag/retrieveBoardKnowledge";
import { logAiUsage } from "@/app/api/ai/_lib/aiUsage";
import {
  loadCurrentTaskContext,
  resolveAiUsageTaskId,
} from "@/app/api/ai/_lib/currentTaskContext";
import {
  buildChatProviderContext,
  resolveChatTeamContext,
} from "@/app/api/ai/_lib/chatTeamContext";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import {
  getProjectMembers,
} from "@/utils/controllers/projects/getProjectMembers";
import {
  createCustomField,
  getCustomFieldForProjectByName,
  getCustomFieldsForProject,
  upsertCustomFieldValue,
} from "@/utils/controllers/customFields";
import notificationGetAll, {
  notificationInboxInclude,
} from "@/utils/controllers/notifications/getAll";
import { getStructuredInboxForAgent } from "@/utils/controllers/notifications/getStructuredInboxForAgent";
import { turbopufferSearchTaskIds } from "@/utils/controllers/search/document";
import {
  mapVisibleMcpAgent,
  mcpVisibleAgentSelect,
} from "@/lib/mcp/agents";
import { accessibleAgentWhere } from "@/lib/agents/visibility";
import {
  listOwnedAgents,
  type AgentManagementDatabase,
} from "@/lib/mcp/agents/ownedAgents";
import { withAdoptedAgentMutationLease } from "@/lib/mcp/tasks/agentMutationLeaseAdoption";
import { createAgentForUser } from "@/lib/mcp/agents/create";
import { revokeAgentForUser } from "@/lib/mcp/agents/revoke";
import {
  mintAccountMcpToken,
  revokeAccountMcpToken,
} from "@/lib/mcp/accountTokens";
import { listOwnedConnections } from "@/lib/mcp/connections";
import {
  manageAgentWebhook,
  type AgentWebhookManagementAction,
} from "@/lib/agentWebhooks/management";
import {
  mapTaskDescriptionContent,
  mapTaskToDetail as mapTaskToDetailBase,
  mapTaskToMcpGetResponse as mapTaskToMcpGetResponseBase,
  mcpTaskUserCommentCount,
  taskDetailInclude,
  taskMcpGetInclude,
} from "@/lib/mcp/tasks/mappers";
import {
  findTaskByIdentifier,
  TaskIdentifierAmbiguityError,
  validateTaskIdentifier,
} from "@/lib/mcp/tasks/resolveTask";
import { extractPrLinks } from "@/lib/mcp/tasks/extractPrLinks";
import {
  getMyTasksSummary,
  MY_TASKS_DEFAULT_LIMIT,
  MY_TASKS_MAX_LIMIT,
} from "@/lib/mcp/tasks/myTasksSummary";
import { priorityScore } from "@/lib/mcp/tasks/priorityScore";
import { blockerStillOpen } from "@/lib/mcp/tasks/blockerStillOpen";
import { normalizeTaskRelationType } from "@/lib/mcp/tasks/relationType";
import { handleRelatedTasksGet } from "@/lib/mcp/tasks/relatedTasks";
import {
  elapsedSeconds,
  listReport,
  listRunning,
  logMinutes,
  pauseTimer,
  resumeTimer,
  startTimer,
  stopTimer,
  taskSummary,
  TimeTrackingDisabledError,
} from "@/lib/timeTracking";
import {
  createTask,
  getSectionForTask,
  mutateTaskLabels,
  setTaskLabels,
  validateParentTask,
  validateProjectAccess,
  validateProjectMemberIds,
} from "@/lib/mcp/tasks/services";
import { createView, deleteView, updateView, applyView } from "@/lib/mcp/views/services";
import { SORTING_MODES } from "@/models/Views/model";
import { SUBTASK_SETTINGS } from "@/models/Views/model";
import { getViewUrl } from "@/utils/controllers/projects/views/viewsHelperAPIfunctions";
import {
  McpAttachmentFetchError,
  safeFetchAttachmentUrl,
} from "@/lib/mcp/attachments/safeFetch";
import { parseAndValidateAttachmentsBody } from "@/lib/mcp/attachments/validateBody";
import { bufferMatchesDeclaredMime } from "@/lib/mcp/attachments/magicBytes";
import {
  MCP_ATTACHMENT_MAX_FILES,
  normalizeMime,
} from "@/lib/mcp/attachments/constants";
import { uploadTaskAttachmentToS3 } from "@/lib/storage/uploadTaskAttachmentToS3";
import { validateBoardManifest } from "@/lib/mcp/boards/validateManifest";
import { createBoardFromManifest } from "@/lib/mcp/boards/createBoardFromManifest";
import { parseBoardPlaybook } from "@/lib/mcp/boards/playbook";
import {
  FREE_BOARD_LIMIT_MESSAGE,
  isBoardLimitReached,
} from "@/utils/controllers/projects/boardQuota";
import { columnRole, columnRoleFor } from "@/lib/mcp/boards/columnRole";
import { loadDoneTitlesByProject } from "@/utils/controllers/notifications/inboxZero";
import { updateTaskSingle } from "@/utils/controllers/tasks/single";
import { moveTaskToDifferentBoard } from "@/utils/controllers/tasks/moveToDifferentBoard";
import createArchiveActivity from "@/utils/controllers/activities/createArchiveActivity";
import {
  broadcastInboxChange,
  broadcastBoardChange,
  broadcastTaskChange,
  broadcastTaskComment,
} from "@/lib/realtime/server";
import createTaskDueDateActivity from "@/utils/controllers/activities/createTaskDueDateActivity";
import createEstimateActivity from "@/utils/controllers/activities/createEstimateActivity";
import createPriorityActivity from "@/utils/controllers/activities/CreatePriorityActivity";
import sendNotificationForTask from "@/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove";
import { ensureTaskMovedToInbox } from "@/lib/taskCardActions/inboxState";
import { cancelDueDateJob, scheduleDueDateJob } from "@/pages/api/queues/duedateQueue";
import generateRank from "@/utils/generateRank";
import { EstimateConstants, PriorityConstants } from "@/lib/constants/constants";
import { createCommentService } from "@/utils/controllers/comments/createCommentService";
import {
  convertPlainTextMentionsToHtml,
  resolveTextMentions,
} from "@/utils/controllers/comments/processMentions";
import { extractTipTapContent } from "@/utils/helperFunctions/multiPages/multipages.functions";
import { sanitizeBoardFilters } from "@/utils/helperFunctions/Views/BoardFilterSanitizer";
import {
  buildMcpImageUrls,
  persistUrlsForDescription,
  persistUrlsForComment,
} from "@/utils/controllers/urls/extractUrlsFromContent";
import assigneesAssign from "@/utils/controllers/assignees/assign";
import {
  createSection,
  updateSection,
  deleteSection,
} from "@/lib/mcp/sections/services";
import { updateCommentService } from "@/utils/controllers/comments/updateCommentService";
import { deleteCommentService } from "@/utils/controllers/comments/deleteCommentService";
import { buildMcpTaskUrl } from "@/lib/mcp/boards/links";
import {
  getPageUrl,
  parsePageIdentifier,
} from "@/app/api/mcp/pages/_lib/routeUtils";
import { htmlToMarkdown } from "@/utils/controllers/pages/htmlToMarkdown";
import upsertTaskDescription from "@/utils/controllers/description/common-description-create";
import { toStoredHtml } from "@/utils/helperFunctions/toStoredHtml";
import {
  archivePage,
  createPage,
  getPage,
  listPageVersions,
  listPages,
  PageConflictError,
  restorePageVersion,
  searchPages,
  updatePage,
} from "@/utils/controllers/pages/pageService";
import {
  createReport,
  deleteReport,
  getReport,
  getReportUrl,
  listReports,
  REPORT_BODY_MAX,
  REPORT_CAPABILITIES,
  REPORT_SLUG_RE,
  ReportValidationError,
  updateReport,
} from "@/utils/controllers/reports/reportService";
import { updateOwnProfile } from "@/utils/controllers/users/updateOwnProfile";
import { getUpdateProfileInputSchema } from "@/lib/mcp-server/validations/user.validation";
import getMemberAndOwner from "@/utils/controllers/getMemberAndOwnerForBoard";
import type { IUser } from "@/models/model";
import {
  getByokOrTeamGatewayApiKeyForProvider,
  getByokOrTeamGatewayApiKeyForModelOption,
  getTeamGatewayApiKey,
} from "@/app/api/ai/_lib/byokKeys";
import {
  aiUsageProviderForCredential,
  isAiGatewayEnabled,
  isCustomEndpointConfig,
  isVercelAiGatewayKey,
  providerOptionsForAiModel,
  resolveAiModel,
  type AiModelCredential,
  type AiGatewayTags,
  type AiProviderOptions,
} from "@/app/api/ai/_lib/modelProvider";
import {
  defaultAiModelOption,
  getDefaultAiModelOptionForPlan,
  getAiModelOptionById,
  preferredAiModelOption,
  type TAiModelOption,
} from "@/lib/aiModelOptions";
import { filterModelOptionForTeam } from "@/app/api/ai/_lib/providerGate";
import { resolveSkills } from "@/app/api/ai/_lib/skills";
import { HOUSE_OUTPUT_STYLE } from "@/app/api/ai/_lib/editorAi";
import { getAiRequestUser } from "@/app/api/ai/_lib/requestUser";
import { getCronServiceRequestUser } from "@/app/api/ai/_lib/cronServiceAuth";
import {
  assertModelAllowedForPlan,
  storePlanIdForProject,
} from "@/app/api/ai/_lib/planGate";
import {
  addAgentToBoard,
  getAccessibleAgentBoard,
  getBoardAgentMembers,
  isAgentOnBoard,
} from "@/utils/controllers/agents/boardMembers";
import { addMemberController } from "@/pages/api/invite/createInviteLink";
import { getTeamAgentPresence } from "@/lib/mcp/agents/presence";
import { sanitizeRichHtml } from "@/utils/helperFunctions/sanitizeRichHtml";
import { withActivityMetadata } from "@/lib/mcp/comments/activityMetadata";
import { requireCrossMessageConfirmation } from "@/lib/ai/bulkConfirmation";
import { escapeHtml } from "@/utils/helperFunctions/escapeHtml";
import { assertProjectAccess } from "@/app/api/ai/_lib/customInstructions";
import {
  assertSkillScopeAccess,
  getAccessibleSkill,
} from "@/app/api/ai/_lib/skillAccess";
import {
  MAX_SKILL_BODY_BYTES,
  parseSkillMarkdown,
  slugifySkill,
} from "@/app/api/ai/_lib/skillMarkdown";
import { importSkillsFromGitHub } from "@/app/api/ai/_lib/skillImport";
import {
  isAiFeatureEnabled,
  resolveUserFacingModelOption,
  type UserFacingModelFeature,
} from "@/lib/systemModelLadder";
import {
  getAiModelPreferenceIds,
  type TAiModelPreferenceSurface,
  type TAiModelPreferences,
} from "@/lib/aiModelPreferences";
import {
  buildCollectionMetadata,
  buildBulkOperationKey,
  buildEmptyCompletionSummary,
  buildLimitedScanMetadata,
  buildSearchTotalMetadata,
  decideTaskIdentifierMatch,
  hasVisibleCompletion,
  resolveBulkTaskTargets,
  updateTasksNeedConfirmation,
  resolveUserIds,
  type ToolTaskIdentifierInput,
} from "./bulkTools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ProviderId =
  | "claude"
  | "openai"
  | "openrouter"
  | "gateway"
  | "custom";
type AuthedUser = { id: number; email: string; displayName?: string | null };
type SseEvent = "status" | "content" | "title" | "done" | "error";
type ToolExecution = { name: string; result: unknown };
type ToolExecutionRecorder = (execution: ToolExecution) => void;
type ToolStartRelease = () => void | Promise<void>;
type ToolStartRecorder = (
  name: string,
) => void | ToolStartRelease | Promise<void | ToolStartRelease>;

const PROJECT_ADMIN_MEMBER_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

const DEFAULT_PROVIDER: ProviderId = "openai";
const DEFAULT_MODEL = "gpt-5.6-luna";
const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5";
const MAX_TOOL_STEPS = 32;
const MAX_BULK_TOOL_TARGETS = 50;
const CLAUDE_MODELS = new Set(["claude-sonnet-5", "claude-opus-5"]);
const OPENAI_MODELS = new Set([
  "gpt-5.5",
  "gpt-5.6-luna",
  "gpt-5.6-terra",
  "gpt-5.6-sol",
  "gpt-5.4-mini",
]);
const TOOL_TASK_ID_DESCRIPTION =
  "internal database id -- do NOT derive it from the ticket number; pass ticket_number instead if you only know e.g. ABC-123";

const bulkTaskTargetCount = (input: {
  task_ids?: number[];
  ticket_numbers?: string[];
}) => (input.task_ids?.length ?? 0) + (input.ticket_numbers?.length ?? 0);

const bulkUserTargetCount = (input: {
  user_ids?: number[];
  users?: (number | string)[];
}) => (input.user_ids?.length ?? 0) + (input.users?.length ?? 0);

const createTaskItemSchema = z.object({
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
type CreateTaskItemInput = z.infer<typeof createTaskItemSchema>;

const CLAUDE_TEMPERATURE_UNSUPPORTED_PREFIXES = [
  "claude-opus",
  "claude-sonnet-5",
] as const;

const COMMENT_TASK_LINK_RULE =
  'Before adding, drafting, updating, or publishing a comment, validate its final text before the write: every task reference already resolved by a task tool must be an anchor whose href copies that result\'s relative "url" field exactly. Use the task title as the link text when available, and the ticket number only when no title is available. Never leave a resolved ticket number as plain text, and never rebuild its URL. This applies on task detail, Inbox, and every other task-related surface.';

const AGENT_SYSTEM_PROMPT = `
                You are an intelligent and helpful agentic assistant with access to tools and a knowledge base.
                Your goal is to provide helpful, accurate, and relevant responses to user queries.

                ### 0. OUTPUT STYLE (MANDATORY - every response, every model)
                ${HOUSE_OUTPUT_STYLE}
                - Default length cap: at most ~120 words (or ~6 bullets) per answer. Exceed it ONLY when the user explicitly asks for depth ("explain", "in detail", "full", "long") or the deliverable inherently needs it (a full draft or document they requested).
                - Verbose, padded, essay-style answers are failures regardless of which model is running. When in doubt, answer shorter.
                - **Action-first shape**: when the user must do something, give numbered steps in execution order, one bounded action per step. Cap lists at 5 items; split into "do now" vs "later" beyond that.
                - **End with one next action** when anything is left open: something the user can do in under two minutes. Never end with "anything else?".
                - **Concrete estimates**: "about a minute", "half a day"; never "quick" or "some work".
                - Matter-of-fact on errors: state cause and fix. No "Oops", no "Uh oh".

                ### 1. CONTEXT & CHAT HISTORY
                - **Thorough Analysis**: Review the CHAT HISTORY to identify references (e.g., "that task", "X's take").
                - **Conversational Awareness**: Acknowledge the ongoing discussion and use temporal awareness/current time where relevant.
                - **Direct Reference**: Always reference specific past messages or topics rather than stating there is no conversation.
        
                ### 2. HTML FORMATTING RULES
                - **Body Content Only**: Do NOT include <!DOCTYPE html>, <html>, <head>, or <body> tags.
                - **No Styling**: Use basic elements (<p>, <h1>, <h2>, <ul>, <li>). Never apply CSS or inline 'style' attributes.
                - **Task Linking**: Reference tasks by Title. Every task returned by the tools includes a ready-made "url" field (e.g. "/detail/project-339/1365"). Wrap the Title in a link using that url EXACTLY as given: <a href="{{task.url}}">Title</a>. NEVER build the path yourself and NEVER use the task "id" field in a link (that is the global database id, not the ticket number). Relative hrefs only — never include the origin (https://app.hypertask.ai).
                - **Comment Task Links**: ${COMMENT_TASK_LINK_RULE}
                - **Validation**: Never add an anchor tag if you lack a valid link. Do not prefix titles with "Task - ".

                ### 2.1. PERSPECTIVE & VOICE (drafting replies, comments, messages)
                - The person talking to you is the one in user_context. Every reply, comment, status update, or "next message" you draft is THEIR message: written in first person, from their perspective, addressing the other people on the ticket.
                - "The next logical reply" / "my reply" ALWAYS means the user_context person's own next message — NEVER the message the assignee or the thread's next likely author would write. If the last comment says someone else is picking the work up, the user's reply reacts to that (acknowledge, thank, ask); it does not speak as that person.
                - Never write a draft in the voice of anyone other than the user_context person unless they explicitly name someone else to impersonate.

                ### 3. COMPLETION REQUIREMENTS
                - **Integrity**: Always provide a COMPLETE response. Do not cut off mid-sentence or mid-thought.
                - **Prioritization**: If content is extensive, summarize key points to ensure you reach a proper conclusion.
                - **Closures**: Ensure all HTML tags are closed. Do NOT add trailing wrap-ups like "In summary" - end when the answer is complete.
                - **Restriction**: Do not begin your response with "Good Morning".

                ### 3.1. SUMMARY STYLE (when the user asks to summarize a ticket/task/discussion)
                - **Shorter than the source by default**: The summary must be shorter than the ticket's description + comments it is summarizing. Only exceed that if the ticket is genuinely complex (long history, many conflicting decisions) — and say so explicitly if you do.
                - **Cut the filler**: Skip restating the obvious, skip a "next steps" section unless next steps were actually asked for or are the point of the query.

                ### 4. TOOL SELECTION HIERARCHY
                ### 4.1. RAG vs MCP DECISION TREE
                    **Use RAGRetrievalTool when:**
                    - The query is conversational, ambiguous, or semantic
                      (e.g. "what's been happening with the auth bug", "summarize discussions on HTPR-3550")
                    - The query references specific task IDs or ticket numbers — RAG can locate
                      and return context around them without needing get_tasks
                    - Comments are part of the broader task context — RAG indexes both tasks and
                      comments together and will return relevant comment content automatically
                    **Use list_tasks when:**
                    - The query contains explicit structured filters
                      (e.g. priority, assignee, section, status, labels, due dates)
                    - Examples: "all high priority tasks", "tasks assigned to me", "tasks due this week"
                    **Use search_tasks when:**
                    - The query contains a keyword, phrase, or partial task name to match against
                    - Examples: "find tasks mentioning payment gateway", "search for login issue tasks"
                    **Use get_tasks when:**
                    - You already have specific task IDs or ticket numbers from a previous tool call or when the user is requesting task specific information such as priority, estimates, tags, subtasks, etc.
                      AND you need full detail fields that RAG did not return
                      (e.g. attachments, followers, comment count, estimates)
                    - This is a detail enrichment step only — never use it as a search or discovery tool
                    - When a tool needs a task identifier, copy \`task_id\` exactly as returned by a previous search/list/get tool result; never infer task_id, ticket_number, or unique_index from a task's title.
                    **Use get_comments when:**
                    - The user is explicitly and specifically requesting comments on a task
                      (e.g. "show me all comments on HTPR-3550", "what's the latest comment on this task")
                    - Never use for conversational or contextual queries about task discussions — RAG covers this
                    **Use search_help_docs when:**
                    - The user asks how Hypertask itself works, or how to do something in the product
                      (e.g. "how do boards/columns work", "what does Ctrl+K do", "how do I change my AI model",
                      "how do notifications work", "what does it cost", "how do I connect an agent via MCP")
                    - This searches the Hypertask help center (help.hypertask.ai), NOT the user's own tasks.
                      Product/how-to questions → search_help_docs; questions about the user's own tasks,
                      comments, or board content → RAG/list_tasks/search_tasks. Cite the returned article URL.
                ### 4.2. WRITE OPERATIONS
                    RAG is read-only. For any write operation always use the appropriate tool directly:
                    - Create task → hypertask_create_task
                    - Update task (title, description, priority, due date, labels, status, move within board) → hypertask_update_task
                    - Adding or removing a tag/label → hypertask_update_task with add_labels / remove_labels.
                      NEVER use the "labels" field to add or remove a tag: "labels" REPLACES the task's
                      entire label set, so it silently deletes every tag you did not list. Swapping tag A
                      for tag B is remove_labels:["A"] + add_labels:["B"], never labels:["B"].
                      Only use "labels" when the user explicitly states the complete final list of tags.
                      Label names are accepted, you do not need to look up their ids first.
                      A tag change is reversible and never needs confirmation: apply it immediately and
                      report the result. Do not ask "shall I proceed?" before retagging, however many
                      tasks it covers.
                    - Move task to a different board → hypertask_move_task_between_boards
                    - Add comment → hypertask_add_comment
                    - Update/delete comment → hypertask_update_comment / hypertask_delete_comment
                    - ANYTHING about the user's OWN work → hypertask_my_tasks. "my tasks", "my workload",
                      "what am I working on", "how many tasks do I have", "what's overdue", "what do I have on
                      board X", and the first step before unassigning them from a board. It returns every task
                      assigned to them across every board with EXACT per-board counts. Never answer these from
                      hypertask_list_tasks, hypertask_search_tasks or a board-wide count: "how many tasks do I
                      have" means tasks ASSIGNED TO THEM, never the total number of tasks on their boards.
                    - Assign user → hypertask_assign_user
                    - Unassign user → hypertask_unassign_user
                    - Archive/unarchive inbox notifications → hypertask_inbox_archive / hypertask_inbox_unarchive
                    - Attach files from public URLs to a task description or comment → hypertask_attach_files
                    - List labels on a board → hypertask_list_labels
                    - Create label → hypertask_create_label
                    - List a board's custom fields (e.g. ICE, Story Points) → hypertask_list_custom_fields
                    - Set or clear a custom field's value on a task (e.g. "set ICE to 21 on THID-5") →
                      hypertask_set_custom_field_value. Pass create_field=true to explicitly create a missing
                      Number field. Pass value: null (or "") to clear an existing field.
                    - Create board from a structured manifest → hypertask_create_board
                    - List or read a standalone HTML report → hypertask_list_reports / hypertask_get_report
                    - Create, update, or delete a standalone HTML report → hypertask_create_report / hypertask_update_report / hypertask_delete_report
                    - Inspect or manage an agent's signed mention/assignment webhook → hypertask_agent_webhook. Use action=get for discovery; configure/test/replay/rotate/delete require cross-message confirmation.
                    - Query time entries across accessible work → hypertask_time_report
                    - Update the signed-in user's display name or profile photo → hypertask_update_profile
                    - Create a saved board view (a named, filtered lens on a board) → hypertask_create_view
                    - Rename or re-filter an existing view → hypertask_update_view (find its id first with hypertask_list_views)
                    - Configure sorting or subtask display when creating or updating a saved view → hypertask_create_view / hypertask_update_view
                    - Switch the user to a different view / back to the default view → hypertask_switch_view
                    - Delete a saved board view → hypertask_delete_view (find its id first with hypertask_list_views)
                    - Create/rename/delete section → hypertask_section
                    - Create/list/update/publish/delete draft → hypertask_draft
                    - After a successful create/update/comment/assign/unassign/move/archive/unarchive/attach/label/board/section/draft action, confirm it to the user and link the
                      ticket with the exact url returned by the tool: <a href="{{task.url}}">{{task.title}}</a>
                    - **Wide or destructive writes are confirmed BEFORE they run.** If any write tool
                      returns confirmation_required, nothing was changed. Stop there: end your turn, list the
                      affected tasks for the user, and ask them to confirm. Only when they say yes in a NEW
                      message do you call the tool again with confirmed: true. Never set confirmed: true to
                      approve your own proposal in the same turn, it will be rejected.

                ### 4.3. BOARD AGENTS
                - When context_list contains an agent mention (type "agent") or the user addresses @AgentName, call hypertask_ask_agent with that agent's id and a focused question.
                - After the tool returns success: true, synthesize one reply combining the agent's domain answer with relevant board context. Attribute the answer by name (for example, "According to inne Wiki, ...") and keep any citations or sources the agent included.
                - **If the tool returns success: false, do not answer the question from your own general knowledge in the same reply.** Tell the user plainly, by name, that the agent could not be reached right now, in a short user-safe sentence (do not quote the tool's raw error text), and stop. Never present your own knowledge as if it came from the agent, and never blend a disclaimer with a substantive answer in one breath.

                ### 5. METADATA FILTERING LOGIC
                - **Default**: Apply default_context.project_id to metadata filters, so questions default to the board the user is looking at.
                - **default_context.surface says which screen the user is on.** Answer "where am I?" with it.
                  surface "my_tasks" is the My Tasks page: their own work across EVERY board, no project_id.
                  There, hypertask_my_tasks is your DEFAULT first tool call for any question about their work,
                  and never say you lack board context. "inbox" and "calendar" also span all boards, so they
                  carry no project_id either. "board" and "task_detail" do carry one.
                - **default_context.view_name / view_id say which View (saved filtered tab) of the board is currently active on screen.** Views are board-scoped saved filters, a lot like sub-boards. If the user asks "which view am I on?", answer with view_name. When view_id is absent the user is on the board's default (all tasks) view named by view_name.
                - **default_context.task_id says which ticket is on screen, it does not scope the request.**
                  If the user names a SET ("all tasks tagged X", "every task in Done"), act on the WHOLE set even
                  while a ticket is open: find it with hypertask_list_tasks, then change every match in ONE
                  hypertask_update_task call via task_ids.
                - **Due dates: enumerate with hypertask_list_tasks(has_due_date: true), never hypertask_search_tasks.**
                  Semantic search is relevance-ranked and truncated, so it will miss due-dated tasks. For any
                  "which tasks have due dates" / "clear the due dates" request, list them exhaustively with the
                  has_due_date filter and paginate. A date sitting in a task's title or description is NOT a due
                  date - only the dueDate field is; do not infer due dates from text.
                - **Never let a partial result read as a complete one.** A phrase like "remove tag X and replace it
                  with tag Y" is ambiguous when a ticket is open: it may mean this task, or every task carrying X.
                  Apply it to the open task, but BEFORE you answer, check with hypertask_list_tasks whether other
                  tasks still carry X. If any do, say so plainly and offer to do them too, e.g.
                  "Updated HTPR-1. 2 other tasks still have the X tag (HTPR-2, HTPR-3) - want me to change those as well?"
                  Do not silently leave them behind.
                - **State the count on any multi-task write** ("retagged 3 tasks: ..."). If you changed fewer than asked, say why.
                - **Filter inference**: From the user query add filters when relevant (e.g. "tasks assigned to me" -> assignees, "tasks in Done section" -> section_title, "high priority" -> priority).
                - **Only pass the filters the user actually asked for. Leave every other optional argument UNSET.**
                  Do not default-fill created_by, assigned_to, has_comments, has_attachments, priority, labels, etc.
                  A stray created_by or has_comments silently narrows the result and makes a full board look empty.
                - **Valid filter keys**: projectid, taskId, assignees, createdBy, hasSubtasks, isSubtask, mentions, priority, sectionId, section_title, size, subtaskIds, subtaskUniqueIndexes, tagIds, ticketNumber, uniqueIndex, relatedToAndFromTasks, title (exact match only; prefer semantic query for title-like searches).
                - **Filter key preference**: Use taskId>ticketNumber>uniqueIndex for task filters.

                ### FINAL REMINDER
                Section 0 OUTPUT STYLE binds every response: bottom line up front, scannable bullets, bold content, ~120 words unless depth was explicitly requested.
            `;

const statusSchema = z.enum(["Normal", "Archive", "Deleted"]);
const sortOrderSchema = z.enum(["asc", "desc"]);
const viewSortingStackSchema = z
  .array(
    z
      .object({
        mode: z.enum(SORTING_MODES).exclude(["Manual"]),
        order: z.enum(["Ascending", "Descending"]),
      })
      .strict()
  )
  .max(2);
const attachmentSchema = z.object({
  fileName: z.string().optional(),
  url: z.string().optional(),
  mimeType: z.string().nullable().optional(),
});
const byokProviderFlagSchema = z
  .object({
    provider: z.string().optional().nullable(),
    enabled: z.boolean().optional(),
    ciphertext: z.string().nullable().optional(),
  })
  .passthrough();
const defaultContextSchema = z
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
const chatRequestSchema = z.object({
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

type ChatRequest = z.infer<typeof chatRequestSchema>;

type SendSse = (event: SseEvent, data: Record<string, unknown>) => void;

const toolStatus: Record<string, string> = {
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

const writeToolNames = new Set([
  "hypertask_ask_agent",
  "hypertask_create_task",
  "hypertask_update_task",
  "hypertask_task_description_history",
  "hypertask_page_history",
  "hypertask_create_page",
  "hypertask_update_page",
  "hypertask_add_comment",
  "hypertask_update_comment",
  "hypertask_delete_comment",
  "hypertask_assign_user",
  "hypertask_unassign_user",
  "hypertask_move_task_between_boards",
  "hypertask_inbox_archive",
  "hypertask_inbox_unarchive",
  "hypertask_move_task_to_inbox",
  "hypertask_attach_files",
  "hypertask_create_label",
  "hypertask_create_board",
  "hypertask_create_agent",
  "hypertask_agent_webhook",
  "hypertask_revoke_agent",
  "hypertask_mint_token",
  "hypertask_revoke_token",
  "hypertask_board_config",
  "hypertask_project_admin",
  "hypertask_section",
  "hypertask_draft",
  "hypertask_create_view",
  "hypertask_update_view",
  "hypertask_switch_view",
  "hypertask_delete_view",
  "hypertask_start_timer",
  "hypertask_stop_timer",
  "hypertask_pause_timer",
  "hypertask_resume_timer",
  "hypertask_log_time",
  "hypertask_link_tasks",
  "hypertask_decision_request",
  "hypertask_create_skill",
  "hypertask_update_skill",
  "hypertask_delete_skill",
  "hypertask_import_skills",
  "hypertask_create_report",
  "hypertask_update_report",
  "hypertask_delete_report",
  "hypertask_update_profile",
  "hypertask_set_custom_field_value",
]);

const commentInclude = (userId: number) => ({
  creator: {
    select: {
      id: true,
      email: true,
      displayName: true,
    },
  },
  agent: {
    select: mcpVisibleAgentSelect(userId),
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

function sseFrame(event: SseEvent, data: Record<string, unknown>) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function createSseErrorResponse(message: string, status?: number) {
  return new Response(
    sseFrame("error", { content: message }) +
      sseFrame("done", { status: "error" }),
    { ...(status ? { status } : {}), headers: SSE_HEADERS }
  );
}

function errorMessage(error: unknown) {
  if (typeof error === "string") return error;
  // Prisma/driver errors carry schema and query detail, so those stay internal.
  // Everything else is our own thrown message, which the model needs verbatim
  // to correct itself (validation errors, tool preconditions, ambiguity hints).
  if (error instanceof Error && !error.name.startsWith("Prisma")) {
    return error.message;
  }
  console.error("[ai/chat/stream] internal error", error);
  return "Sorry, an error occurred while processing your request.";
}

/** The allowance stop unwrapped from the SDK's retry chain, or null. */
function includedAllowanceError(error: unknown) {
  let current: unknown = error;
  const visited = new Set<unknown>();
  for (let depth = 0; depth < 8 && current && !visited.has(current); depth += 1) {
    visited.add(current);
    if (current instanceof Error) {
      if (current.name === "SharedAiAllowanceExceededError") {
        return current as Error & { periodKey?: string };
      }
      const wrapped = current as Error & {
        cause?: unknown;
        lastError?: unknown;
      };
      current = wrapped.cause ?? wrapped.lastError;
      continue;
    }
    if (typeof current === "object") {
      const wrapped = current as { cause?: unknown; lastError?: unknown };
      current = wrapped.cause ?? wrapped.lastError;
      continue;
    }
    break;
  }
  return null;
}

// Tool errors need verbatim detail for the model, but streamed errors are user-visible.
function userFacingErrorMessage(error: unknown, stage: string) {
  console.error(`[ai/chat/stream] ${stage} user-facing error`, error);
  const allowanceError = includedAllowanceError(error);
  if (allowanceError) return allowanceError.message;
  return "Sorry, something went wrong while generating a response. Please try again.";
}

/**
 * Extra fields for a streamed error event. The allowance period travels with
 * the stop so a background caller can deduplicate against the period that
 * actually rejected, instead of re-deriving one from its own clock and keying
 * the wrong month at a rollover.
 */
function userFacingErrorDetails(error: unknown) {
  const periodKey = includedAllowanceError(error)?.periodKey;
  return periodKey ? { allowancePeriod: periodKey } : {};
}

function requestErrorMessage(
  error: unknown,
  stage: "body" | "validation",
) {
  console.error(`[ai/chat/stream] request-${stage} user-facing error`, error);
  if (stage === "body") {
    return "Invalid request: the request body could not be read.";
  }
  if (!(error instanceof z.ZodError) || error.issues.length === 0) {
    return "Invalid request.";
  }

  const fieldIssues = error.issues.flatMap((issue) => {
    const field = issue.path
      .filter((part): part is string => typeof part === "string")
      .map((part) =>
        part
          .replace(/_/g, " ")
          .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
          .toLowerCase(),
      )
      .join(" ");
    return field ? [{ field, code: issue.code }] : [];
  });
  const fields = [...new Set(fieldIssues.map(({ field }) => field))];
  if (fields.length === 0) return "Invalid request.";
  const fieldList =
    fields.length === 1
      ? fields[0]
      : `${fields.slice(0, -1).join(", ")} and ${fields.at(-1)}`;
  // A missing value reads as "required"; anything else is "invalid".
  const fieldsAreRequired = fieldIssues.every(
    ({ code }) => code === "too_small" || code === "invalid_type",
  );
  return `Invalid request: ${fieldList} ${fields.length === 1 ? "is" : "are"} ${
    fieldsAreRequired ? "required" : "invalid"
  }.`;
}

async function reportHandledChatError(error: unknown, stage: string) {
  if (includedAllowanceError(error)) return;
  if (error instanceof Error && error.name === "AiPlanAccessError") return;
  const normalized =
    error instanceof Error ? error : new Error(errorMessage(error));
  await reportError({
    message: normalized.message,
    stack: normalized.stack,
    url: "/api/ai/chat/stream",
    source: "handled",
    extra: { stage },
  });
}

const EMPTY_COMPLETION_TICKET_THRESHOLD = 50;

async function reportEmptyCompletion(retryFailed: boolean, error: unknown) {
  if (retryFailed) {
    await reportHandledChatError(error, "empty-completion-retry");
    return;
  }

  const normalized = new Error("AI chat returned an empty completion");
  await reportError({
    message: normalized.message,
    stack: normalized.stack,
    url: "/api/ai/chat/stream",
    source: "handled",
    extra: { stage: "empty-completion" },
    minimumOccurrences: EMPTY_COMPLETION_TICKET_THRESHOLD,
    fingerprintKey: "ai-chat-empty-completion",
  });
}

function trackToolSetExecutions(
  tools: ToolSet,
  recordToolExecution: ToolExecutionRecorder,
  recordToolStart?: ToolStartRecorder,
  leaseActor: { agentId: string; userId: number } | null = null
) {
  for (const [name, rawTool] of Object.entries(tools)) {
    const trackedTool = rawTool as {
      execute?: (...args: unknown[]) => unknown;
    };
    if (typeof trackedTool.execute !== "function") continue;

    const execute = trackedTool.execute;
    trackedTool.execute = async (...args: unknown[]) => {
      const release = await recordToolStart?.(name);
      try {
        // An agent-attributed task write is fenced and must hold the task's
        // lease, the one MCP clients take through POST /mcp/tasks/lease/claim.
        // Chat never claimed one, so an agent's moves, edits, archives and
        // description publishes were rejected as though another agent owned the
        // ticket. Human conversations pass no actor and are untouched.
        const result = await withAdoptedAgentMutationLease(
          prisma,
          leaseActor ?? {},
          async () => execute(...args)
        );
        recordToolExecution({ name, result });
        return result;
      } catch (error) {
        recordToolExecution({
          name,
          result: { success: false, error: errorMessage(error) },
        });
        throw error;
      } finally {
        if (typeof release === "function") {
          try {
            await release();
          } catch (error) {
            // A write may already be committed. Fence cleanup must never turn
            // that success into a retryable tool failure; Redis TTL is backup.
            console.error("[ai/chat/stream] tool fence cleanup failed", error);
          }
        }
      }
    };
  }
  return tools;
}

/**
 * LLMs pad tool calls with empty values for fields they were never asked to change:
 * a request to swap one tag arrives as {add_labels:["AI"], remove_labels:["old"], labels:[], description:""}.
 * Because `[]` and `""` are not `undefined`, the tools read that padding as intent and
 * wipe the task's labels and description. An omitted field and a "clear this field"
 * instruction are indistinguishable once the model pads, so the safe reading is
 * "field not supplied". Clearing is still reachable through the explicit paths
 * (remove_labels for tags, due_date: null for dates).
 */
function dropEmptyPadding<T extends Record<string, unknown>>(
  input: T,
  fields: (keyof T)[]
): T {
  const cleaned = { ...input };
  for (const field of fields) {
    const value = cleaned[field];
    const empty =
      (typeof value === "string" && value.trim() === "") ||
      (Array.isArray(value) && value.length === 0);
    if (empty) delete cleaned[field];
  }
  return cleaned;
}

/** Wraps a tool's execute so an unhandled throw becomes a tool-visible error instead of aborting the whole chat turn. */
function withToolErrors<T extends (...args: any[]) => Promise<any>>(fn: T): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  }) as T;
}

type ResolvedToolTask = NonNullable<Awaited<ReturnType<typeof findTaskByIdentifier>>>;
type ResolveTaskForToolResult =
  | { task: ResolvedToolTask; error?: never }
  | { task: null; error?: string };

async function resolveTaskForTool(
  user: AuthedUser,
  input: ToolTaskIdentifierInput
): Promise<ResolveTaskForToolResult> {
  const ticketNumber = input.ticket_number?.trim();
  const hasTaskId = input.task_id != null;
  const hasTicketNumber = Boolean(ticketNumber);
  const hasUniqueIndex = input.unique_index != null;
  const hasProjectId = input.project_id != null;
  const triedIdentifiers: string[] = [];

  if (!hasTaskId && !hasTicketNumber && !hasUniqueIndex) {
    const validation = validateTaskIdentifier({
      task_id: input.task_id,
      ticket_number: ticketNumber,
      unique_index: input.unique_index,
      project_id: input.project_id,
    });
    return { task: null, error: validation.error };
  }

  if (hasTaskId || ticketNumber) {
    if (hasTaskId) triedIdentifiers.push(`task_id=${input.task_id}`);
    if (ticketNumber) {
      triedIdentifiers.push(
        hasProjectId
          ? `ticket_number=${ticketNumber}, project_id=${input.project_id}`
          : `ticket_number=${ticketNumber}`
      );
    }

    try {
      const ticketMatch = ticketNumber
        ? await findTaskByIdentifier(user, {
            ticket_number: ticketNumber,
            ...(hasProjectId ? { project_id: input.project_id } : {}),
          })
        : null;
      const taskMatch = hasTaskId
        ? await findTaskByIdentifier(user, {
            task_id: input.task_id,
            ...(hasProjectId ? { project_id: input.project_id } : {}),
          })
        : null;
      const unscopedTaskMatch =
        hasTaskId && hasProjectId && !taskMatch
          ? await findTaskByIdentifier(user, { task_id: input.task_id })
          : null;
      const decision = decideTaskIdentifierMatch({
        taskId: hasTaskId ? input.task_id : undefined,
        ticketNumber,
        projectId: hasProjectId ? input.project_id : undefined,
        taskMatch,
        ticketMatch,
        unscopedTaskMatch,
      });
      if (decision.error) return { task: null, error: decision.error };
      if (decision.match) return { task: decision.match };
    } catch (error) {
      if (error instanceof TaskIdentifierAmbiguityError) {
        return { task: null, error: error.message };
      }
      throw error;
    }
  }

  if (hasUniqueIndex && hasProjectId) {
    triedIdentifiers.push(
      `unique_index=${input.unique_index}, project_id=${input.project_id}`
    );
    const task = await findTaskByIdentifier(user, {
      unique_index: input.unique_index,
      project_id: input.project_id,
    });
    if (task) return { task };
  }

  if (hasUniqueIndex && !hasProjectId && !hasTaskId && !hasTicketNumber) {
    const validation = validateTaskIdentifier({
      unique_index: input.unique_index,
      project_id: input.project_id,
    });
    if (!validation.valid) return { task: null, error: validation.error };
  }

  return {
    task: null,
    error: `Task not found or access denied. Tried identifiers: ${triedIdentifiers.join("; ")}. None of these matched a task you can access. Call hypertask_search_tasks for the task title, then copy the \`task_id\` field from the result verbatim -- do not derive identifiers from task titles.`,
  };
}

function claudeAcceptsTemperature(model: string | null | undefined) {
  const normalized = String(model || "").toLowerCase();
  return !CLAUDE_TEMPERATURE_UNSUPPORTED_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix)
  );
}

function selectionFromModelOption(option: TAiModelOption): {
  provider: ProviderId;
  model: string;
  modelOption: TAiModelOption;
} {
  return {
    provider: option.source,
    model: option.model,
    modelOption: option,
  };
}

type ModelSelection = {
  provider: ProviderId;
  model: string;
  modelOption?: TAiModelOption;
};

function defaultModelSelection(
  settings?: unknown,
  feature: UserFacingModelFeature = "aiChat",
  personalModelOptionId?: string | null,
  customEndpointConfigured = true,
  defaultModelOption = defaultAiModelOption,
) {
  const option = resolveUserFacingModelOption(
    feature,
    settings,
    personalModelOptionId,
    { customEndpointConfigured, defaultModelOption },
  );
  if (!option) throw new Error("This AI feature is turned off for your team");
  return selectionFromModelOption(filterModelOptionForTeam(option, settings));
}

function normalizeProviderId(provider: string | null | undefined): ProviderId {
  const source = String(provider ?? "").trim().toLowerCase();
  if (
    source === "claude" ||
    source === "openai" ||
    source === "openrouter" ||
    source === "gateway" ||
    source === "custom"
  ) {
    return source;
  }
  return DEFAULT_PROVIDER;
}

function resolveModelSelection(
  providerInput: string | null | undefined,
  modelInput: string | null | undefined,
  modelOptionId: string | null | undefined,
  settings: unknown,
  feature: UserFacingModelFeature,
  personalModelOptionId: string | null,
  defaultModelOption: TAiModelOption,
): ModelSelection {
  const provider = normalizeProviderId(providerInput);
  const requestedModel = modelInput?.trim();

  if (provider === "openrouter" && requestedModel) {
    return { provider, model: requestedModel };
  }

  const modelOption =
    getAiModelOptionById(modelOptionId) ?? getAiModelOptionById(requestedModel);
  if (modelOption) return selectionFromModelOption(modelOption);

  return defaultModelSelection(
    settings,
    feature,
    personalModelOptionId,
    true,
    defaultModelOption,
  );
}

function selectModel(
  provider: ProviderId,
  modelId: string | null | undefined,
  byokCredential: AiModelCredential | undefined,
  modelOption?: TAiModelOption,
  tags?: AiGatewayTags
): {
  model: LanguageModel;
  settings: { temperature?: number; maxOutputTokens?: number };
  providerOptions?: AiProviderOptions;
  usageProvider: string;
  resolvedModelId: string;
} {
  const requestedModel = modelId?.trim();
  const usageProvider = aiUsageProviderForCredential(
    provider,
    byokCredential,
    modelOption
  );

  switch (provider) {
    case "claude": {
      const model =
        requestedModel && CLAUDE_MODELS.has(requestedModel)
          ? requestedModel
          : DEFAULT_CLAUDE_MODEL;
      const aiModel = resolveAiModel(provider, model, byokCredential);
      return {
        model: aiModel,
        resolvedModelId: model,
        usageProvider,
        settings: claudeAcceptsTemperature(model) ? { temperature: 0.2 } : {},
        providerOptions: providerOptionsForAiModel(
          aiModel,
          "chat",
          tags,
          modelOption
        ),
      };
    }
    case "openai": {
      const model =
        requestedModel && OPENAI_MODELS.has(requestedModel)
          ? requestedModel
          : DEFAULT_MODEL;
      const aiModel = resolveAiModel(provider, model, byokCredential);
      return {
        model: aiModel,
        resolvedModelId: model,
        usageProvider,
        settings: {
          temperature: model.toLowerCase().startsWith("gpt-5") ? 1 : 0.2,
        },
        providerOptions: providerOptionsForAiModel(
          aiModel,
          "chat",
          tags,
          modelOption
        ),
      };
    }
    case "openrouter": {
      const model = requestedModel || DEFAULT_MODEL;
      const aiModel = resolveAiModel(provider, model, byokCredential);
      return {
        model: aiModel,
        resolvedModelId: model,
        usageProvider,
        settings: { temperature: 0.2, maxOutputTokens: 16000 },
        providerOptions: providerOptionsForAiModel(aiModel, "chat", tags),
      };
    }
    case "gateway": {
      const model = requestedModel || defaultAiModelOption.model;
      const aiModel = resolveAiModel(
        provider,
        model,
        byokCredential,
        modelOption
      );
      return {
        model: aiModel,
        resolvedModelId: model,
        usageProvider,
        settings: { temperature: 0.2, maxOutputTokens: 16000 },
        providerOptions: providerOptionsForAiModel(
          aiModel,
          "chat",
          tags,
          modelOption
        ),
      };
    }
    case "custom": {
      if (!isCustomEndpointConfig(byokCredential)) {
        throw new Error("A complete custom endpoint is required");
      }
      return {
        model: resolveAiModel(provider, "custom", byokCredential),
        resolvedModelId: byokCredential.modelId,
        usageProvider,
        settings: { temperature: 0.2, maxOutputTokens: 16000 },
      };
    }
  }
}

function formatTemporalContext(timezone = "UTC") {
  const now = new Date();
  const formattedDisplay = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(now);
  const dayOfWeek = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
  }).format(now);
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      hour12: false,
    }).format(now)
  );
  const month = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      month: "numeric",
    }).format(now)
  );
  const timePeriod =
    hour >= 5 && hour < 12
      ? "morning"
      : hour >= 12 && hour < 17
        ? "afternoon"
        : hour >= 17 && hour < 21
          ? "evening"
          : "night";
  const season =
    month === 12 || month <= 2
      ? "winter"
      : month <= 5
        ? "spring"
        : month <= 8
          ? "summer"
          : "fall";
  const weekend = dayOfWeek === "Saturday" || dayOfWeek === "Sunday";

  return (
    "<system-reminder>\n" +
    `Today's Date & Time: ${formattedDisplay}\n` +
    `Day of Week: ${dayOfWeek}\n` +
    `Time Period: ${timePeriod}\n` +
    `Season: ${season}\n` +
    `Timezone: ${timezone}\n` +
    `Weekend: ${weekend ? "Yes" : "No"}\n` +
    "</system-reminder>"
  );
}

function formatChatHistory(chatHistory: ChatRequest["chat_history"]) {
  if (!chatHistory?.length) return "No previous conversation.";
  const messages = chatHistory
    .slice(-15)
    .map((message, index) => ({
      index,
      role: message.role?.toLowerCase() === "assistant" ? "assistant" : "human",
      content: message.content || "",
    }))
    .filter((message) => message.content.trim().length > 0);

  if (messages.length === 0) return "No readable conversation history.";

  const immediate = messages.slice(-3);
  const recent = messages.slice(Math.max(0, messages.length - 10), -3);
  const earlier = messages.slice(0, Math.max(0, messages.length - 10));
  const parts: string[] = [];

  parts.push("=== CURRENT TIME CONTEXT ===");
  parts.push(`[Current Time: ${new Date().toISOString()}]`);
  parts.push("");

  if (immediate.length) {
    parts.push("=== IMMEDIATE CONVERSATIONAL CONTEXT ===");
    parts.push("(This is the most important context for your response)");
    immediate.forEach((message, index) => {
      const roleLabel =
        message.role === "assistant"
          ? "YOU JUST RESPONDED"
          : index === immediate.length - 1
            ? "USER IS NOW ASKING"
            : "USER ASKED";
      parts.push(`${roleLabel}: ${message.content}`);
    });
    parts.push("");
  }

  if (recent.length) {
    parts.push("=== RECENT CONVERSATION HISTORY ===");
    recent.forEach((message) => {
      const roleLabel = message.role === "assistant" ? "YOU SAID" : "USER SAID";
      parts.push(`${roleLabel}: ${message.content}`);
    });
    parts.push("");
  }

  if (earlier.length) {
    parts.push("=== EARLIER CONVERSATION ===");
    earlier.slice(-6).forEach((message) => {
      const roleLabel = message.role === "assistant" ? "YOU" : "USER";
      parts.push(`[${roleLabel}]: ${message.content}`);
    });
  }

  return parts.join("\n");
}

// Raise the provider's reasoning effort for a retry after an empty completion.
// Instant/low effort is the usual cause of an empty agentic completion.
function withHigherEffort(
  providerOptions: Record<string, Record<string, any>> | undefined
): Record<string, Record<string, any>> | undefined {
  if (!providerOptions) return providerOptions;
  const next: Record<string, Record<string, any>> = { ...providerOptions };
  if (next.openai) {
    next.openai = { ...next.openai, reasoningEffort: "high" };
  }
  if (next.anthropic) {
    next.anthropic = {
      ...next.anthropic,
      effort: "high",
      thinking: { type: "adaptive" },
    };
  }
  return next;
}

function stringifyForPrompt(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function createDocumentContext(body: ChatRequest) {
  const files = [
    ...(body.images64 ?? []),
    ...(body.pdfs64 ?? []),
    ...(body.docx64 ?? []),
  ];
  if (files.length === 0) return "";
  return files
    .map((file) => {
      const type = file.mimeType || "unknown";
      const name = file.fileName || "unnamed attachment";
      return `- ${name} (${type})`;
    })
    .join("\n");
}

function createUserPrompt(
  body: ChatRequest,
  authedUser: AuthedUser,
  currentTaskContext: string
) {
  return `
                ${formatTemporalContext()}
                ${
                  currentTaskContext
                    ? `\n                CURRENT TICKET CONTEXT (the ticket the user is viewing — read this before answering questions about "this ticket"; do NOT search for it):\n${currentTaskContext}\n`
                    : ""
                }
                User query: ${body.message}
                CHAT HISTORY: ${formatChatHistory(body.chat_history)}
                context_list: ${stringifyForPrompt(body.context_list)}
                default_context: ${stringifyForPrompt(body.default_context)}
                user_context: ${stringifyForPrompt({
                  id: authedUser.id,
                  email: authedUser.email,
                  displayName: authedUser.displayName,
                })}
                document_context: ${createDocumentContext(body)}

                IMPORTANT: Analyze the history and provide a complete, context-aware HTML body response.
                IMPORTANT: Follow the tool selection hierarchy strictly.
                IMPORTANT: User context is provided already. If you want to know more about the user's boards, then use the list_boards tool.
                IMPORTANT: Take into account the documents and images provided by the user.
            `;
}

function parseDataUrl(url: string) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(url);
  if (!match) return null;
  return {
    mediaType: match[1] || "application/octet-stream",
    isBase64: Boolean(match[2]),
    data: match[3] || "",
  };
}

function filePartFromAttachment(
  attachment: z.infer<typeof attachmentSchema>
): FilePart | null {
  if (!attachment.url) return null;
  const mediaType = attachment.mimeType || "application/octet-stream";
  const dataUrl = parseDataUrl(attachment.url);
  if (dataUrl?.isBase64) {
    return {
      type: "file",
      mediaType: attachment.mimeType || dataUrl.mediaType,
      filename: attachment.fileName,
      data: { type: "data", data: dataUrl.data },
    };
  }

  try {
    return {
      type: "file",
      mediaType,
      filename: attachment.fileName,
      data: new URL(attachment.url),
    };
  } catch {
    return null;
  }
}

function createUserContent(
  body: ChatRequest,
  authedUser: AuthedUser,
  currentTaskContext: string
): UserContent {
  const prompt = createUserPrompt(body, authedUser, currentTaskContext);
  const fileParts = [
    ...(body.images64 ?? []),
    ...(body.pdfs64 ?? []),
    ...(body.docx64 ?? []),
  ]
    .map(filePartFromAttachment)
    .filter((part): part is FilePart => part !== null);

  if (fileParts.length === 0) return prompt;
  return [{ type: "text", text: prompt }, ...fileParts];
}

function sanitizeForJson<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, raw) =>
      typeof raw === "bigint" ? raw.toString() : raw
    )
  ) as T;
}

// Every rich-text value the chat persists (comments, drafts, descriptions) goes through
// here first. Asking the model for HTML is not enough — it drifts back to markdown and
// the raw asterisks end up in the comment (HTPR-4687), so the conversion is forced.
async function getAccessibleProjectIds(userId: number) {
  const projects = await prisma.project.findMany({
    where: {
      status: "Normal",
      ...getProjectWhere(userId),
    },
    select: { id: true },
  });
  return projects.map((project) => project.id);
}

async function assertAccessibleProject(userId: number, projectId: number) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      status: "Normal",
      ...getProjectWhere(userId),
    },
    select: { id: true },
  });
  return Boolean(project);
}

/** Builds an IUser-shaped object for activity/notification helpers that require one. */
function buildActivityUser(userObj: {
  id: number;
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
}): IUser {
  return {
    id: userObj.id,
    email: userObj.email ?? undefined,
    displayName: userObj.displayName ?? undefined,
    photoURL: userObj.photoURL ?? undefined,
    uid: "",
    stripe_customer_id: "",
    joinedAt: new Date(),
    UserSettingId: "",
    UserSetting: {} as IUser["UserSetting"],
  };
}

/**
 * When this ChatSession targets a native agent, loads its prompt so the model
 * can be instructed to act as that agent, and its id so the write tools can
 * attribute the mutations they make to the agent instead of the human user.
 * Ownership is re-checked here (not just trusted from session creation) since
 * this is the boundary that decides whose identity mutations are stamped with.
 */
/**
 * No try/catch: a query error here is indistinguishable from "this session
 * has an agent" (we simply don't know yet), so swallowing it to null would
 * silently attribute a real agent's writes to the human on a DB hiccup.
 * Errors propagate to the existing top-level stream catch, same as every
 * other lookup in this request (dbUser, task context, etc).
 */
async function loadActingAgent(
  sessionId: string | undefined,
  userId: number
): Promise<{
  id: string;
  displayName: string;
  prompt: string | null;
  modelOptionId: string | null;
} | null> {
  if (!sessionId) return null;

  const session = await prisma.chatSession.findFirst({
    where: { id: sessionId, userId },
    select: { agentId: true },
  });
  if (!session?.agentId) return null;

  return prisma.agent.findFirst({
    where: {
      id: session.agentId,
      userId,
      runtimeType: "NATIVE",
      revokedAt: null,
    },
    select: {
      id: true,
      displayName: true,
      prompt: true,
      modelOptionId: true,
    },
  });
}

/** Creates, updates, or clears a task's Priority row and logs the activity (mirrors src/pages/api/priority/setPriority.ts). */
async function applyPriorityUpdate(
  taskId: number,
  priorityValue: string,
  userId: number,
  activityUser: IUser
): Promise<{ error: string | null }> {
  const constant = PriorityConstants.find((p) => p.Priority_Value === priorityValue);
  if (!constant) return { error: `Invalid priority "${priorityValue}"` };

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { priority: true },
  });
  if (!task) return { error: "Task not found" };

  if (constant.priority_index === 0) {
    if (task.priority) {
      await prisma.priority.deleteMany({ where: { taskId } });
      await createPriorityActivity({
        userObj: activityUser,
        taskId,
        toPriority: { priority_index: 0, Priority_Value: "No Priority" },
        fromPriority: {
          priority_index: task.priority.priority_index,
          Priority_Value: task.priority.Priority_Value,
        },
      });
    }
    return { error: null };
  }

  if (!task.priority) {
    const priority = await prisma.priority.create({
      data: {
        taskId,
        sectionId: task.sectionId ?? -1,
        projectId: task.projectId,
        addedByUserId: userId,
        priority_index: constant.priority_index,
        Priority_Value: constant.Priority_Value,
      },
    });
    await createPriorityActivity({
      userObj: activityUser,
      taskId,
      toPriority: {
        priority,
        priority_index: constant.priority_index,
        Priority_Value: constant.Priority_Value,
      },
    });
  } else if (task.priority.priority_index !== constant.priority_index) {
    const updated = await prisma.priority.update({
      where: { id: task.priority.id },
      data: {
        addedByUserId: userId,
        priority_index: constant.priority_index,
        Priority_Value: constant.Priority_Value,
      },
    });
    await createPriorityActivity({
      userObj: activityUser,
      taskId,
      toPriority: {
        priority: updated,
        priority_index: constant.priority_index,
        Priority_Value: constant.Priority_Value,
      },
      fromPriority: {
        priority: task.priority,
        priority_index: task.priority.priority_index,
        Priority_Value: task.priority.Priority_Value,
      },
    });
  }
  return { error: null };
}

/** Creates, updates, or clears a task's Estimate row and logs the activity (mirrors src/pages/api/estimate/setEstimate.ts). */
async function applyEstimateUpdate(
  taskId: number,
  estimateIndex: number,
  userId: number,
  activityUser: IUser
): Promise<{ error: string | null }> {
  const constant = EstimateConstants.find(
    (estimate) => estimate.estimate_index === estimateIndex
  );
  if (!constant) return { error: `Invalid estimate "${estimateIndex}"` };

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { estimate: true },
  });
  if (!task) return { error: "Task not found" };

  if (constant.estimate_index === 0) {
    if (task.estimate) await prisma.estimate.deleteMany({ where: { taskId } });
    return { error: null };
  }

  if (!task.estimate) {
    const estimate = await prisma.estimate.create({
      data: {
        taskId,
        sectionId: task.sectionId ?? -1,
        projectId: task.projectId,
        addedByUserId: userId,
        estimate_index: constant.estimate_index,
        estimate_value: constant.estimate_value,
      },
    });
    await createEstimateActivity({
      fromUser: activityUser,
      taskId,
      toEstimate: {
        estimate,
        estimate_index: constant.estimate_index,
        estimate_value: constant.estimate_value,
      },
    });
  } else if (task.estimate.estimate_index !== constant.estimate_index) {
    const updated = await prisma.estimate.update({
      where: { id: task.estimate.id },
      data: {
        addedByUserId: userId,
        estimate_index: constant.estimate_index,
        estimate_value: constant.estimate_value,
        updatedAt: new Date(),
      },
    });
    await createEstimateActivity({
      fromUser: activityUser,
      taskId,
      toEstimate: {
        estimate: updated,
        estimate_index: constant.estimate_index,
        estimate_value: constant.estimate_value,
      },
      fromEstimate: {
        estimate: task.estimate,
        estimate_index: task.estimate.estimate_index,
        estimate_value: task.estimate.estimate_value,
      },
    });
  }
  return { error: null };
}

function normalizePriorityInput(priority?: string | string[]) {
  if (!priority) return undefined;
  return Array.isArray(priority) ? priority : [priority];
}

function mapTaskToMcpGetResponse(task: any, userId: number) {
  const mapped = mapTaskToMcpGetResponseBase(task, userId);
  type TaskReference = { id: number } & Record<string, unknown>;
  const parentTask = (mapped as { parent_task?: TaskReference }).parent_task;
  const subTasks = (mapped as { sub_tasks?: TaskReference[] }).sub_tasks;

  return {
    ...mapped,
    task_id: task.id,
    parent_task: parentTask
      ? { ...parentTask, task_id: parentTask.id }
      : parentTask,
    sub_tasks: subTasks?.map((subTask) => ({
      ...subTask,
      task_id: subTask.id,
    })),
  };
}

function mapTaskToDetail(task: any, userId: number) {
  return {
    ...mapTaskToDetailBase(task, userId),
    task_id: task.id,
  };
}

function mapTaskSearchItem(task: any, userId: number) {
  const agent = mapVisibleMcpAgent(task.agent, userId);
  return {
    id: task.id,
    task_id: task.id,
    ticketNumber: task.ticketNumber || undefined,
    uniqueIndex: task.uniqueIndex,
    // Ready-made board-relative link. Use this verbatim for links; never build
    // the path from `id` (global DB id, not the ticket number).
    url: `/detail/project-${task.projectId}/${task.uniqueIndex}`,
    title: task.title,
    // Descriptions carry inline base64 images for the same reason comments do.
    description: stripInlineDataUris(task.description),
    boardId: task.projectId,
    boardTitle: task.project.title || "",
    projectId: task.projectId,
    section: task.section,
    dueDate: task.dueDate?.toISOString() || undefined,
    createdAt: task.createdAt.toISOString(),
    ...(agent ? { agent } : {}),
  };
}

// A comment written in the editor can carry an image inline as a base64 data
// URI. Those are megabytes of text, and the model was being handed them whole,
// which is what produced "prompt is too large" whenever a comment held a
// screenshot (HTPR-3494). The image itself is still reachable through the
// comment's attachments, so the model loses nothing by seeing a marker here.
const stripInlineDataUris = (html: string) =>
  typeof html === "string"
    ? html.replace(/\bdata:[^;,\s"')]+;base64,[A-Za-z0-9+/=]+/g, "[inline image]")
    : html;

function mapCommentToResponse(comment: any, userId: number) {
  const agent = mapVisibleMcpAgent(comment.agent, userId);
  const hasAgentAttribution = Boolean(comment.agent || comment.agentDisplayName);
  const text = stripInlineDataUris(comment.text);
  return {
    id: comment.id,
    text,
    commentText: comment.commentText || text,
    createdAt: comment.createdAt.toISOString(),
    creatorId: comment.creatorId || undefined,
    creator: comment.creator
      ? {
          id: comment.creator.id,
          email: comment.creator.email,
          displayName: comment.creator.displayName || undefined,
        }
      : undefined,
    ...(agent ? { agent } : {}),
    ...(hasAgentAttribution
      ? { agent_display_name: agent?.displayName || "Private agent" }
      : {}),
    attachments: (comment.attachments ?? []).map((attachment: any) => ({
      id: attachment.id,
      fileName: attachment.fileName || "",
      fileType: attachment.fileType,
      fileSize: attachment.fileSize
        ? typeof attachment.fileSize === "string"
          ? parseInt(attachment.fileSize) || 0
          : attachment.fileSize
        : 0,
      fileSource: attachment.fileSource || "",
    })),
    reactions: (comment.reactions ?? []).map((reaction: any) => ({
      id: reaction.id,
      emoji: reaction.emoji,
      userId: reaction.userId,
    })),
  };
}

function mapDraftToResponse(draft: any) {
  return {
    id: draft.id,
    taskId: draft.taskId,
    ticketNumber: draft.task?.ticketNumber || undefined,
    draftType: String(draft.type || "").toLowerCase(),
    text: draft.content || "",
    status: "Draft",
    updatedAt:
      draft.updatedAt instanceof Date ? draft.updatedAt.toISOString() : draft.updatedAt,
    createdBy: draft.user
      ? {
          id: draft.user.id,
          email: draft.user.email,
          displayName: draft.user.displayName || undefined,
        }
      : undefined,
  };
}

function userHasProjectAccess(
  project: { ownerId?: number | null; members?: { userId: number }[] } | null | undefined,
  userId: number
) {
  return Boolean(
    project &&
      (project.ownerId === userId ||
        project.members?.some((member) => member.userId === userId))
  );
}

async function findDraftWithAccess(draftId: number) {
  return prisma.drafts.findUnique({
    where: { id: draftId },
    include: {
      task: {
        include: {
          project: {
            select: {
              ownerId: true,
              members: { select: { userId: true } },
            },
          },
        },
      },
      user: { select: { id: true, email: true, displayName: true } },
    },
  });
}

async function validateMentionUsers(
  projectId: number,
  mentions:
    | {
        user_id: number;
        display_name: string;
      }[]
    | undefined
) {
  if (!mentions?.length) return null;
  return validateMentionUserIds(
    projectId,
    mentions.map((mention) => mention.user_id)
  );
}

async function validateMentionUserIds(projectId: number, userIds: number[]) {
  if (userIds.length === 0) return null;
  const allowedMemberIds = await getMemberAndOwner(projectId);
  if (typeof allowedMemberIds === "string") {
    return "Could not resolve project members";
  }
  const allowedSet = new Set<number>(allowedMemberIds);
  const invalidUserIds = [...new Set(userIds)].filter((id) => !allowedSet.has(id));
  if (invalidUserIds.length > 0) {
    return `Mentioned user(s) ${invalidUserIds.join(", ")} are not members of this project.`;
  }
  return null;
}

const CHAT_ATTACHMENT_EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "application/pdf": ".pdf",
  "text/markdown": ".md",
  "text/plain": ".txt",
};

function deriveChatAttachmentFilename(
  urlString: string,
  contentType: string,
  index: number
) {
  try {
    const lastSegment = new URL(urlString).pathname
      .split("/")
      .filter(Boolean)
      .pop();
    if (lastSegment) {
      const decoded = decodeURIComponent(lastSegment).trim();
      if (
        decoded &&
        decoded.length <= 255 &&
        !decoded.includes("/") &&
        !decoded.includes("\\") &&
        !decoded.includes("..")
      ) {
        return decoded;
      }
    }
  } catch {
    // Fall through to a deterministic filename; URL validity is enforced below.
  }

  return `attachment-${index + 1}${
    CHAT_ATTACHMENT_EXTENSION_BY_MIME[normalizeMime(contentType)] || ""
  }`;
}

type TaskTreeNode = {
  id: number;
  task_id: number;
  ticketNumber?: string;
  title: string;
  uniqueIndex?: number;
  children?: TaskTreeNode[];
};

const MAX_TREE_ANCESTOR_HOPS = 256;

async function findRootTaskIdForTree(
  anchorTaskId: number,
  userId: number
): Promise<{ rootId: number } | { error: string }> {
  const visited = new Set<number>();
  let currentId = anchorTaskId;

  for (let hop = 0; hop < MAX_TREE_ANCESTOR_HOPS; hop++) {
    if (visited.has(currentId)) {
      return { error: "Invalid parent chain (cycle detected)" };
    }
    visited.add(currentId);

    const task = await prisma.task.findFirst({
      where: {
        id: currentId,
        project: getProjectWhere(userId),
      },
      select: { id: true, parentTaskId: true },
    });

    if (!task) {
      return { error: "Task not found or access denied" };
    }

    if (task.parentTaskId == null) {
      return { rootId: task.id };
    }

    currentId = task.parentTaskId;
  }

  return { error: "Parent chain exceeds maximum depth" };
}

async function buildTaskTreeNode(
  taskId: number,
  userId: number,
  remainingDepth: number | undefined
): Promise<TaskTreeNode> {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      project: getProjectWhere(userId),
    },
    select: {
      id: true,
      ticketNumber: true,
      title: true,
      uniqueIndex: true,
    },
  });

  if (!task) {
    throw new Error("Task not found in tree build");
  }

  const node: TaskTreeNode = {
    id: task.id,
    task_id: task.id,
    title: task.title,
  };
  if (task.ticketNumber) node.ticketNumber = task.ticketNumber;
  if (task.uniqueIndex !== undefined && task.uniqueIndex !== null) {
    node.uniqueIndex = task.uniqueIndex;
  }

  if (remainingDepth === 0) {
    return node;
  }

  const childrenRows = await prisma.task.findMany({
    where: {
      parentTaskId: taskId,
      status: { not: "Deleted" },
      project: getProjectWhere(userId),
    },
    select: { id: true },
    orderBy: { uniqueIndex: "asc" },
  });

  if (childrenRows.length === 0) {
    return { ...node, children: [] };
  }

  const nextDepth =
    remainingDepth === undefined ? undefined : remainingDepth - 1;
  const children = await Promise.all(
    childrenRows.map((row) => buildTaskTreeNode(row.id, userId, nextDepth))
  );

  return { ...node, children };
}

function isoDate(value: unknown) {
  return value instanceof Date ? value.toISOString() : value ?? undefined;
}

function mapViewToResponse(view: any, projectView: any, includeSettings = false) {
  const response: Record<string, unknown> = {
    id: view.id,
    title: view.title || "",
    slug: view.slug ?? null,
    url:
      view.slug && projectView?.project?.id
        ? getViewUrl(projectView.project.id, view.slug)
        : null,
    visibility: view.visibility,
    createdAt: isoDate(view.createdAt),
    lastUsedAt: view.ViewLastUsed?.[0]?.lastUsedAt
      ? isoDate(view.ViewLastUsed[0].lastUsedAt)
      : isoDate(view.lastUsedAt),
    owner: view.owner
      ? {
          id: view.owner.id,
          email: view.owner.email,
          displayName: view.owner.displayName || undefined,
        }
      : undefined,
    project: projectView?.project
      ? {
          id: projectView.project.id,
          name: projectView.project.name,
          title: projectView.project.title || undefined,
        }
      : undefined,
    is_default: projectView?.default_view_id === view.id,
    board_sorting_stack: view.board_sorting_stack,
  };

  if (includeSettings) {
    response.board_sorting_mode = view.board_sorting_mode;
    response.board_sorting_order = view.board_sorting_order;
    response.board_filters = sanitizeBoardFilters(view.board_filters) || undefined;
    response.board_columns_view = view.board_columns_view || undefined;
    response.board_subtask_setting = view.board_subtask_setting;
    response.board_empty_sections = view.board_empty_sections;
  }

  return response;
}

function buildTools(
  user: AuthedUser,
  body: ChatRequest,
  send: SendSse,
  recordToolExecution: ToolExecutionRecorder,
  // Set when this ChatSession targets a native agent: mutations the model
  // makes (comments, assignments, moves, task creation) are attributed to
  // this agent instead of the human user driving the conversation.
  actingAgentId: string | null = null,
  recordToolStart?: ToolStartRecorder,
  heartbeatTurn?: HeartbeatTurnMetadata
): ToolSet {
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

  const tools: ToolSet = {
    hypertask_list_agents: tool({
      description:
        "List the signed-in user's managed agent identities and board memberships. Never returns credentials.",
      inputSchema: z.object({}).strict(),
      execute: withToolErrors(async () => {
        sendStatus("hypertask_list_agents");
        if (actingAgentId) {
          return { success: false, error: "Native agents cannot manage account credentials." };
        }
        return sanitizeForJson({
          success: true,
          agents: await listOwnedAgents(
            prisma as unknown as AgentManagementDatabase,
            user.id
          ),
        });
      }),
    }),

    hypertask_agent_webhook: tool({
      description:
        "Get or manage one agent's signed outbound webhook. Actions: get, configure, test, replay, rotate, delete. A native agent may use agent_id=self; otherwise use an owned agent UUID. Configure and rotate return the signing secret once. Every mutation requires confirmation in a later user message.",
      inputSchema: z
        .object({
          action: z
            .enum(["get", "configure", "test", "replay", "rotate", "delete"])
            .default("get"),
          agent_id: z.string().trim().min(1).default("self"),
          url: z.string().trim().url().max(2000).optional(),
          project_id: z.number().int().positive().nullable().optional(),
          events: z
            .array(
              z.enum([
                "comment.mention",
                "task.assigned",
                "task.unassigned",
                "comment.created",
                "task.updated",
                "task.created",
              ]),
            )
            .min(1)
            .optional(),
          active: z.boolean().optional(),
          delivery_id: z.string().uuid().optional(),
          confirmed: z.boolean().optional(),
        })
        .strict(),
      execute: withToolErrors(async ({ confirmed, ...input }) => {
        sendStatus("hypertask_agent_webhook");
        const agentId =
          input.agent_id === "self" ? actingAgentId : input.agent_id;
        if (!agentId) {
          return {
            success: false,
            error: "Use an owned agent UUID; self is only available in a native agent chat.",
          };
        }
        if (actingAgentId && agentId !== actingAgentId) {
          return {
            success: false,
            error: "A native agent can only manage its own webhook.",
          };
        }
        if (input.action !== "get") {
          const preview = await requireAccountManagementConfirmation(
            `agent-webhook:${input.action}`,
            { ...input, agent_id: agentId },
            confirmed,
            `This would ${input.action} the outbound webhook for agent ${agentId}.`,
          );
          if (preview) return preview;
        }
        return sanitizeForJson(
          await manageAgentWebhook({
            userId: user.id,
            agentId,
            action: input.action as AgentWebhookManagementAction,
            url: input.url,
            projectId: input.project_id,
            events: input.events,
            active: input.active,
            deliveryId: input.delivery_id,
          }),
        );
      }),
    }),

    hypertask_create_agent: tool({
      description:
        "Create an external agent identity and optionally add it to boards. The returned MCP token is shown once. Always preview and obtain confirmation in a later message.",
      inputSchema: z
        .object({
          display_name: z.string().trim().min(1).max(60),
          project_ids: z.array(z.number().int().positive()).max(100).default([]),
          role: z.enum(["read", "write", "admin"]).default("write"),
          confirmed: z.boolean().optional(),
        })
        .strict(),
      execute: withToolErrors(async ({ confirmed, ...input }) => {
        sendStatus("hypertask_create_agent");
        if (actingAgentId) {
          return { success: false, error: "Native agents cannot manage account credentials." };
        }
        const preview = await requireAccountManagementConfirmation(
          "create-agent",
          input,
          confirmed,
          `This would create external agent “${input.display_name}” with role ${input.role}.`
        );
        if (preview) return preview;
        return invokeAgentManagementHandler("create", input);
      }),
    }),

    hypertask_revoke_agent: tool({
      description:
        "Revoke an owned external agent and invalidate its MCP token. Always preview and obtain confirmation in a later message.",
      inputSchema: z
        .object({
          agent_id: z.string().trim().min(1),
          confirmed: z.boolean().optional(),
        })
        .strict(),
      execute: withToolErrors(async ({ confirmed, ...input }) => {
        sendStatus("hypertask_revoke_agent");
        if (actingAgentId) {
          return { success: false, error: "Native agents cannot manage account credentials." };
        }
        const preview = await requireAccountManagementConfirmation(
          "revoke-agent",
          input,
          confirmed,
          `This would revoke agent ${input.agent_id} and invalidate its token.`
        );
        if (preview) return preview;
        return invokeAgentManagementHandler("revoke", input);
      }),
    }),

    hypertask_mint_token: tool({
      description:
        "Mint a fresh account MCP bearer token for 1–365 days. The credential is shown once. Always preview and obtain confirmation in a later message.",
      inputSchema: z
        .object({
          expires_in_days: z.number().int().min(1).max(365).default(30),
          confirmed: z.boolean().optional(),
        })
        .strict(),
      execute: withToolErrors(async ({ confirmed, ...input }) => {
        sendStatus("hypertask_mint_token");
        if (actingAgentId) {
          return { success: false, error: "Native agents cannot manage account credentials." };
        }
        const preview = await requireAccountManagementConfirmation(
          "mint-token",
          input,
          confirmed,
          `This would mint a new ${input.expires_in_days}-day account MCP token.`
        );
        if (preview) return preview;
        return sanitizeForJson(
          mintAccountMcpToken(user, input.expires_in_days)
        );
      }),
    }),

    hypertask_revoke_token: tool({
      description:
        "Revoke one signed account MCP token, or all account MCP tokens with revoke_all=true. Always preview and obtain confirmation in a later message.",
      inputSchema: z
        .object({
          token: z.string().trim().min(1).max(8192).optional(),
          revoke_all: z.literal(true).optional(),
          confirmed: z.boolean().optional(),
        })
        .strict()
        .refine((value) => Boolean(value.token) !== Boolean(value.revoke_all), {
          message: "Provide exactly one of token or revoke_all=true",
        }),
      execute: withToolErrors(async ({ confirmed, ...input }) => {
        sendStatus("hypertask_revoke_token");
        if (actingAgentId) {
          return { success: false, error: "Native agents cannot manage account credentials." };
        }
        const preview = await requireAccountManagementConfirmation(
          "revoke-token",
          input,
          confirmed,
          input.revoke_all
            ? "This would revoke every account MCP token."
            : "This would revoke the supplied account MCP token."
        );
        if (preview) return preview;
        return revokeAccountMcpToken(user.id, input);
      }),
    }),

    hypertask_list_connections: tool({
      description:
        "List OAuth clients connected to the signed-in account, including the latest authorization and associated agent. Never returns credentials.",
      inputSchema: z.object({}).strict(),
      execute: withToolErrors(async () => {
        sendStatus("hypertask_list_connections");
        if (actingAgentId) {
          return { success: false, error: "Native agents cannot inspect account connections." };
        }
        return sanitizeForJson({
          success: true,
          connections: await listOwnedConnections(user.id),
        });
      }),
    }),

    hypertask_ask_agent: tool({
      description:
        "Ask one of the board's AI agents, which are domain experts with knowledge beyond the board such as wiki or compliance knowledge, a question.",
      inputSchema: z.object({
        agent_id: z.string(),
        question: z.string(),
      }),
      execute: async (input) => {
        try {
          sendStatus("hypertask_ask_agent");
          const boardId = Number(body.default_context?.project_id);

          if (!Number.isInteger(boardId) || boardId <= 0) {
            return {
              success: false,
              error: "No board context is available for this agent request.",
            };
          }

          // default_context comes from the client, so the caller's own access
          // to that board has to be proven before its agents are reachable.
          // This is the agent-specific check on purpose: assertAccessibleProject
          // also demands a team, which would lock owners out of legacy boards.
          if (!(await getAccessibleAgentBoard(boardId, user.id))) {
            return {
              success: false,
              error: "Board not found or access denied.",
            };
          }

          const boardAgents = await getBoardAgentMembers(boardId, user.id);
          if (!boardAgents.some((row) => row.agent.id === input.agent_id)) {
            return {
              success: false,
              error: "That agent is not a member of this board.",
            };
          }

          const url = process.env.AGENT_FLEET_ASK_URL;
          const secret = process.env.AGENT_FLEET_ASK_SECRET;
          if (!url || !secret) {
            return { success: false, error: "Agent bridge is not configured." };
          }

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 45_000);
          try {
            const response = await fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-fleet-ask-secret": secret,
              },
              body: JSON.stringify({
                agentId: input.agent_id,
                question: input.question,
                context: {
                  boardId,
                  taskId: body.default_context?.task_id,
                  requesterName: user.displayName || undefined,
                },
              }),
              signal: controller.signal,
            });

            if (!response.ok) {
              return {
                success: false,
                error: "The agent request failed.",
              };
            }

            const result = (await response.json()) as {
              success?: boolean;
              answer?: string;
            };
            if (
              !result.success ||
              typeof result.answer !== "string" ||
              !result.answer.trim()
            ) {
              return {
                success: false,
                error: "The agent returned a malformed response.",
              };
            }

            return { success: true, answer: result.answer };
          } catch (error) {
            console.error("[AI chat ask agent]", error);
            return {
              success: false,
              error:
                error instanceof Error && error.name === "AbortError"
                  ? "The agent did not respond in time."
                  : "The agent request failed.",
            };
          } finally {
            clearTimeout(timeout);
          }
        } catch (error) {
          console.error("[AI chat ask agent]", error);
          return { success: false, error: "The agent request failed." };
        }
      },
    }),

    hypertask_get_user_context: tool({
      description:
        "Get the current Hypertask user context, accessible teams, projects, labels, sections, and available agents.",
      inputSchema: z.object({}),
      execute: async () => {
        sendStatus("hypertask_get_user_context");
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: { accountId: true },
        });
        const [ownedTeams, memberRows, projects, agentsByUser] =
          await Promise.all([
            dbUser?.accountId
              ? prisma.team.findMany({
                  where: { googleAccountId: dbUser.accountId },
                  select: { id: true, title: true },
                })
              : [],
            prisma.member_Team.findMany({
              where: { userId: user.id, status: "Accepted" },
              include: {
                team: { select: { id: true, title: true } },
              },
            }),
            prisma.project.findMany({
              where: {
                status: "Normal",
                ...getProjectWhere(user.id),
              },
              select: {
                id: true,
                title: true,
                description: true,
                name: true,
                ownerId: true,
                owner: {
                  select: { id: true, email: true, displayName: true },
                },
                status: true,
                sections: true,
                section: {
                  select: { id: true, section_title: true },
                },
                labels: {
                  select: { id: true, value: true },
                },
                createdAt: true,
                _count: {
                  select: {
                    members: true,
                    tasks: { where: { status: "Normal" } },
                  },
                },
              },
              orderBy: { title: "asc" },
            }),
            prisma.agent.findMany({
              where: { userId: user.id },
              select: { id: true, displayName: true },
            }),
          ]);

        const teamById = new Map<string, { id: string; title?: string }>();
        ownedTeams.forEach((team) =>
          teamById.set(team.id, { id: team.id, title: team.title ?? undefined })
        );
        memberRows.forEach((row) => {
          if (row.team) {
            teamById.set(row.team.id, {
              id: row.team.id,
              title: row.team.title ?? undefined,
            });
          }
        });

        return sanitizeForJson({
          success: true,
          user: {
            id: user.id,
            email: user.email,
            displayName: user.displayName || undefined,
          },
          teams: Array.from(teamById.values()).sort((a, b) =>
            (a.title ?? a.id).localeCompare(b.title ?? b.id)
          ),
          projects: projects.map((project) => ({
            id: project.id,
            title: project.title || "",
            description: project.description || undefined,
            name: project.name,
            ownerId: project.ownerId,
            owner: project.owner
              ? {
                  id: project.owner.id,
                  email: project.owner.email,
                  displayName: project.owner.displayName || undefined,
                }
              : undefined,
            memberCount: project._count.members,
            taskCount: project._count.tasks,
            defaultSections: project.sections || [],
            sections: project.section,
            labels: (project.labels || []).map((label) => ({
              id: label.id,
              name: label.value || "",
            })),
            status: project.status,
            createdAt: project.createdAt.toISOString(),
          })),
          all_agents: agentsByUser.map((agent) => ({
            id: agent.id,
            displayName: agent.displayName,
          })),
        });
      },
    }),

    hypertask_update_profile: tool({
      description:
        "Update the signed-in human user's display name, profile photo URL, or both. This updates the same explicit profile-set flags as the settings and MCP surfaces. Agent-targeted chats cannot modify the human profile.",
      inputSchema: getUpdateProfileInputSchema(),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_update_profile");
        if (actingAgentId) {
          return {
            success: false,
            error: "Agent chats cannot modify the human account profile",
          };
        }

        const updated = await updateOwnProfile(user.id, input);
        if (!updated) {
          return { success: false, error: "User not found" };
        }
        return sanitizeForJson({
          success: true,
          user: {
            id: updated.id,
            email: user.email,
            displayName: updated.displayName,
            photoURL: updated.photoURL,
          },
        });
      }),
    }),

    hypertask_agent_presence: tool({
      description:
        "Show live agent status and current work for a team the current user belongs to or owns.",
      inputSchema: z.object({
        team_id: z.string().min(1),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_agent_presence");
        const teamId = input.team_id.trim();
        if (!teamId) {
          return { success: false, error: "team_id is required" };
        }

        const [dbUser, team] = await Promise.all([
          prisma.user.findUnique({
            where: { id: user.id },
            select: { id: true, accountId: true },
          }),
          prisma.team.findUnique({
            where: { id: teamId },
            select: { id: true, googleAccountId: true },
          }),
        ]);
        if (!dbUser) {
          return { success: false, error: "User not found" };
        }
        if (!team) {
          return { success: false, error: "Team not found" };
        }

        const membership = await prisma.member_Team.findFirst({
          where: {
            userId: user.id,
            teamId: team.id,
            status: "Accepted",
          },
          select: { id: true },
        });
        const ownsTeam =
          dbUser.accountId != null && dbUser.accountId === team.googleAccountId;
        if (!membership && !ownsTeam) {
          return {
            success: false,
            error: "User cannot view agent presence for this team",
          };
        }

        const agents = await getTeamAgentPresence(team.id);
        return sanitizeForJson({ success: true, agents });
      }),
    }),

    hypertask_list_projects: tool({
      description:
        "List projects/boards the authenticated user can access. Supports status, search, pagination, and sorting.",
      inputSchema: z.object({
        status: statusSchema.default("Normal"),
        search: z.string().max(200).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        sort_by: z.enum(["title", "createdAt", "updatedAt"]).default("title"),
        sort_order: sortOrderSchema.default("asc"),
      }),
      execute: async (input) => {
        sendStatus("hypertask_list_projects");
        const where: Prisma.ProjectWhereInput = {
          status: input.status,
          AND: [
            getProjectWhere(user.id),
            ...(input.search
              ? [
                  {
                    OR: [
                      { title: { contains: input.search, mode: "insensitive" } },
                      { name: { contains: input.search, mode: "insensitive" } },
                      {
                        description: {
                          contains: input.search,
                          mode: "insensitive",
                        },
                      },
                    ],
                  } satisfies Prisma.ProjectWhereInput,
                ]
              : []),
          ],
        };
        const orderBy: Prisma.ProjectOrderByWithRelationInput =
          input.sort_by === "createdAt"
            ? { createdAt: input.sort_order }
            : input.sort_by === "updatedAt"
              ? { id: input.sort_order }
              : { title: input.sort_order };
        const [total, projects] = await Promise.all([
          prisma.project.count({ where }),
          prisma.project.findMany({
            where,
            select: {
              id: true,
              title: true,
              description: true,
              name: true,
              ownerId: true,
              owner: { select: { id: true, email: true, displayName: true } },
              status: true,
              sections: true,
              section: { select: { id: true, section_title: true } },
              labels: { select: { id: true, value: true } },
              createdAt: true,
              _count: {
                select: {
                  members: true,
                  tasks: { where: { status: "Normal" } },
                },
              },
            },
            orderBy,
            take: input.limit,
            skip: input.offset,
          }),
        ]);

        return sanitizeForJson({
          success: true,
          projects: projects.map((project) => ({
            id: project.id,
            title: project.title || "",
            description: project.description || undefined,
            name: project.name,
            ownerId: project.ownerId,
            owner: project.owner
              ? {
                  id: project.owner.id,
                  email: project.owner.email,
                  displayName: project.owner.displayName || undefined,
                }
              : undefined,
            memberCount: project._count.members,
            taskCount: project._count.tasks,
            defaultSections: project.sections || [],
            sections: project.section,
            labels: (project.labels || []).map((label) => ({
              id: label.id,
              name: label.value || "",
            })),
            status: project.status,
            createdAt: project.createdAt.toISOString(),
          })),
          total,
          limit: input.limit,
          offset: input.offset,
        });
      },
    }),

    hypertask_board_manifest: tool({
      description:
        "Get a board's ordered columns, semantic column roles, and transition policy.",
      inputSchema: z.object({
        project_id: z.coerce.number().int().positive(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_board_manifest");
        const project = await prisma.project.findFirst({
          where: {
            id: input.project_id,
            status: "Normal",
            ...getProjectWhere(user.id),
          },
          select: {
            id: true,
            title: true,
            section: {
              where: { deleted: false, visibility: true },
              select: {
                id: true,
                section_title: true,
                isDone: true,
                ranking: true,
              },
              orderBy: { ranking: "asc" },
            },
          },
        });
        if (!project) {
          return { success: false, error: "Project not found or access denied" };
        }

        return sanitizeForJson({
          success: true,
          projectId: project.id,
          boardTitle: project.title || "",
          columns: project.section.map((section) => ({
            id: section.id,
            title: section.section_title,
            position: section.ranking,
            role: columnRoleFor(section),
            wipLimit: null,
          })),
          transitions: "any",
        });
      }),
    }),

    hypertask_get_board_playbook: tool({
      description:
        "Get a board's working rules and definition of done, or null when none is set.",
      inputSchema: z.object({
        project_id: z.coerce.number().int().positive(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_get_board_playbook");
        const project = await prisma.project.findFirst({
          where: {
            id: input.project_id,
            status: "Normal",
            ...getProjectWhere(user.id),
          },
          select: { id: true, playbook: true },
        });
        if (!project) {
          return { success: false, error: "Project not found or access denied" };
        }

        return sanitizeForJson({
          success: true,
          projectId: project.id,
          playbook: project.playbook ?? null,
        });
      }),
    }),

    hypertask_board_config: tool({
      description:
        "Read or set BOARD-WIDE AI instructions and playbook for an explicit board/project. Use get_playbook, set_playbook, get_instructions, or set_instructions. Setting either affects every user and agent on that board.",
      inputSchema: z
        .object({
          action: z.enum([
            "get_playbook",
            "set_playbook",
            "get_instructions",
            "set_instructions",
          ]),
          project_id: z.coerce.number().int().positive(),
          definition_of_done: z
            .array(z.string().max(500))
            .max(50)
            .optional(),
          working_rules: z.string().max(5000).optional(),
          notes: z.string().max(5000).optional(),
          custom_instruction: z
            .string()
            .optional()
            .describe("Required when action is set_instructions."),
          model_selected: z.string().optional(),
        })
        .strict(),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_board_config");
        await assertProjectAccess(user.id, input.project_id);

        if (input.action === "get_playbook") {
          const project = await prisma.project.findFirst({
            where: {
              id: input.project_id,
              status: "Normal",
              ...getProjectWhere(user.id),
            },
            select: { id: true, playbook: true },
          });
          if (!project) {
            return {
              success: false,
              error: "Project not found or access denied",
            };
          }

          return sanitizeForJson({
            success: true,
            projectId: project.id,
            playbook: project.playbook ?? null,
          });
        }

        if (input.action === "set_playbook") {
          const parsed = parseBoardPlaybook({
            definition_of_done: input.definition_of_done,
            working_rules: input.working_rules,
            notes: input.notes,
          });
          if (!parsed.ok) {
            return {
              success: false,
              error: parsed.error,
              code: "invalid_field",
              field: "playbook",
            };
          }

          const result = await prisma.project.updateMany({
            where: {
              id: input.project_id,
              status: "Normal",
              ...getProjectWhere(user.id),
            },
            data: { playbook: parsed.value as Prisma.InputJsonValue },
          });
          if (result.count === 0) {
            return {
              success: false,
              error: "Project not found or access denied",
            };
          }

          return {
            success: true,
            projectId: input.project_id,
            playbook: parsed.value,
          };
        }

        if (input.action === "get_instructions") {
          const instruction = await prisma.aI_Custom_Instructions.findFirst({
            where: { projectId: input.project_id },
            include: { attachments: true },
          });

          return sanitizeForJson({ success: true, instruction });
        }

        if (input.custom_instruction === undefined) {
          throw new Error("custom_instruction is required for set_instructions");
        }

        let modelOption;
        if (input.model_selected !== undefined) {
          modelOption = getAiModelOptionById(input.model_selected);
          if (!modelOption) {
            return {
              success: false,
              error: `Unknown model_selected "${input.model_selected}"`,
              details: { field: "model_selected", code: "invalid_value" },
            };
          }
        }

        const existing = await prisma.aI_Custom_Instructions.findFirst({
          where: { projectId: input.project_id },
          select: { id: true },
        });
        const modelData = modelOption
          ? {
              model_selected: modelOption.id,
              source_selected: modelOption.source,
            }
          : {};
        const instruction = existing
          ? await prisma.aI_Custom_Instructions.update({
              where: { id: existing.id },
              data: {
                customInstruction: input.custom_instruction,
                ...modelData,
                lastUpdatedAt: new Date(),
              },
              include: { attachments: true },
            })
          : await prisma.aI_Custom_Instructions.create({
              data: {
                projectId: input.project_id,
                customInstruction: input.custom_instruction,
                ...modelData,
              },
              include: { attachments: true },
            });

        return sanitizeForJson({ success: true, instruction });
      }),
    }),

    hypertask_project_admin: tool({
      description:
        "Archive or restore an owned board, or invite a human user or agent to an accessible board. project_id must be used verbatim as a board ID returned by a tool or explicitly identified as an ID by the user. Never infer a board from a name or from a number appearing in a board title. If the user names a board ambiguously, ask which board they mean instead of guessing. Archiving requires the board's exact title in expected_title as a safety check. Read that title from a tool result; never invent it. Archiving hides the board for everyone. Inviting grants the person or agent access to the board. Use action archive with status Archive to archive or Normal to restore; use invite_member with userToAdd set to a user ID, email, or agent UUID.",
      inputSchema: z
        .object({
          action: z.enum(["archive", "invite_member"]),
          project_id: z.coerce.number().int().positive(),
          status: z.enum(["Archive", "Normal"]).optional(),
          expected_title: z
            .string()
            .optional()
            .describe(
              "Required for archive. Use the board's exact title from a tool result; do not invent it."
            ),
          confirmed: z
            .boolean()
            .optional()
            .describe(
              "Set true ONLY after the user has explicitly approved this exact archive or restore in their own message. Never set it to confirm your own proposal."
            ),
          userToAdd: z
            .union([
              z.number().int().positive(),
              z
                .string()
                .trim()
                .min(1)
                .refine(
                  (value) =>
                    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ||
                    PROJECT_ADMIN_MEMBER_UUID_PATTERN.test(value),
                  "userToAdd must be an email address or agent UUID"
                ),
            ])
            .optional()
            .describe("Required when action is invite_member."),
        })
        .strict()
        .superRefine((input, ctx) => {
          if (
            input.action === "archive" &&
            (!input.expected_title || input.expected_title.trim().length === 0)
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "expected_title is required for archive",
              path: ["expected_title"],
            });
          }
          if (input.action === "invite_member" && input.userToAdd === undefined) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "userToAdd is required for invite_member",
              path: ["userToAdd"],
            });
          }
        }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_project_admin");

        if (input.action === "archive") {
          const status = input.status ?? "Archive";
          const project = await prisma.project.findFirst({
            where: {
              id: input.project_id,
              ownerId: user.id,
              status: { not: "Deleted" },
            },
            select: { id: true, name: true, title: true, status: true },
          });
          if (!project) {
            return {
              success: false,
              error: "Board not found, or you do not own it",
            };
          }

          const boardTitle = project.title || project.name || "Untitled board";
          const expectedTitle = input.expected_title!.trim();
          if (expectedTitle.toLowerCase() !== boardTitle.trim().toLowerCase()) {
            return sanitizeForJson({
              success: false,
              error: `Board title mismatch: supplied "${expectedTitle}", but board ${project.id}'s actual title is "${boardTitle}". Nothing has been changed.`,
            });
          }

          const operationKey = `project-admin-archive:${project.id}:${status}`;
          if (
            await requireCrossMessageConfirmation({
              userId: user.id,
              sessionId: confirmationSessionId,
              operationKey,
              confirmed: input.confirmed,
              previewsIssuedThisRequest: bulkPreviewsIssued,
            }) === "preview"
          ) {
            // success:false matches the bulk-assign preview, so a model cannot
            // read the preview as "done" and tell the user the board is archived.
            return sanitizeForJson({
              success: false,
              confirmation_required: true,
              affected: [
                {
                  project_id: project.id,
                  title: boardTitle,
                },
              ],
              message:
                `This would ${status === "Archive" ? "archive" : "restore"} board ${project.id}, "${boardTitle}". Nothing has been changed yet. ` +
                "End your turn now: list the affected board for the user and ask them to confirm. Only after they say yes, in a new message, call this tool again with confirmed: true.",
            });
          }

          const updated = await prisma.project.update({
            where: { id: project.id },
            data: { status },
            select: { id: true, name: true, title: true, status: true },
          });

          return sanitizeForJson({ success: true, project: updated });
        }

        const access = await validateProjectAccess(input.project_id, user.id);
        if (access.error) {
          return {
            success: false,
            error:
              access.error.status === 403
                ? "User does not have permission to view members of this project"
                : access.error.message,
          };
        }

        if (
          typeof input.userToAdd === "string" &&
          PROJECT_ADMIN_MEMBER_UUID_PATTERN.test(input.userToAdd)
        ) {
          const result = await addAgentToBoard(
            input.project_id,
            input.userToAdd,
            user.id
          );
          if (!result.ok) {
            return { success: false, error: result.message };
          }

          return {
            success: true,
            projectId: input.project_id,
            agent: {
              id: result.member.agent.id,
              displayName: result.member.agent.displayName,
            },
          };
        }

        let emailToAdd: string | null = null;
        if (typeof input.userToAdd === "string") {
          emailToAdd = input.userToAdd;
        } else if (typeof input.userToAdd === "number") {
          const foundUser = await prisma.user.findUnique({
            where: { id: input.userToAdd },
            select: { email: true },
          });
          if (!foundUser?.email) {
            return {
              success: false,
              error: "User ID does not exist or does not have a valid email",
              details: { field: "userToAdd", code: "user_not_found" },
            };
          }
          emailToAdd = foundUser.email;
        }

        if (!emailToAdd) {
          return {
            success: false,
            error: "Could not resolve a valid email address to add",
            details: { field: "userToAdd", code: "missing_email" },
          };
        }

        const result = await addMemberController(user.id, input.project_id, [
          emailToAdd,
        ]);
        if (result.status !== 200) {
          return { success: false, error: result.json };
        }

        return { success: true, projectId: input.project_id };
      }),
    }),

    hypertask_create_board: tool({
      description:
        "Create a new board/project in a team from a structured manifest. Use team_id from hypertask_get_user_context teams[].id.",
      inputSchema: z.object({
        team_id: z
          .string()
          .uuid()
          .describe(
            "Team UUID from hypertask_get_user_context teams[].id. Do not pass a project id, board id, or team title."
          ),
        manifest: z
          .object({
            title: z
              .string()
              .min(1)
              .max(200)
              .describe(
                "Required board title. Use the user's requested board name; do not invent a team or project identifier here."
              ),
            description: z
              .string()
              .optional()
              .describe(
                "Optional board description. Omit when the user did not provide descriptive board text."
              ),
            sections: z
              .array(
                z.object({
                  title: z
                    .string()
                    .min(1)
                    .max(200)
                    .describe(
                      "Section or column title. Use exact user-provided names when available."
                    ),
                })
              )
              .min(1)
              .max(50)
              .describe(
                "Required ordered board sections. Include at least one section; do not add extra columns unless the user asked for them."
              ),
            labels: z
              .array(
                z.object({
                  name: z
                    .string()
                    .min(1)
                    .max(100)
                    .describe(
                      "Label name to create on this new board. Use only labels requested or clearly implied by the manifest."
                    ),
                  color: z
                    .string()
                    .optional()
                    .describe(
                      "Optional label color accepted for manifest parity but not persisted by Hypertask. Omit unless provided by the user."
                    ),
                })
              )
              .max(100)
              .optional()
              .describe(
                "Optional labels for the new board. Omit when the user did not ask for labels."
              ),
            tasks: z
              .array(
                z.object({
                  title: z
                    .string()
                    .min(1)
                    .max(500)
                    .describe(
                      "Task title to seed into the new board. Do not create seed tasks unless the user asked for them."
                    ),
                  description: z
                    .string()
                    .optional()
                    .describe(
                      "Optional task description. Omit when no description was provided for this task."
                    ),
                  section_index: z
                    .number()
                    .int()
                    .min(0)
                    .optional()
                    .describe(
                      "Zero-based index into manifest.sections. Pass exactly one of section_index or section_title for each task."
                    ),
                  section_title: z
                    .string()
                    .optional()
                    .describe(
                      "Section title from manifest.sections. Pass exactly one of section_title or section_index for each task."
                    ),
                  label_names: z
                    .array(z.string())
                    .optional()
                    .describe(
                      "Optional label names to assign to this seed task. Every name must exist in manifest.labels; omit when none apply."
                    ),
                  priority: z
                    .number()
                    .min(0)
                    .max(4)
                    .optional()
                    .describe(
                      "Optional priority index from 0 to 4. Omit unless the user specified priority."
                    ),
                  estimate: z
                    .number()
                    .min(0)
                    .max(7)
                    .optional()
                    .describe(
                      "Optional estimate index from 0 to 7. Omit unless the user specified an estimate."
                    ),
                  due_date: z
                    .string()
                    .optional()
                    .describe(
                      "Optional ISO 8601 due date or datetime. Omit unless the user specified a due date."
                    ),
                })
              )
              .max(500)
              .optional()
              .describe(
                "Optional seed tasks for the new board. Omit when the user only asked to create the board structure."
              ),
            source_summary: z
              .string()
              .optional()
              .describe(
                "Optional manifest provenance summary for callers. Omit unless useful context was explicitly supplied."
              ),
          })
          .describe(
            "Board manifest accepted by validateBoardManifest. Keep it factual and do not invent sections, labels, or tasks."
          ),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_create_board");

        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: {
            id: true,
            email: true,
            displayName: true,
            accountId: true,
          },
        });
        if (!dbUser) {
          return { success: false, error: "User not found" };
        }

        const team = await prisma.team.findUnique({
          where: { id: input.team_id.trim() },
          select: { id: true, googleAccountId: true },
        });
        if (!team) {
          return {
            success: false,
            error: "Not found",
            message: "Team not found",
            details: { field: "team_id", code: "not_found" },
          };
        }

        const membership = await prisma.member_Team.findFirst({
          where: {
            userId: user.id,
            teamId: team.id,
            status: "Accepted",
          },
          select: { id: true },
        });
        const ownsTeam =
          dbUser.accountId != null && dbUser.accountId === team.googleAccountId;

        if (!membership && !ownsTeam) {
          return {
            success: false,
            error: "Forbidden",
            message: "User cannot create boards on this team",
            details: { field: "team_id", code: "forbidden" },
          };
        }

        const validated = validateBoardManifest(input.manifest);
        if (!validated.ok) {
          return {
            success: false,
            error: "validation_error",
            message: validated.message,
            details: { field: validated.field, code: validated.code },
          };
        }

        // HTPR-4894: createBoardFromManifest enforces the same cap by throwing;
        // check up front so the model gets a readable reason to relay instead.
        if (await isBoardLimitReached(user.id)) {
          return {
            success: false,
            error: "board_limit_reached",
            message: FREE_BOARD_LIMIT_MESSAGE,
            details: { field: "board", code: "board_limit_reached" },
          };
        }

        // Chat tool calls are not retried HTTP requests, so skip the MCP Idempotency-Key/Redis replay layer.
        const { board, sections, labels, tasks } = await createBoardFromManifest({
          teamId: team.id,
          googleAccountId: team.googleAccountId,
          manifest: validated.data,
          userId: user.id,
          userEmail: dbUser.email,
          userDisplayName: dbUser.displayName,
        });

        return sanitizeForJson({
          success: true,
          team_id: team.id,
          board,
          sections,
          labels,
          tasks: tasks.map((task) => ({ ...task, task_id: task.id })),
          message: "Board created successfully",
        });
      }),
    }),

    hypertask_list_project_members: tool({
      description:
        "List members and board agents for one project. Returns only members scoped to that project.",
      inputSchema: z.object({
        project_id: z.coerce.number().int().positive(),
      }),
      execute: async (input) => {
        sendStatus("hypertask_list_project_members");
        const access = await validateProjectAccess(input.project_id, user.id);
        if (access.error) {
          return {
            success: false,
            error:
              access.error.status === 403
                ? "User does not have permission to view members of this project"
                : access.error.message,
          };
        }
        // HTPR-3805: "list members" must include the caller — excluding them
        // dropped the owner entirely on boards with zero Member rows.
        const result = await getProjectMembers(
          input.project_id,
          undefined,
          requestingUserId,
        );
        if (result.error) {
          return { success: false, error: result.error.message };
        }
        return sanitizeForJson({
          success: true,
          members: result.members,
          projectId: input.project_id,
        });
      },
    }),

    hypertask_list_custom_fields: tool({
      description:
        "List the custom fields defined on a board (e.g. ICE, Story Points). Use this to see valid field names, types, and Select options before setting a value.",
      inputSchema: z.object({
        project_id: z.coerce.number().int().positive(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_list_custom_fields");
        const access = await validateProjectAccess(input.project_id, user.id);
        if (access.error) {
          return { success: false, error: access.error.message };
        }
        const customFields = await getCustomFieldsForProject(input.project_id);
        return sanitizeForJson({
          success: true,
          projectId: input.project_id,
          customFields,
        });
      }),
    }),

    hypertask_set_custom_field_value: tool({
      description:
        'Set or clear a custom field\'s value on a task, e.g. "set ICE to 21 on THID-5". Pass create_field=true to explicitly create a missing Number-type field. Pass value: null (or an empty string) to clear an existing field.',
      inputSchema: z.object({
        task_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(TOOL_TASK_ID_DESCRIPTION),
        ticket_number: z
          .string()
          .optional()
          .describe(
            "Ticket number such as HTPR-1234. Prefer this when the user gives a ticket number; do not also invent task_id."
          ),
        unique_index: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Task's board-local numeric index. Only pass with project_id; do not use it by itself."
          ),
        project_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Project/board id required with unique_index and useful to disambiguate ticket_number. Omit when only task_id is known."
          ),
        field_name: z
          .string()
          .min(1)
          .describe(
            'Custom field name, e.g. "ICE". Must match an existing field unless create_field=true.'
          ),
        create_field: z
          .boolean()
          .optional()
          .describe(
            "Set true only when the user explicitly asks to create this missing field. New fields created here are Number fields."
          ),
        value: z
          .union([z.string(), z.number(), z.null()])
          .describe(
            "New value for the field. For Select fields, pass the option id or label. Pass null or an empty string to clear the field."
          ),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_set_custom_field_value");
        const taskResult = await resolveTaskForTool(user, {
          task_id: input.task_id,
          ticket_number: input.ticket_number,
          unique_index: input.unique_index,
          project_id: input.project_id,
        });
        if (taskResult.error) {
          return { success: false, error: taskResult.error };
        }
        const task = taskResult.task;
        if (!task) {
          return { success: false, error: "Task not found or access denied" };
        }

        const fieldName = input.field_name.trim();
        if (!fieldName) {
          return { success: false, error: "field_name is required" };
        }

        const normalizedValue = input.value === null ? null : String(input.value);

        let customField = await getCustomFieldForProjectByName(
          task.projectId,
          fieldName
        );
        if (
          !customField &&
          input.create_field &&
          normalizedValue !== null &&
          normalizedValue !== ""
        ) {
          customField = await createCustomField(
            task.projectId,
            fieldName,
            CustomFieldType.Number
          );
        }

        if (!customField) {
          const validFields = (await getCustomFieldsForProject(task.projectId))
            .map((field) => field.name)
            .join(", ");
          return {
            success: false,
            error:
              normalizedValue === null || normalizedValue === ""
                ? `Cannot clear unknown custom field "${fieldName}". Valid fields: ${validFields || "none"}.`
                : `Unknown custom field "${fieldName}". Valid fields: ${validFields || "none"}. Pass create_field=true only if the user explicitly asked to create it.`,
          };
        }

        const customFieldValue = await upsertCustomFieldValue(
          customField.id,
          task.id,
          normalizedValue
        );

        return sanitizeForJson({
          success: true,
          taskId: task.id,
          customField: {
            id: customField.id,
            name: customField.name,
            type: customField.type,
          },
          customFieldValue,
          ...(customFieldValue === null ? { deleted: true } : {}),
        });
      }),
    }),

    hypertask_list_tasks: tool({
      description:
        "List tasks using structured filters such as project, section, assignee, priority, labels, due dates, status, and search text.",
      inputSchema: z.object({
        project_id: z.coerce.number().int().positive().optional(),
        board_id: z.coerce.number().int().positive().optional(),
        section: z.string().optional(),
        assigned_to: z.string().optional(),
        priority: z.union([z.string(), z.array(z.string())]).optional(),
        has_due_date: z.boolean().optional(),
        due_date_before: z.string().optional(),
        due_date_after: z.string().optional(),
        status: statusSchema.default("Normal"),
        labels: z.array(z.string()).default([]),
        created_by: z.coerce.number().int().positive().optional(),
        updated_since: z.string().optional(),
        created_since: z.string().optional(),
        has_comments: z.boolean().optional(),
        has_attachments: z.boolean().optional(),
        search: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        sort_by: z
          .enum(["createdAt", "updatedAt", "dueDate", "priority", "title"])
          .default("updatedAt"),
        sort_order: sortOrderSchema.default("desc"),
      }),
      execute: async (input) => {
        sendStatus("hypertask_list_tasks");
        const accessibleProjectIds = await getAccessibleProjectIds(user.id);
        if (accessibleProjectIds.length === 0) {
          return { success: true, tasks: [], total: 0, limit: input.limit, offset: input.offset };
        }

        const where: Prisma.TaskWhereInput = {
          projectId: { in: accessibleProjectIds },
          status: input.status,
        };
        const targetProjectId = input.project_id ?? input.board_id;
        if (targetProjectId) {
          if (!accessibleProjectIds.includes(targetProjectId)) {
            return { success: false, error: "Project not found or access denied" };
          }
          where.projectId = targetProjectId;
        }
        if (input.section) where.section = input.section;
        if (input.assigned_to) {
          if (input.assigned_to === "me") {
            where.assignees = { some: { userId: user.id } };
          } else if (input.assigned_to === "unassigned") {
            where.assignees = { none: {} };
          } else {
            const userIds = input.assigned_to
              .split(",")
              .map((id) => parseInt(id.trim(), 10))
              .filter(Number.isInteger);
            if (userIds.length > 0) {
              where.assignees = { some: { userId: { in: userIds } } };
            }
          }
        }
        const priorities = normalizePriorityInput(input.priority);
        if (priorities?.length) {
          where.priority = { Priority_Value: { in: priorities } };
        }
        if (input.has_due_date !== undefined) {
          where.dueDate = input.has_due_date ? { not: null } : null;
        }
        if (input.due_date_before) {
          where.dueDate = {
            ...(typeof where.dueDate === "object" && where.dueDate != null
              ? where.dueDate
              : {}),
            lte: new Date(input.due_date_before),
          };
        }
        if (input.due_date_after) {
          where.dueDate = {
            ...(typeof where.dueDate === "object" && where.dueDate != null
              ? where.dueDate
              : {}),
            gte: new Date(input.due_date_after),
          };
        }
        if (input.labels.length > 0) {
          where.taskLabels = {
            some: {
              OR: [
                { labelId: { in: input.labels } },
                { label: { value: { in: input.labels } } },
              ],
            },
          };
        }
        if (input.created_by) where.userId = input.created_by;
        if (input.updated_since) where.updatedAt = { gte: new Date(input.updated_since) };
        if (input.created_since) where.createdAt = { gte: new Date(input.created_since) };
        // Only filter when explicitly TRUE. The chat model reflexively fills every
        // optional param with a default `false`, which under `!== undefined` became a
        // restrictive "has NONE" filter and silently dropped tasks that do have
        // comments/attachments (e.g. it reported 0 due dates on boards that had them).
        if (input.has_comments === true) {
          where.comments = { some: {} };
        }
        if (input.has_attachments === true) {
          where.attachments = { some: {} };
        }
        if (input.search) {
          where.OR = [
            { title: { contains: input.search, mode: "insensitive" } },
            {
              description_: {
                content: { contains: input.search, mode: "insensitive" },
              },
            },
            { ticketNumber: { contains: input.search, mode: "insensitive" } },
          ];
        }

        const orderBy: Prisma.TaskOrderByWithRelationInput =
          input.sort_by === "createdAt"
            ? { createdAt: input.sort_order }
            : input.sort_by === "dueDate"
              ? { dueDate: input.sort_order }
              : input.sort_by === "priority"
                ? { priority: { Priority_Value: input.sort_order } }
                : input.sort_by === "title"
                  ? { title: input.sort_order }
                  : { updatedAt: input.sort_order };

        const [total, tasks] = await Promise.all([
          prisma.task.count({ where }),
          prisma.task.findMany({
            where,
            select: {
              id: true,
              ticketNumber: true,
              uniqueIndex: true,
              title: true,
              section: true,
              description_: true,
              sectionId: true,
              parentTaskId: true,
              projectId: true,
              project: { select: { id: true, title: true } },
              parentTask: {
                select: { id: true, ticketNumber: true, title: true, uniqueIndex: true },
              },
              status: true,
              priority: { select: { Priority_Value: true } },
              dueDate: true,
              createdAt: true,
              updatedAt: true,
              agent: { select: mcpVisibleAgentSelect(user.id) },
              _count: {
                select: {
                  assignees: {
                    where: {
                      OR: [
                        { agentId: null },
                        { agent: accessibleAgentWhere(user.id) },
                      ],
                    },
                  },
                  taskLabels: true,
                  comments: mcpTaskUserCommentCount,
                },
              },
              subTasks: {
                where: { status: { not: "Deleted" } },
                select: { id: true, ticketNumber: true, title: true, uniqueIndex: true },
                orderBy: { createdAt: "asc" },
              },
            },
            orderBy,
            take: input.limit,
            skip: input.offset,
          }),
        ]);

        return sanitizeForJson({
          success: true,
          tasks: tasks.map((task) => {
            const agent = mapVisibleMcpAgent(task.agent, user.id);
            return {
              id: task.id,
              task_id: task.id,
              ticketNumber: task.ticketNumber || undefined,
              uniqueIndex: task.uniqueIndex,
              // Use this verbatim for links; never build the path from `id`.
              url: `/detail/project-${task.projectId}/${task.uniqueIndex}`,
              title: task.title,
              description: mapTaskDescriptionContent(task),
              section: task.section,
              sectionId: task.sectionId || undefined,
              boardId: task.projectId,
              boardTitle: task.project.title || "",
              parent_id: task.parentTaskId || undefined,
              parent_task: task.parentTask
                ? {
                    id: task.parentTask.id,
                    task_id: task.parentTask.id,
                    ticketNumber: task.parentTask.ticketNumber || undefined,
                    title: task.parentTask.title,
                    uniqueIndex: task.parentTask.uniqueIndex,
                  }
                : undefined,
              sub_tasks: task.subTasks.map((subTask) => ({
                id: subTask.id,
                task_id: subTask.id,
                ticketNumber: subTask.ticketNumber || undefined,
                title: subTask.title,
                uniqueIndex: subTask.uniqueIndex,
              })),
              projectId: task.projectId,
              status: task.status,
              priority: task.priority?.Priority_Value || undefined,
              dueDate: task.dueDate?.toISOString() || undefined,
              assigneeCount: task._count.assignees,
              labelCount: task._count.taskLabels,
              commentCount: task._count.comments,
              createdAt: task.createdAt.toISOString(),
              updatedAt: task.updatedAt?.toISOString() || undefined,
              ...(agent ? { agent } : {}),
            };
          }),
          total,
          limit: input.limit,
          offset: input.offset,
        });
      },
    }),

    hypertask_get_tasks: tool({
      description:
        "Get detailed fields for specific tasks by task IDs, ticket numbers, or project_id plus unique_index. Use only for detail enrichment. Provide whichever identifiers you know; extra identifiers are tolerated and unioned.",
      inputSchema: z.object({
        task_ids: z.array(z.coerce.number().int().positive()).optional(),
        ticket_numbers: z.array(z.string()).optional(),
        unique_index: z.coerce.number().int().positive().optional(),
        project_id: z.coerce.number().int().positive().optional(),
      }),
      execute: async (input) => {
        sendStatus("hypertask_get_tasks");
        if (input.unique_index && !input.project_id) {
          return { success: false, error: "project_id is required with unique_index" };
        }

        const orConditions: Prisma.TaskWhereInput[] = [];
        if (input.task_ids?.length) {
          orConditions.push({ id: { in: input.task_ids } });
        }
        if (input.ticket_numbers?.length) {
          orConditions.push({
            ticketNumber: { in: input.ticket_numbers },
            ...(input.project_id ? { projectId: input.project_id } : {}),
          });
        }
        if (input.unique_index && input.project_id) {
          orConditions.push({
            projectId: input.project_id,
            uniqueIndex: input.unique_index,
            status: { not: "Deleted" },
          });
        }
        if (orConditions.length === 0) {
          return {
            success: false,
            error:
              "Provide at least one of task_ids, ticket_numbers, or project_id + unique_index",
          };
        }

        const tasks = await prisma.task.findMany({
          where: {
            OR: orConditions,
            project: getProjectWhere(user.id),
          },
          include: taskMcpGetInclude(user.id),
        });

        const notFound = [
          ...(input.task_ids ?? [])
            .filter((taskId) => !tasks.some((task) => task.id === taskId))
            .map((task_id) => ({ task_id })),
          ...(input.ticket_numbers ?? [])
            .filter(
              (ticketNumber) =>
                !tasks.some((task) => task.ticketNumber === ticketNumber)
            )
            .map((ticket_number) => ({
              ticket_number,
              ...(input.project_id ? { project_id: input.project_id } : {}),
            })),
          ...(input.unique_index && input.project_id &&
          !tasks.some(
            (task) =>
              task.uniqueIndex === input.unique_index &&
              task.projectId === input.project_id
          )
            ? [{ unique_index: input.unique_index, project_id: input.project_id }]
            : []),
        ];

        if (tasks.length === 0) {
          return {
            success: false,
            error: "Task not found or access denied",
            tasks: [],
            not_found: notFound,
          };
        }

        return sanitizeForJson({
          success: true,
          tasks: tasks.map((task) => mapTaskToMcpGetResponse(task, user.id)),
          not_found: notFound,
        });
      },
    }),

    hypertask_my_tasks: tool({
      description:
        "The user's own workload across EVERY board they can see, grouped per board, the same set the My Tasks page shows. Use this for \"what am I working on\", \"what's overdue\", \"how many tasks do I have\", \"what do I have on board X\", and as the first step before unassigning the user from a board's tasks. Counts (total, overdue_total, each board's total) are always exact even when the task rows are capped, so report those numbers rather than counting the rows.",
      inputSchema: z.object({
        project_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe("Narrow to one board. Omit for every board."),
        overdue_only: z.boolean().default(false),
        include_tasks: z
          .boolean()
          .default(true)
          .describe("Set false for a counts-only breakdown per board."),
        limit: z.coerce
          .number()
          .int()
          .min(1)
          .max(MY_TASKS_MAX_LIMIT)
          .default(MY_TASKS_DEFAULT_LIMIT),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_my_tasks");
        return sanitizeForJson(
          await getMyTasksSummary({
            userId: user.id,
            projectId: input.project_id ?? null,
            overdueOnly: input.overdue_only,
            includeTasks: input.include_tasks,
            limit: input.limit,
          })
        );
      }),
    }),

    hypertask_search_tasks: tool({
      description:
        "Search tasks by keyword, phrase, partial task name, ticket number, or description. Uses Turbopuffer relevance with Prisma fallback. For 'latest/newest/most recent ticket' questions set sort=\"newest\" (query may be omitted); for 'oldest/first' use sort=\"oldest\". Default sort is relevance for keyword/topic search. When total_is_lower_bound is true, report the total as at least N.",
      inputSchema: z.object({
        query: z.string().min(1).max(200).optional(),
        sort: z.enum(["relevance", "newest", "oldest"]).default("relevance"),
        project_id: z.coerce.number().int().positive().optional(),
        board_id: z.coerce.number().int().positive().optional(),
        assigned_to: z.string().optional(),
        priority: z.union([z.string(), z.array(z.string())]).optional(),
        section: z.string().optional(),
        has_due_date: z.boolean().optional(),
        status: z.enum(["Normal", "Archive"]).default("Normal"),
        limit: z.coerce.number().int().min(1).max(50).default(10),
      }),
      execute: async (input) => {
        sendStatus("hypertask_search_tasks");
        const accessibleProjectIds = await getAccessibleProjectIds(user.id);
        if (accessibleProjectIds.length === 0) {
          return {
            success: true,
            tasks: [],
            ...buildSearchTotalMetadata(0, false),
          };
        }
        const targetProjectId = input.project_id ?? input.board_id;
        if (targetProjectId && !accessibleProjectIds.includes(targetProjectId)) {
          return { success: false, error: "Project not found or access denied" };
        }

        const where: Prisma.TaskWhereInput = {
          projectId: targetProjectId
            ? targetProjectId
            : { in: accessibleProjectIds },
          status: input.status,
        };
        if (input.section) where.section = input.section;
        if (input.assigned_to) {
          if (input.assigned_to === "me") {
            where.assignees = { some: { userId: user.id } };
          } else if (input.assigned_to === "unassigned") {
            where.assignees = { none: {} };
          } else {
            const assignedUserId = parseInt(input.assigned_to, 10);
            if (Number.isInteger(assignedUserId)) {
              where.assignees = { some: { userId: assignedUserId } };
            }
          }
        }
        const priorities = normalizePriorityInput(input.priority);
        if (priorities?.length) {
          where.priority = { Priority_Value: { in: priorities } };
        }
        if (input.has_due_date !== undefined) {
          where.dueDate = input.has_due_date ? { not: null } : null;
        }

        // Recency sort ("latest ticket" style) bypasses relevance search: order by createdAt.
        const recency = input.sort === "newest" || input.sort === "oldest";

        const turbopufferIds =
          recency || !input.query
            ? []
            : await turbopufferSearchTaskIds({
                searchQuery: input.query,
                projectIds: accessibleProjectIds,
                status: input.status,
                projectId: targetProjectId,
                perPage: Math.min(input.limit * 5, 100),
              });

        if (turbopufferIds.length > 0) {
          where.id = { in: turbopufferIds };
        } else if (input.query) {
          where.OR = [
            { title: { contains: input.query, mode: "insensitive" } },
            { description: { contains: input.query, mode: "insensitive" } },
            { ticketNumber: { contains: input.query, mode: "insensitive" } },
          ];
        }

        const recencyOrder = {
          orderBy: { createdAt: input.sort === "oldest" ? ("asc" as const) : ("desc" as const) },
          take: input.limit,
        };

        const [total, tasks] = await Promise.all([
          prisma.task.count({ where }),
          prisma.task.findMany({
            where,
            select: {
              id: true,
              ticketNumber: true,
              uniqueIndex: true,
              title: true,
              description: true,
              section: true,
              projectId: true,
              project: { select: { id: true, title: true } },
              dueDate: true,
              createdAt: true,
              agent: { select: mcpVisibleAgentSelect(user.id) },
            },
            ...(recency
              ? recencyOrder
              : turbopufferIds.length > 0
                ? {}
                : { orderBy: { updatedAt: "desc" as const }, take: input.limit }),
          }),
        ]);

        const orderedTasks =
          turbopufferIds.length > 0
            ? turbopufferIds
                .map((id) => tasks.find((task) => task.id === id))
                .filter((task): task is NonNullable<typeof task> => task != null)
                .slice(0, input.limit)
            : tasks;

        return sanitizeForJson({
          success: true,
          tasks: orderedTasks.map((task) => mapTaskSearchItem(task, user.id)),
          ...buildSearchTotalMetadata(total, turbopufferIds.length > 0),
          boardId: targetProjectId || undefined,
        });
      },
    }),

    hypertask_task_context: tool({
      description:
        "Get a focused context pack for one task, including its parent, subtasks, relations, recent comments, and linked pull requests.",
      inputSchema: z.object({
        task_id: z.coerce
          .number()
          .int()
          .positive()
          .describe(TOOL_TASK_ID_DESCRIPTION),
        project_id: z.coerce.number().int().positive(),
        summary: z.boolean().default(false),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_task_context");
        const resolvedTask = await findTaskByIdentifier(user, {
          task_id: input.task_id,
        });
        if (!resolvedTask || resolvedTask.projectId !== input.project_id) {
          return { success: false, error: "Task not found or access denied" };
        }

        const commentLimit = input.summary ? 3 : 20;
        const commentWhere = {
          taskId: resolvedTask.id,
          activity: { equals: Prisma.DbNull },
        } satisfies Prisma.CommentWhereInput;
        const relatedTaskAccess = {
          status: { not: "Deleted" },
          project: getProjectWhere(user.id),
        } satisfies Prisma.TaskWhereInput;
        const relatedTaskSelect = {
          id: true,
          ticketNumber: true,
          title: true,
          uniqueIndex: true,
        } satisfies Prisma.TaskSelect;

        const [task, commentCount, recentComments, prComments, relations] =
          await Promise.all([
            prisma.task.findFirst({
              where: {
                id: resolvedTask.id,
                projectId: input.project_id,
                status: { not: "Deleted" },
              },
              include: taskMcpGetInclude(user.id),
            }),
            prisma.comment.count({ where: commentWhere }),
            prisma.comment.findMany({
              where: commentWhere,
              select: {
                id: true,
                text: true,
                createdAt: true,
                agentDisplayName: true,
                creator: {
                  select: { email: true, displayName: true },
                },
                agent: { select: mcpVisibleAgentSelect(user.id) },
              },
              orderBy: { createdAt: "desc" },
              take: commentLimit,
            }),
            prisma.comment.findMany({
              where: commentWhere,
              select: { text: true, commentText: true },
              orderBy: { createdAt: "asc" },
              take: 200,
            }),
            prisma.taskRelations.findMany({
              where: {
                OR: [
                  {
                    sourceTaskId: resolvedTask.id,
                    targetTask: relatedTaskAccess,
                  },
                  {
                    targetTaskId: resolvedTask.id,
                    sourceTask: relatedTaskAccess,
                  },
                ],
              },
              select: {
                sourceTaskId: true,
                targetTaskId: true,
                relationType: true,
                sourceTask: { select: relatedTaskSelect },
                targetTask: { select: relatedTaskSelect },
              },
              orderBy: { createdAt: "asc" },
            }),
          ]);

        if (!task) {
          return { success: false, error: "Task not found or access denied" };
        }

        const mappedTask = mapTaskToMcpGetResponse(task, user.id);
        const comments = recentComments.reverse().map((comment) => {
          const agent = mapVisibleMcpAgent(comment.agent, user.id);
          return {
            id: comment.id,
            author:
              agent?.displayName ||
              (comment.agent || comment.agentDisplayName ? "Private agent" : undefined) ||
              comment.creator?.displayName ||
              comment.creator?.email ||
              "Unknown",
            text: stripInlineDataUris(comment.text),
            createdAt: comment.createdAt.toISOString(),
          };
        });
        const relatedTasks = relations.map((relation) => {
          const outgoing = relation.sourceTaskId === resolvedTask.id;
          const relatedTask = outgoing
            ? relation.targetTask
            : relation.sourceTask;
          return {
            id: relatedTask.id,
            ticketNumber: relatedTask.ticketNumber || undefined,
            title: relatedTask.title,
            uniqueIndex: relatedTask.uniqueIndex,
            relationType: relation.relationType,
            direction: outgoing ? "outgoing" : "incoming",
          };
        });
        const linkedPRs = extractPrLinks(
          mappedTask.description,
          ...prComments.flatMap((comment) => [comment.text, comment.commentText])
        );

        return sanitizeForJson({
          success: true,
          task: {
            id: mappedTask.id,
            ticketNumber: mappedTask.ticketNumber,
            title: mappedTask.title,
            description: mappedTask.description,
            section: mappedTask.section,
            labels: mappedTask.labels,
            assignees: mappedTask.assignees,
            priority: mappedTask.priority,
            dueDate: mappedTask.dueDate,
          },
          parent: mappedTask.parent_task ?? null,
          subtasks: mappedTask.sub_tasks,
          relatedTasks,
          comments,
          linkedPRs,
          commentCount,
          truncated: commentCount > commentLimit,
        });
      }),
    }),

    hypertask_task_description_history: tool({
      description:
        "List a task description's saved versions or restore one. Restore REPLACES the current description with the selected saved version. Always list versions first to get the required version_id.",
      inputSchema: z.object({
        action: z.enum(["versions", "restore"]),
        task_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(TOOL_TASK_ID_DESCRIPTION),
        ticket_number: z.string().trim().min(1).optional(),
        unique_index: z.coerce.number().int().positive().optional(),
        project_id: z.coerce.number().int().positive().optional(),
        version_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe("Required when action is restore."),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_task_description_history");
        const taskResult = await resolveTaskForTool(user, {
          task_id: input.task_id,
          ticket_number: input.ticket_number,
          unique_index: input.unique_index,
          project_id: input.project_id,
        });
        if (taskResult.error) {
          return { success: false, error: taskResult.error };
        }

        const task = taskResult.task;
        if (!task) {
          return { success: false, error: "Task not found or access denied" };
        }

        const access = await validateProjectAccess(task.projectId, user.id);
        if (access.error) {
          return { success: false, error: "Task not found or access denied" };
        }

        if (input.action === "versions") {
          const versions = await prisma.docVersion.findMany({
            where: { entityType: "task_description", entityId: task.id },
            orderBy: [{ version: "desc" }, { createdAt: "desc" }],
            select: {
              id: true,
              version: true,
              contentHtml: true,
              authorId: true,
              agentId: true,
              note: true,
              createdAt: true,
            },
          });

          return sanitizeForJson({
            success: true,
            versions: versions.map((version) => ({
              id: version.id,
              version: version.version,
              content: htmlToMarkdown(version.contentHtml),
              author_id: version.authorId,
              agent_id: version.agentId,
              note: version.note,
              created_at: version.createdAt,
            })),
          });
        }

        if (input.version_id === undefined) {
          return { success: false, error: "version_id is required for restore" };
        }

        const snapshot = await prisma.docVersion.findFirst({
          where: {
            id: input.version_id,
            entityType: "task_description",
            entityId: task.id,
          },
          select: { contentHtml: true, version: true },
        });
        if (!snapshot) {
          return {
            success: false,
            error: "Version not found for this task",
          };
        }

        await upsertTaskDescription({
          taskId: task.id,
          creatorId: user.id,
          content: snapshot.contentHtml,
          actingUserId: user.id,
        });

        return {
          success: true,
          restored_from_version: snapshot.version,
        };
      }),
    }),

    hypertask_next_tasks: tool({
      description:
        "Get the highest-priority unleased tasks from one accessible board, optionally filtered by section, blocked status, and comma-separated label names or IDs. A truncated response may have more matching tasks beyond its reported total.",
      inputSchema: z.object({
        project_id: z.coerce.number().int().positive(),
        limit: z.coerce.number().int().positive().default(10),
        section: z.string().trim().min(1).optional(),
        exclude_blocked: z.boolean().default(false),
        labels: z.string().trim().min(1).optional(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_next_tasks");
        const projectAccessWhere = getProjectWhere(user.id);
        const project = await prisma.project.findFirst({
          where: {
            id: input.project_id,
            status: "Normal",
            ...projectAccessWhere,
          },
          select: {
            id: true,
            section: {
              where: { deleted: false },
              select: { section_title: true, isDone: true },
            },
          },
        });
        if (!project) {
          return { success: false, error: "Project not found or access denied" };
        }

        const labelFilters = (input.labels ?? "")
          .split(",")
          .map((label: string) => label.trim())
          .filter(Boolean);
        const labelIdPattern =
          /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
        const labelIds = labelFilters.filter((label: string) => labelIdPattern.test(label));
        const labelNames = labelFilters.filter((label: string) => !labelIdPattern.test(label));
        const now = new Date();
        const where: Prisma.TaskWhereInput = {
          projectId: input.project_id,
          project: projectAccessWhere,
          status: "Normal",
          ...(input.section ? { section: input.section } : {}),
          ...(labelFilters.length > 0
            ? {
                taskLabels: {
                  some: {
                    OR: [
                      ...(labelIds.length > 0
                        ? [{ labelId: { in: labelIds } }]
                        : []),
                      ...(labelNames.length > 0
                        ? [{ label: { value: { in: labelNames } } }]
                        : []),
                    ],
                  },
                },
              }
            : {}),
          taskLease: {
            isNot: { expiresAt: { gt: now } },
          },
        };

        const scanLimit = 500;
        const scannedTasks = await prisma.task.findMany({
          where,
          select: {
            id: true,
            ticketNumber: true,
            title: true,
            section: true,
            priority: { select: { Priority_Value: true } },
            dueDate: true,
            createdAt: true,
            taskLabels: {
              select: {
                label: { select: { id: true, value: true } },
              },
              orderBy: { labelId: "asc" },
            },
            relatedFromTasks: {
              where: { relationType: "BlockedBy" },
              select: {
                targetTask: {
                  select: { status: true, section: true, projectId: true },
                },
              },
            },
            relatedToTasks: {
              where: { relationType: "BlockedTo" },
              select: {
                sourceTask: {
                  select: { status: true, section: true, projectId: true },
                },
              },
            },
          },
          orderBy: [
            { priority: { priority_index: "asc" } },
            { dueDate: { sort: "asc", nulls: "last" } },
            { createdAt: "asc" },
          ],
          take: scanLimit + 1,
        });
        const scanMetadata = buildLimitedScanMetadata(
          scannedTasks.length,
          scanLimit
        );
        const tasks = scannedTasks.slice(0, scanLimit);

        // A blocker can live on a different board, so each one is resolved
        // against its OWN project's finished columns. Applying the requesting
        // board's flags to a foreign blocker is worse than applying none.
        const blockersOf = (task: (typeof tasks)[number]) => [
          ...task.relatedFromTasks.map((relation) => relation.targetTask),
          ...task.relatedToTasks.map((relation) => relation.sourceTask),
        ];
        const doneTitlesByProject = input.exclude_blocked
          ? await loadDoneTitlesByProject(
              tasks.flatMap((task) =>
                blockersOf(task).map((blocker) => blocker.projectId)
              ),
              (title) => columnRole(title) === "done"
            )
          : new Map<number, Set<string>>();
        const candidates = input.exclude_blocked
          ? tasks.filter(
              (task) =>
                !blockersOf(task).some((blocker) =>
                  blockerStillOpen(
                    blocker,
                    doneTitlesByProject.get(blocker.projectId)
                  )
                )
            )
          : tasks;
        const rankedTasks = candidates
          .map((task) => ({
            task,
            score: priorityScore(
              task.priority?.Priority_Value,
              task.dueDate,
              now
            ),
          }))
          .sort(
            (left, right) =>
              right.score - left.score ||
              left.task.createdAt.getTime() - right.task.createdAt.getTime()
          );
        const limit = Math.min(input.limit, 50);

        return sanitizeForJson({
          success: true,
          tasks: rankedTasks.slice(0, limit).map(({ task, score }) => ({
            id: task.id,
            ticketNumber: task.ticketNumber || undefined,
            title: task.title,
            section: task.section,
            priority: task.priority?.Priority_Value || undefined,
            dueDate: task.dueDate?.toISOString() || undefined,
            score,
            labels: task.taskLabels.map(({ label }) => ({
              id: label.id,
              name: label.value || "",
            })),
          })),
          total: rankedTasks.length,
          truncated: scanMetadata.truncated,
        });
      }),
    }),

    hypertask_link_tasks: tool({
      description:
        "Create or update a relation between two tasks. Identify each task with exactly one task ID or ticket number.",
      inputSchema: z.object({
        source_task_id: z.coerce.number().int().positive().optional(),
        source_ticket_number: z.string().trim().min(1).optional(),
        target_task_id: z.coerce.number().int().positive().optional(),
        target_ticket_number: z.string().trim().min(1).optional(),
        project_id: z.coerce.number().int().positive().optional(),
        relation_type: z
          .enum(["RelatedTo", "BlockedBy", "BlockedTo"])
          .nullish(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_link_tasks");
        const sourceCount = Number(input.source_task_id !== undefined) +
          Number(input.source_ticket_number !== undefined);
        const targetCount = Number(input.target_task_id !== undefined) +
          Number(input.target_ticket_number !== undefined);
        if (sourceCount !== 1) {
          return {
            success: false,
            error: "Provide exactly one of source_task_id or source_ticket_number",
          };
        }
        if (targetCount !== 1) {
          return {
            success: false,
            error: "Provide exactly one of target_task_id or target_ticket_number",
          };
        }

        const relationType = normalizeTaskRelationType(input.relation_type);
        if (!relationType) {
          return {
            success: false,
            error: "relation_type must be one of RelatedTo, BlockedBy, or BlockedTo",
          };
        }
        const [sourceTask, targetTask] = await Promise.all([
          findTaskByIdentifier(user, {
            task_id: input.source_task_id,
            ticket_number: input.source_ticket_number,
            project_id: input.project_id,
          }),
          findTaskByIdentifier(user, {
            task_id: input.target_task_id,
            ticket_number: input.target_ticket_number,
            project_id: input.project_id,
          }),
        ]);
        if (!sourceTask || !targetTask) {
          return { success: false, error: "Task not found or access denied" };
        }
        if (sourceTask.id === targetTask.id) {
          return { success: false, error: "A task cannot have a relation to itself" };
        }

        const relation = await prisma.taskRelations.upsert({
          where: {
            sourceTaskId_targetTaskId: {
              sourceTaskId: sourceTask.id,
              targetTaskId: targetTask.id,
            },
          },
          create: {
            sourceTaskId: sourceTask.id,
            targetTaskId: targetTask.id,
            relationType,
          },
          update: { relationType },
          select: {
            id: true,
            sourceTaskId: true,
            targetTaskId: true,
            relationType: true,
          },
        });
        return sanitizeForJson({ success: true, relation });
      }),
    }),

    hypertask_find_related_tasks: tool({
      description:
        "Find tasks similar to an existing accessible task across the user's boards.",
      inputSchema: z.object({
        task_id: z.coerce
          .number()
          .int()
          .positive()
          .describe(TOOL_TASK_ID_DESCRIPTION),
        limit: z.coerce.number().int().positive().default(10),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_find_related_tasks");
        const response = await handleRelatedTasksGet(
          new NextRequest("http://localhost/api/mcp/tasks/related"),
          { user, agentId: null },
          { taskId: input.task_id, limit: input.limit }
        );
        const payload = (await response.json()) as Record<string, unknown>;
        return sanitizeForJson(payload);
      }),
    }),

    hypertask_get_comments_for_task: tool({
      description:
        "Get user comments for a specific task. Use only when the user explicitly asks for comments on a task. Provide whichever task identifier you know; extra identifiers are tolerated. Set include_activity=true to also return the task's history: label, move, assignment and priority changes, each tagged type='activity'.",
      inputSchema: z.object({
        task_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(TOOL_TASK_ID_DESCRIPTION),
        ticket_number: z.string().optional(),
        unique_index: z.coerce.number().int().positive().optional(),
        project_id: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        include_activity: z
          .boolean()
          .default(false)
          .describe(
            "Include the task's history rows (label, move, assignment and priority changes) alongside user comments."
          ),
        sort_order: sortOrderSchema.default("desc"),
      }),
      execute: async (input) => {
        sendStatus("hypertask_get_comments_for_task");
        const taskResult = await resolveTaskForTool(user, {
          task_id: input.task_id,
          ticket_number: input.ticket_number,
          unique_index: input.unique_index,
          project_id: input.project_id,
        });
        if (taskResult.error) {
          return { success: false, error: taskResult.error };
        }

        const task = taskResult.task;
        if (!task) {
          return { success: false, error: "Task not found or access denied" };
        }

        const commentWhere: Prisma.CommentWhereInput = input.include_activity
          ? { taskId: task.id }
          : { taskId: task.id, activity: { equals: Prisma.DbNull } };
        const [total, comments] = await Promise.all([
          prisma.comment.count({ where: commentWhere }),
          prisma.comment.findMany({
            where: commentWhere,
            include: commentInclude(user.id),
            orderBy: { createdAt: input.sort_order },
            take: input.limit,
            skip: input.offset,
          }),
        ]);

        return sanitizeForJson({
          success: true,
          comments: comments.map((comment) =>
            input.include_activity
              ? withActivityMetadata(mapCommentToResponse(comment, user.id), comment.activity)
              : mapCommentToResponse(comment, user.id)
          ),
          total,
          limit: input.limit,
          offset: input.offset,
        });
      },
    }),

    hypertask_inbox_list: tool({
      description:
        "Return inbox notifications that mirror the app inbox view for the authenticated user, with total and truncated metadata. Set archived=true to list archived inbox notifications.",
      inputSchema: z.object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        archived: z.boolean().default(false),
      }),
      execute: async (input) => {
        sendStatus("hypertask_inbox_list");
        if (actingAgentId) {
          if (input.archived) {
            return {
              success: false,
              error: "Archived inbox items are not available to agents.",
            };
          }
          const agentInbox = await getStructuredInboxForAgent({
            userId: user.id,
            agentId: actingAgentId,
            ...(heartbeatTurn
              ? {
                  window: {
                    after: heartbeatTurn.previousHeartbeatAt
                      ? new Date(heartbeatTurn.previousHeartbeatAt)
                      : null,
                    through: new Date(heartbeatTurn.scanWatermark),
                  },
                }
              : {}),
          });
          if (!agentInbox.ok) {
            return { success: false, error: "Failed to load agent inbox" };
          }
          const boundedNotifications = heartbeatTurn
            ? agentInbox.notifications.filter((notification) =>
                isNotificationInHeartbeatWindow(
                  notification.createdAt,
                  heartbeatTurn.previousHeartbeatAt,
                  heartbeatTurn.scanWatermark,
                )
              )
            : agentInbox.notifications;
          const visibleNotifications = boundedNotifications.slice(
            0,
            input.limit
          );
          return sanitizeForJson({
            success: true,
            user_notifications: visibleNotifications,
            ...buildCollectionMetadata(
              boundedNotifications.length,
              visibleNotifications.length
            ),
          });
        }
        if (input.archived) {
          const where: Prisma.NotificationWhereInput = {
            userId: user.id,
            agentId: null,
            archivedAt: { not: null },
            status: { not: "Deleted" },
          };
          const [total, notifications] = await Promise.all([
            prisma.notification.count({ where }),
            prisma.notification.findMany({
              include: notificationInboxInclude(user.id),
              where,
              orderBy: {
                archivedAt: { sort: "desc", nulls: "last" },
              },
              take: input.limit,
            }),
          ]);

          return sanitizeForJson({
            success: true,
            user_notifications: notifications,
            ...buildCollectionMetadata(total, notifications.length),
          });
        }

        const { status, json } = await notificationGetAll(user.id.toString());
        if (status !== 200 || !json || typeof json !== "object") {
          return { success: false, error: "Failed to load inbox" };
        }
        const payload = json as { notifications?: unknown[]; structuredData?: unknown };
        const notifications = payload.notifications ?? [];
        const visibleNotifications = notifications.slice(0, input.limit);
        return sanitizeForJson({
          success: true,
          user_notifications: visibleNotifications,
          ...buildCollectionMetadata(
            notifications.length,
            visibleNotifications.length
          ),
        });
      },
    }),

    hypertask_move_task_to_inbox: tool({
      description:
        "Route a task into a specific project member's inbox so they notice it.",
      inputSchema: z.object({
        task_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(TOOL_TASK_ID_DESCRIPTION),
        ticket_number: z.string().trim().min(1).optional(),
        unique_index: z.coerce.number().int().positive().optional(),
        project_id: z.coerce.number().int().positive().optional(),
        user_id: z.coerce.number().int().positive(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_move_task_to_inbox");
        const identifierCount = [
          input.task_id !== undefined,
          input.ticket_number !== undefined,
          input.unique_index !== undefined,
        ].filter(Boolean).length;
        if (identifierCount === 0) {
          return {
            success: false,
            error:
              "Either task_id, ticket_number, or (project_id + unique_index) must be provided",
          };
        }
        if (identifierCount > 1) {
          return {
            success: false,
            error:
              "Cannot provide multiple task identification methods. Use one of: task_id, ticket_number, or (project_id + unique_index)",
          };
        }
        if (input.unique_index !== undefined && input.project_id === undefined) {
          return {
            success: false,
            error: "project_id is required when using unique_index",
          };
        }

        const task = await findTaskByIdentifier(user, {
          task_id: input.task_id,
          ticket_number: input.ticket_number,
          unique_index: input.unique_index,
          project_id: input.project_id,
        });
        if (!task) {
          return { success: false, error: "Task not found or access denied" };
        }

        const memberCheck = await validateProjectMemberIds(task.projectId, [
          input.user_id,
        ]);
        if (memberCheck.error) {
          return { success: false, error: memberCheck.error.message };
        }
        if (memberCheck.invalidIds.length > 0) {
          return {
            success: false,
            error: `User ${input.user_id} is not a member of this project and cannot receive the task in their inbox.`,
          };
        }

        await ensureTaskMovedToInbox(
          { userId: input.user_id, projectId: task.projectId, taskId: task.id },
          {
            taskId: task.id,
            userId: input.user_id,
            projectId: task.projectId,
            type: "TaskMovedToInbox",
            fromUserId: input.user_id,
          },
        );
        return sanitizeForJson({
          success: true,
          message: "Task moved to inbox",
          taskId: task.id,
          userId: input.user_id,
        });
      }),
    }),

    hypertask_section: tool({
      description:
        "List, create, rename, or delete sections/columns for a project. Defaults to listing sections.",
      inputSchema: z.object({
        action: z.enum(["list", "create", "rename", "delete"]).default("list"),
        project_id: z.coerce.number().int().positive(),
        include_hidden: z.boolean().default(false),
        section_id: z.coerce.number().int().positive().optional(),
        title: z.string().max(200).optional(),
        after_section_id: z.coerce.number().int().positive().optional(),
        confirmed: z
          .boolean()
          .optional()
          .describe(
            "Set true only after the user explicitly confirms deleting this non-empty section and moving its tasks."
          ),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_section");
        if (input.action === "create") {
          const title = input.title?.trim();
          if (!title) {
            return { success: false, error: "title is required to create a section" };
          }
          const result = await createSection({
            projectId: input.project_id,
            title,
            userId: user.id,
            afterSectionId: input.after_section_id,
          });
          if (!result.success) {
            return {
              success: false,
              error: result.message || result.error,
            };
          }
          const taskCount = await prisma.task.count({
            where: {
              projectId: input.project_id,
              section: result.section.section_title,
              status: "Normal",
            },
          });
          void broadcastBoardChange(input.project_id, { originUserId: user.id });
          return sanitizeForJson({
            success: true,
            section: { ...result.section, taskCount },
            message: "Section created successfully",
          });
        }

        if (input.action === "rename") {
          if (!input.section_id) {
            return { success: false, error: "section_id is required to rename a section" };
          }
          const title = input.title?.trim();
          if (!title) {
            return { success: false, error: "title is required to rename a section" };
          }
          const result = await updateSection({
            projectId: input.project_id,
            sectionId: input.section_id,
            userId: user.id,
            title,
          });
          if (!result.success) {
            return {
              success: false,
              error: result.message || result.error,
            };
          }
          const taskCount = await prisma.task.count({
            where: {
              projectId: input.project_id,
              section: result.section.section_title,
              status: "Normal",
            },
          });
          void broadcastBoardChange(input.project_id, { originUserId: user.id });
          return sanitizeForJson({
            success: true,
            section: { ...result.section, taskCount },
            message: "Section updated successfully",
          });
        }

        if (input.action === "delete") {
          if (!input.section_id) {
            return { success: false, error: "section_id is required to delete a section" };
          }
          const hasAccess = await assertAccessibleProject(user.id, input.project_id);
          if (!hasAccess) {
            return { success: false, error: "Project not found or access denied" };
          }
          const section = await prisma.section.findFirst({
            where: {
              id: input.section_id,
              projectId: input.project_id,
              deleted: false,
            },
            select: { id: true, section_title: true },
          });
          if (!section) {
            return { success: false, error: "Section not found or access denied" };
          }
          const taskCount = await prisma.task.count({
            where: {
              projectId: input.project_id,
              OR: [
                { sectionId: section.id },
                { section: section.section_title },
              ],
              status: "Normal",
            },
          });
          if (taskCount > 0) {
            const operationKey = `delete-section:${input.project_id}:${section.id}`;
            const destination = await prisma.section.findFirst({
              where: {
                projectId: input.project_id,
                deleted: false,
                id: { not: section.id },
              },
              select: { id: true, section_title: true },
              orderBy: { ranking: "asc" },
            });
            if (!destination) {
              return {
                success: false,
                error:
                  "Cannot delete the only section while it still contains tasks.",
              };
            }
            if (
              await requireCrossMessageConfirmation({
                userId: user.id,
                sessionId: confirmationSessionId,
                operationKey,
                confirmed: input.confirmed,
                previewsIssuedThisRequest: bulkPreviewsIssued,
              }) === "preview"
            ) {
              return sanitizeForJson({
                success: false,
                confirmation_required: true,
                section,
                task_count: taskCount,
                destination_section: destination,
                message:
                  `Deleting this section would move ${taskCount} tasks` +
                  ` to "${destination.section_title}".` +
                  " Nothing has been changed yet. Ask the user to confirm, then call this tool in a new message with confirmed: true.",
              });
            }
          }
          const result = await deleteSection({
            projectId: input.project_id,
            sectionId: input.section_id,
            userId: user.id,
          });
          if (!result.success) {
            return {
              success: false,
              error: result.message || result.error,
            };
          }
          void broadcastBoardChange(input.project_id, { originUserId: user.id });
          return sanitizeForJson({
            success: true,
            message: result.message,
            moved_task_count: result.movedTaskCount,
            destination_section: result.destinationSection,
          });
        }

        const hasAccess = await assertAccessibleProject(user.id, input.project_id);
        if (!hasAccess) {
          return { success: false, error: "Project not found or access denied" };
        }

        const sections = await prisma.section.findMany({
          where: {
            projectId: input.project_id,
            deleted: false,
            ...(input.include_hidden ? {} : { visibility: true }),
          },
          select: {
            id: true,
            section_title: true,
            projectId: true,
            visibility: true,
            deleted: true,
            ranking: true,
          },
          orderBy: { ranking: "asc" },
        });

        const sectionList = await Promise.all(
          sections.map(async (section) => ({
            id: section.id,
            section_title: section.section_title,
            projectId: section.projectId,
            visibility: section.visibility,
            deleted: section.deleted,
            ranking: section.ranking,
            taskCount: await prisma.task.count({
              where: {
                projectId: input.project_id,
                section: section.section_title,
                status: "Normal",
              },
            }),
          }))
        );

        return sanitizeForJson({
          success: true,
          sections: sectionList,
          projectId: input.project_id,
        });
      }),
    }),

    hypertask_create_task: tool({
      description:
        "Create one or many tasks, up to 50 per call. For multiple tasks, pass tasks with each task's project_id and fields in one call instead of looping. Returns created tasks and per-task failures.",
      inputSchema: createTaskItemSchema.partial().extend({
        tasks: z
          .array(createTaskItemSchema)
          .max(MAX_BULK_TOOL_TARGETS)
          .optional()
          .describe("Tasks to create in one call. Prefer this over repeated tool calls."),
        confirmed: z
          .boolean()
          .optional()
          .describe(
            "Set true ONLY after the user has explicitly approved creating 4 or more tasks in their own message. Never set it to confirm your own proposal."
          ),
      }),
      execute: withToolErrors(async (rawInput) => {
        sendStatus("hypertask_create_task");
        const { tasks: bulkTasks, confirmed, ...singleTask } = rawInput;
        const requestedTasks: Partial<CreateTaskItemInput>[] = bulkTasks?.length
          ? bulkTasks
          : [singleTask];
        if (requestedTasks.length >= 4) {
          const operationKey = buildBulkOperationKey(
            "create-tasks",
            requestedTasks.map((task) => ({
              key: JSON.stringify([
                "project",
                task.project_id ?? null,
                "title",
                task.title ?? null,
              ]),
            }))
          );
          if (
            await requireCrossMessageConfirmation({
              userId: user.id,
              sessionId: confirmationSessionId,
              operationKey,
              confirmed,
              previewsIssuedThisRequest: bulkPreviewsIssued,
            }) === "preview"
          ) {
            return sanitizeForJson({
              success: false,
              confirmation_required: true,
              affected: requestedTasks.map((task) => ({
                project_id: task.project_id,
                title: task.title,
              })),
              message:
                `This would create ${requestedTasks.length} tasks. Nothing has been changed yet. ` +
                "End your turn now: list the tasks for the user and ask them to confirm. Only after they say yes, in a new message, call this tool again with confirmed: true.",
            });
          }
        }

        const createOneTask = async (taskInput: Partial<CreateTaskItemInput>) => {
        const parsed = createTaskItemSchema.safeParse(
          dropEmptyPadding(taskInput, [
            "description",
            "labels",
            "assignee_ids",
            "due_date",
            "section",
          ])
        );
        if (!parsed.success) {
          return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid task" };
        }
        const input = parsed.data;
        const projectCheck = await validateProjectAccess(input.project_id, user.id);
        if (projectCheck.error) {
          return { success: false, error: projectCheck.error.message };
        }

        let sectionId: number | undefined;
        if (input.section !== undefined) {
          const sectionWhere =
            typeof input.section === "number"
              ? { id: input.section, projectId: input.project_id, deleted: false }
              : {
                  projectId: input.project_id,
                  section_title: input.section,
                  deleted: false,
                };
          const found = await prisma.section.findFirst({
            where: sectionWhere,
            select: { id: true },
          });
          if (!found) {
            return {
              success: false,
              error: `Section "${input.section}" not found in this project`,
            };
          }
          sectionId = found.id;
        }
        const sectionCheck = await getSectionForTask(input.project_id, sectionId);
        if (sectionCheck.error) {
          return { success: false, error: sectionCheck.error.message };
        }
        const parentCheck = await validateParentTask(
          input.project_id,
          input.parent_task_id ?? undefined
        );
        if (parentCheck.error) {
          return { success: false, error: parentCheck.error.message };
        }

        const priorityIndex = input.priority
          ? PriorityConstants.find((p) => p.Priority_Value === input.priority)
              ?.priority_index ?? 0
          : 0;

        if (input.due_date && isNaN(new Date(input.due_date).getTime())) {
          return { success: false, error: `Invalid due_date: "${input.due_date}". Use an ISO-8601 date.` };
        }

        // Assignees must be project owner/members — same check hypertask_assign_user does.
        if (input.assignee_ids?.length) {
          const allowedMemberIds = await getMemberAndOwner(input.project_id);
          if (typeof allowedMemberIds === "string") {
            return { success: false, error: "Could not resolve project members" };
          }
          const allowedSet = new Set<number>(allowedMemberIds);
          const invalidIds = input.assignee_ids.filter((id: number) => !allowedSet.has(id));
          if (invalidIds.length > 0) {
            return {
              success: false,
              error: `User(s) ${invalidIds.join(", ")} are not members of this project and cannot be assigned.`,
            };
          }
        }

        try {
          const task = await createTask({
            projectId: input.project_id,
            title: input.title,
            description: input.description ? toStoredHtml(input.description) : "",
            sectionId: sectionCheck.section.id,
            sectionTitle: sectionCheck.section.section_title,
            userId: user.id,
            priorityIndex,
            estimateIndex: 0,
            dueDate: input.due_date ? new Date(input.due_date) : undefined,
            projectUniqueIdentifier: projectCheck.project.uniqueIdentifier,
            teamId: projectCheck.project.teamId,
            labels: input.labels || [],
            assigneeIds: input.assignee_ids,
            parentTaskId: input.parent_task_id ?? undefined,
            agentId: actingAgentId,
          });

          return sanitizeForJson({
            success: true,
            task: mapTaskToDetail(task, user.id),
            url: buildMcpTaskUrl(task.projectId, task.uniqueIndex),
          });
        } catch (error) {
          return { success: false, error: errorMessage(error) };
        }
        };

        const results = await Promise.all(
          requestedTasks.map(async (taskInput: Partial<CreateTaskItemInput>) => {
            try {
              return await createOneTask(taskInput);
            } catch (error) {
              return { success: false, error: errorMessage(error) };
            }
          })
        );
        if (!bulkTasks?.length) return results[0];

        const tasks = results.flatMap((result) =>
          result.success && "task" in result ? [result.task] : []
        );
        const failures = results.flatMap((result, index) =>
          result.success
            ? []
            : [{
                project_id: requestedTasks[index].project_id,
                title: requestedTasks[index].title,
                error: "error" in result ? result.error : "Task creation failed",
              }]
        );
        return sanitizeForJson({ success: tasks.length > 0, tasks, failures });
      }),
    }),

    hypertask_create_page: tool({
      description:
        "Create a long-form page attached to a Hypertask task. Content is treated as Markdown by default, or can be supplied as HTML.",
      inputSchema: z.object({
        task_id: z.coerce.number().int().positive(),
        title: z.string().max(500).optional(),
        content: z.string(),
        content_type: z.enum(["markdown", "html"]).optional(),
        parent_page_id: z.coerce.number().int().positive().optional(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_create_page");
        const task = await prisma.task.findUnique({
          where: { id: input.task_id },
          select: { projectId: true },
        });
        if (!task) {
          return { success: false, error: "Task not found" };
        }

        const access = await validateProjectAccess(task.projectId, user.id);
        if (access.error) {
          return { success: false, error: access.error.message };
        }

        const page = await createPage({
          taskId: input.task_id,
          title: input.title,
          content: input.content,
          contentType: input.content_type ?? "markdown",
          parentPageId: input.parent_page_id,
          userId: user.id,
          agentId: actingAgentId,
        });

        return sanitizeForJson({
          success: true,
          page: {
            publicId: page.publicId,
            id: page.id,
            title: page.title,
            version: page.version,
            url: getPageUrl(page.publicId),
          },
        });
      }),
    }),

    hypertask_get_page: tool({
      description:
        "Get a Hypertask page by numeric ID or public ID. Returns the page as Markdown by default, or as sanitized HTML when requested.",
      inputSchema: z.object({
        id: z.union([
          z.coerce.number().int().positive(),
          z.string(),
        ]),
        format: z.enum(["markdown", "html"]).optional(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_get_page");
        const page = await getPage(
          typeof input.id === "number"
            ? { id: input.id }
            : { publicId: input.id }
        );
        if (!page) {
          return { success: false, error: "Page not found" };
        }

        const access = await validateProjectAccess(page.projectId, user.id);
        if (access.error) {
          return { success: false, error: access.error.message };
        }

        const format = input.format ?? "markdown";
        return sanitizeForJson({
          success: true,
          page: {
            publicId: page.publicId,
            id: page.id,
            title: page.title,
            version: page.version,
            content:
              format === "html"
                ? page.contentHtml
                : htmlToMarkdown(page.contentHtml),
            content_type: format,
            task: {
              id: page.task.id,
              ticketNumber: page.task.ticketNumber,
              title: page.task.title,
              projectId: page.task.projectId,
              uniqueIndex: page.task.uniqueIndex,
            },
            subPages: page.subPages,
            updatedAt: page.updatedAt,
          },
        });
      }),
    }),

    hypertask_update_page: tool({
      description:
        "Update a Hypertask page with Markdown content by default. Use mode=append or mode=prepend to extend it, and if_version for conflict-safe edits based on a previously read version.",
      inputSchema: z.object({
        id: z.union([
          z.coerce.number().int().positive(),
          z.string(),
        ]),
        content: z.string(),
        content_type: z.enum(["markdown", "html"]).optional(),
        mode: z.enum(["replace", "append", "prepend"]).optional(),
        if_version: z.coerce.number().int().positive().optional(),
        note: z.string().optional(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_update_page");
        const existingPage = await getPage(
          typeof input.id === "number"
            ? { id: input.id }
            : { publicId: input.id }
        );
        if (!existingPage) {
          return { success: false, error: "Page not found" };
        }

        const access = await validateProjectAccess(
          existingPage.projectId,
          user.id
        );
        if (access.error) {
          return { success: false, error: access.error.message };
        }

        try {
          const page = await updatePage({
            id: existingPage.id,
            content: input.content,
            contentType: input.content_type ?? "markdown",
            mode: input.mode,
            ifVersion: input.if_version,
            note: input.note,
            userId: user.id,
            agentId: actingAgentId,
          });

          return sanitizeForJson({
            success: true,
            page: {
              publicId: page.publicId,
              id: page.id,
              version: page.version,
              url: getPageUrl(page.publicId),
            },
          });
        } catch (error) {
          if (error instanceof PageConflictError) {
            return {
              success: false,
              error: "version_conflict",
              current_version: error.currentVersion,
              current_content: htmlToMarkdown(error.currentContent.html),
            };
          }
          throw error;
        }
      }),
    }),

    hypertask_list_pages: tool({
      description:
        "List the non-archived Hypertask pages attached to a task or belonging to a project. Provide task_id, project_id, or both.",
      inputSchema: z.object({
        task_id: z.coerce.number().int().positive().optional(),
        project_id: z.coerce.number().int().positive().optional(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_list_pages");
        if (!input.task_id && !input.project_id) {
          return {
            success: false,
            error: "Either task_id or project_id is required",
          };
        }

        if (input.task_id) {
          const task = await prisma.task.findUnique({
            where: { id: input.task_id },
            select: { projectId: true },
          });
          if (!task) {
            return { success: false, error: "Task not found" };
          }

          const access = await validateProjectAccess(task.projectId, user.id);
          if (access.error) {
            return { success: false, error: access.error.message };
          }
        }

        if (input.project_id) {
          const access = await validateProjectAccess(input.project_id, user.id);
          if (access.error) {
            return { success: false, error: access.error.message };
          }
        }

        const pages = await listPages({
          taskId: input.task_id,
          projectId: input.project_id,
        });
        return sanitizeForJson({ success: true, pages });
      }),
    }),

    hypertask_search_pages: tool({
      description:
        "Search page titles and content across every Hypertask project the current user can access. Returns brief text snippets from matching long-form pages.",
      inputSchema: z.object({
        query: z.string().min(1),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_search_pages");
        const projectIds = await getAccessibleProjectIds(user.id);
        const matches = await searchPages({
          query: input.query,
          projectIds,
        });

        return sanitizeForJson({
          success: true,
          pages: matches.map((page) => ({
            publicId: page.publicId,
            id: page.id,
            title: page.title,
            taskId: page.taskId,
            snippet: page.contentText.slice(0, 200),
            updatedAt: page.updatedAt,
          })),
        });
      }),
    }),

    hypertask_page_history: tool({
      description:
        "List a page's saved versions, restore one, or archive the page. Restore REPLACES the current page content with the selected saved version. Archive hides the page. Always list versions first to get the required version_id.",
      inputSchema: z
        .object({
          action: z.enum(["versions", "restore", "archive"]),
          id: z.union([
            z.coerce.number().int().positive(),
            z.string().trim().min(1).max(100),
          ]),
          version_id: z.coerce
            .number()
            .int()
            .positive()
            .optional()
            .describe("Required when action is restore."),
        })
        .strict(),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_page_history");
        const identifier = parsePageIdentifier(input.id);
        if (!identifier) {
          return { success: false, error: "Invalid page identifier" };
        }

        const existingPage = await getPage(identifier);
        if (!existingPage) {
          return { success: false, error: "Page not found" };
        }

        const access = await validateProjectAccess(
          existingPage.projectId,
          user.id
        );
        if (access.error) {
          return { success: false, error: "Page not found" };
        }

        if (input.action === "versions") {
          const versions = await listPageVersions({ pageId: existingPage.id });
          return sanitizeForJson({
            success: true,
            versions: versions.map((version) => ({
              id: version.id,
              version: version.version,
              title: version.title,
              note: version.note,
              authorId: version.authorId,
              agentId: version.agentId,
              createdAt: version.createdAt,
            })),
          });
        }

        if (input.action === "restore") {
          if (input.version_id === undefined) {
            return {
              success: false,
              error: "version_id is required for restore",
            };
          }

          const page = await restorePageVersion({
            pageId: existingPage.id,
            versionId: input.version_id,
            userId: user.id,
            agentId: actingAgentId,
          });
          return sanitizeForJson({
            success: true,
            page: {
              publicId: page.publicId,
              id: page.id,
              version: page.version,
            },
          });
        }

        await archivePage({
          id: existingPage.id,
          userId: user.id,
          agentId: actingAgentId,
        });
        return { success: true, ok: true };
      }),
    }),

    hypertask_list_reports: tool({
      description:
        "List the reports on one Hypertask project/board. Returns each report's id, slug, title, and url.",
      inputSchema: z.object({
        project_id: z.coerce.number().int().positive(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_list_reports");
        const access = await validateProjectAccess(input.project_id, user.id);
        if (access.error) {
          return { success: false, error: access.error.message };
        }

        const reports = await listReports({
          userId: user.id,
          projectId: input.project_id,
        });
        if (!reports) {
          return { success: false, error: "Project not found or access denied" };
        }

        return sanitizeForJson({
          success: true,
          reports: reports.map((report) => ({
            id: report.id,
            slug: report.slug,
            title: report.title,
            url: getReportUrl(report.projectId, report.slug),
          })),
        });
      }),
    }),

    hypertask_get_report: tool({
      description:
        "Get one saved HTML report, including its complete body, from an accessible Hypertask project/board.",
      inputSchema: z
        .object({
          project_id: z.coerce.number().int().positive(),
          slug: z.string().trim().min(1).max(64),
        })
        .strict(),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_get_report");
        const report = await getReport({
          userId: user.id,
          agentId: actingAgentId,
          projectId: input.project_id,
          slug: input.slug,
        });
        if (!report) {
          return { success: false, error: "Report not found or access denied" };
        }

        return sanitizeForJson({
          success: true,
          report: {
            id: report.id,
            project_id: report.projectId,
            slug: report.slug,
            title: report.title,
            description: report.description,
            body_html: report.bodyHtml,
            created_at: report.createdAt,
            updated_at: report.updatedAt,
            url: getReportUrl(report.projectId, report.slug),
          },
        });
      }),
    }),

    hypertask_create_report: tool({
      description: `Create a standalone HTML report on one Hypertask project/board. Pick a short kebab-case slug, put all data in the HTML because it cannot be fetched later, and give the user the returned url. ${REPORT_CAPABILITIES}`,
      inputSchema: z.object({
        project_id: z.coerce.number().int().positive(),
        slug: z.string().max(64).regex(REPORT_SLUG_RE),
        title: z.string().trim().min(1).max(200),
        description: z.string().optional(),
        body_html: z.string().max(REPORT_BODY_MAX),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_create_report");
        const access = await validateProjectAccess(input.project_id, user.id);
        if (access.error) {
          return { success: false, error: access.error.message };
        }

        try {
          const report = await createReport({
            userId: user.id,
            projectId: input.project_id,
            slug: input.slug,
            title: input.title,
            description: input.description,
            bodyHtml: input.body_html,
          });
          if (!report) {
            return { success: false, error: "Project not found or access denied" };
          }

          return sanitizeForJson({
            success: true,
            report: {
              id: report.id,
              slug: report.slug,
              title: report.title,
              url: getReportUrl(report.projectId, report.slug),
            },
          });
        } catch (error) {
          if (error instanceof ReportValidationError) {
            return { success: false, error: error.message };
          }
          throw error;
        }
      }),
    }),

    hypertask_update_report: tool({
      description: `Update a standalone HTML report on one Hypertask project/board. Pick a short kebab-case slug, put all data in the HTML because it cannot be fetched later, and give the user the returned url. ${REPORT_CAPABILITIES}`,
      inputSchema: z.object({
        project_id: z.coerce.number().int().positive(),
        slug: z.string().max(64).regex(REPORT_SLUG_RE),
        title: z.string().trim().min(1).max(200).optional(),
        description: z.string().optional(),
        body_html: z.string().max(REPORT_BODY_MAX).optional(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_update_report");
        const access = await validateProjectAccess(input.project_id, user.id);
        if (access.error) {
          return { success: false, error: access.error.message };
        }

        try {
          const report = await updateReport({
            userId: user.id,
            projectId: input.project_id,
            slug: input.slug,
            title: input.title,
            description: input.description,
            bodyHtml: input.body_html,
          });
          if (!report) {
            return { success: false, error: "Report not found or access denied" };
          }

          return sanitizeForJson({
            success: true,
            report: {
              id: report.id,
              slug: report.slug,
              title: report.title,
              url: getReportUrl(report.projectId, report.slug),
            },
          });
        } catch (error) {
          if (error instanceof ReportValidationError) {
            return { success: false, error: error.message };
          }
          throw error;
        }
      }),
    }),

    hypertask_delete_report: tool({
      description:
        "Delete one saved HTML report. This is destructive: first preview the exact report, then ask for confirmation and end the turn. Set confirmed=true only after the user approves in a later message.",
      inputSchema: z
        .object({
          project_id: z.coerce.number().int().positive(),
          slug: z.string().trim().min(1).max(64),
          confirmed: z.boolean().optional(),
        })
        .strict(),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_delete_report");
        const existing = await getReport({
          userId: user.id,
          agentId: actingAgentId,
          projectId: input.project_id,
          slug: input.slug,
        });
        if (!existing) {
          return { success: false, error: "Report not found or access denied" };
        }

        const operationKey = buildBulkOperationKey("delete-report", [
          { key: `report:${existing.id}` },
        ]);
        if (
          (await requireCrossMessageConfirmation({
            userId: user.id,
            sessionId: confirmationSessionId,
            operationKey,
            confirmed: input.confirmed,
            previewsIssuedThisRequest: bulkPreviewsIssued,
          })) === "preview"
        ) {
          return sanitizeForJson({
            success: false,
            confirmation_required: true,
            report: {
              id: existing.id,
              title: existing.title,
              slug: existing.slug,
              url: getReportUrl(existing.projectId, existing.slug),
            },
            message:
              "Nothing changed. End your turn, show this exact report to the user, and ask them to confirm deletion. Only after they approve in a new message, call this tool again with confirmed=true.",
          });
        }

        const deleted = await deleteReport({
          userId: user.id,
          agentId: actingAgentId,
          projectId: input.project_id,
          slug: input.slug,
        });
        if (!deleted) {
          return { success: false, error: "Report not found or access denied" };
        }

        return sanitizeForJson({
          success: true,
          report: {
            id: deleted.id,
            project_id: deleted.projectId,
            slug: deleted.slug,
            title: deleted.title,
            url: getReportUrl(deleted.projectId, deleted.slug),
          },
        });
      }),
    }),

    hypertask_list_labels: tool({
      description:
        "List labels available on one project/board. Use before assigning labels when you need valid label IDs.",
      inputSchema: z.object({
        project_id: z.coerce
          .number()
          .int()
          .positive()
          .describe(
            "Project/board id from Hypertask context or task results. Do not guess it from a ticket number."
          ),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_list_labels");
        const access = await validateProjectAccess(input.project_id, user.id);
        if (access.error) {
          return { success: false, error: access.error.message };
        }

        const labels = await prisma.label.findMany({
          where: { projectId: input.project_id },
          select: { id: true, value: true },
          orderBy: { value: "asc" },
        });

        return sanitizeForJson({
          success: true,
          projectId: input.project_id,
          labels: labels.map((label) => ({
            id: label.id,
            name: label.value || "",
          })),
        });
      }),
    }),

    hypertask_create_label: tool({
      description:
        "Create a new label in a project/board.",
      inputSchema: z.object({
        project_id: z.coerce.number().int().positive(),
        name: z.string().min(1).max(100),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_create_label");
        const access = await validateProjectAccess(input.project_id, user.id);
        if (access.error) {
          return { success: false, error: access.error.message };
        }

        const trimmedName = input.name.trim();
        if (!trimmedName) {
          return { success: false, error: "name must not be empty" };
        }

        const existing = await prisma.label.findFirst({
          where: {
            projectId: input.project_id,
            value: trimmedName,
          },
        });
        if (existing) {
          return {
            success: false,
            error: `Label "${trimmedName}" already exists in this project`,
          };
        }

        const label = await prisma.label.create({
          data: {
            value: trimmedName,
            projectId: input.project_id,
          },
        });

        void broadcastBoardChange(input.project_id, { originUserId: user.id });

        return sanitizeForJson({
          success: true,
          label: {
            id: label.id,
            name: label.value || trimmedName,
          },
          message: `Label "${trimmedName}" created successfully`,
        });
      }),
    }),

    hypertask_update_task: tool({
      description:
        "Update one or many tasks' titles, descriptions, priorities, estimates, due dates, labels, parents, or statuses (Normal/Archive/Deleted), or move them within their own boards. Use task_ids or ticket_numbers to update up to 50 tasks in one call instead of looping. Provide whichever task identifier you know; extra identifiers are tolerated.",
      inputSchema: z
        .object({
        task_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(TOOL_TASK_ID_DESCRIPTION),
        task_ids: z
          .array(z.coerce.number().int().positive())
          .max(MAX_BULK_TOOL_TARGETS)
          .optional(),
        ticket_number: z.string().optional(),
        ticket_numbers: z
          .array(z.string())
          .max(MAX_BULK_TOOL_TARGETS)
          .optional(),
        unique_index: z.coerce.number().int().positive().optional(),
        project_id: z.coerce.number().int().positive().optional(),
        title: z.string().min(1).max(500).optional(),
        description: z.string().max(20000).optional(),
        priority: z
          .enum(["No Priority", "Urgent", "High", "Medium", "Low"])
          .optional(),
        estimate: z.coerce
          .number()
          .int()
          .refine((value) => [0, 2, 3, 4, 5, 6].includes(value), {
            message: "estimate must be one of 0, 2, 3, 4, 5, 6",
          })
          .optional()
          .describe(
            "Story-point estimate. Allowed values: 0 (none), 2, 3, 4, 5, 6."
          ),
        due_date: z.string().nullable().optional(),
        status: z.enum(["Normal", "Archive", "Deleted"]).optional(),
        parent_task_id: z.coerce.number().int().positive().nullable().optional(),
        section: z
          .union([z.coerce.number().int().positive(), z.string().min(1)])
          .optional()
          .describe(
            "Only pass section when the user explicitly asks to move the task to a different section/column. Never infer it."
          ),
        labels: z
          .array(z.union([z.string(), z.number()]))
          .optional()
          .describe(
            "Label names or ids. This REPLACES every label on the task, so any label not listed here is removed. To add or remove a single tag while keeping the others, use add_labels/remove_labels instead."
          ),
        add_labels: z
          .array(z.union([z.string(), z.number()]))
          .optional()
          .describe(
            "Label names or ids to add, leaving the task's other labels untouched."
          ),
        remove_labels: z
          .array(z.union([z.string(), z.number()]))
          .optional()
          .describe(
            "Label names or ids to remove, leaving the task's other labels untouched."
          ),
        confirmed: z
          .boolean()
          .optional()
          .describe(
            "Set true ONLY after the user has explicitly approved this exact wide/destructive write in their own message. Never set it to confirm your own proposal."
          ),
        })
        .refine(
          (input) => bulkTaskTargetCount(input) <= MAX_BULK_TOOL_TARGETS,
          {
            message: `Pass no more than ${MAX_BULK_TOOL_TARGETS} combined task_ids and ticket_numbers`,
            path: ["task_ids"],
          }
        ),
      execute: withToolErrors(async (rawInput) => {
        sendStatus("hypertask_update_task");
        const input = dropEmptyPadding(rawInput, [
          "title",
          "description",
          "labels",
          "add_labels",
          "remove_labels",
          "ticket_number",
          "task_ids",
          "ticket_numbers",
          "due_date",
        ]);
        const updateOneTask = async (
          identifier: ToolTaskIdentifierInput,
          taskResult?: ResolveTaskForToolResult
        ) => {
          taskResult ??= await resolveTaskForTool(user, identifier);
        if (taskResult.error) {
          return { success: false, error: taskResult.error };
        }

        const hasNonSectionUpdate =
          input.title !== undefined ||
          input.description !== undefined ||
          input.priority !== undefined ||
          input.estimate !== undefined ||
          input.due_date !== undefined ||
          input.status !== undefined ||
          input.parent_task_id !== undefined ||
          input.labels !== undefined ||
          input.add_labels !== undefined ||
          input.remove_labels !== undefined;
        const hasUpdate = hasNonSectionUpdate || input.section !== undefined;
        if (!hasUpdate) {
          return { success: false, error: "Provide at least one field to update" };
        }

        const task = taskResult.task;
        if (!task) {
          return { success: false, error: "Task not found or access denied" };
        }

        let sectionTarget: { id: number; section_title: string } | null = null;
        let sectionWarning: string | undefined;
        if (input.section !== undefined) {
          const sectionWhere =
            typeof input.section === "number"
              ? { id: input.section, projectId: task.projectId, deleted: false }
              : {
                  projectId: task.projectId,
                  section_title: input.section,
                  deleted: false,
                };
          sectionTarget = await prisma.section.findFirst({
            where: sectionWhere,
            select: { id: true, section_title: true },
          });
          if (!sectionTarget) {
            if (hasNonSectionUpdate) {
              sectionWarning = `Section "${input.section}" not found on this board -- section unchanged; other fields updated.`;
            } else {
              return {
                success: false,
                error: `Section "${input.section}" not found in this task's board. Cross-board moves aren't supported here.`,
              };
            }
          }
        }

        const userObj = await prisma.user.findUnique({
          where: { id: user.id },
          select: { id: true, email: true, displayName: true, photoURL: true },
        });
        if (!userObj) return { success: false, error: "User not found" };
        const activityUser = buildActivityUser(userObj);

        const oldTask = await prisma.task.findUnique({
          where: { id: task.id },
          select: { section: true, sectionId: true, status: true, dueDate: true },
        });
        if (!oldTask) return { success: false, error: "Task not found" };

        const patch: Record<string, unknown> = { id: task.id };
        if (input.title !== undefined) patch.title = input.title;
        if (input.description !== undefined)
          patch.description = toStoredHtml(input.description);
        if (input.parent_task_id !== undefined) patch.parentTaskId = input.parent_task_id;
        const dueDateValue =
          input.due_date === undefined
            ? undefined
            : input.due_date === null
              ? null
              : new Date(input.due_date);
        if (dueDateValue instanceof Date && isNaN(dueDateValue.getTime())) {
          return { success: false, error: `Invalid due_date: "${input.due_date}". Use an ISO-8601 date.` };
        }
        if (dueDateValue !== undefined) patch.dueDate = dueDateValue;
        if (input.status !== undefined) {
          patch.status = input.status;
          patch.archivedAt = input.status === "Archive" ? new Date() : null;
        }
        if (sectionTarget) {
          const lastTask = await prisma.task.findFirst({
            where: {
              sectionId: sectionTarget.id,
              projectId: task.projectId,
              status: "Normal",
            },
            orderBy: { ranking: "desc" },
            select: { ranking: true },
          });
          patch.sectionId = sectionTarget.id;
          patch.section = sectionTarget.section_title;
          patch.ranking = generateRank(lastTask?.ranking, undefined);
        }

        if (Object.keys(patch).length > 1) {
          const result = await updateTaskSingle(
            patch,
            activityUser,
            actingAgentId,
            sectionTarget
              ? {
                  taskMovedActivity: {
                    sendNotification: () =>
                      sendNotificationForTask(
                        user.id,
                        "TaskMoved",
                        task.id,
                        task.projectId,
                        actingAgentId ?? undefined,
                      ),
                  },
                }
              : {},
          );
          if (result.status !== 200) {
            return {
              success: false,
              error:
                (result.json as { message?: string })?.message ||
                "Failed to update task",
            };
          }
        }

        if (input.status !== undefined && oldTask.status !== input.status) {
          await createArchiveActivity({
            taskId: task.id,
            fromUserId: user.id,
            fromUserDisplayName: userObj.displayName ?? "",
            fromUser: activityUser,
            newStatus: input.status,
          });
          if (input.status === "Archive") {
            await cancelDueDateJob(task.id, task.projectId);
          }
          await sendNotificationForTask(
            user.id,
            "TaskArchived",
            task.id,
            task.projectId,
            undefined
          );
        }

        if (dueDateValue !== undefined) {
          const dueDateChanged =
            (oldTask.dueDate?.getTime() ?? null) !== (dueDateValue?.getTime() ?? null);
          if (dueDateChanged) {
            await createTaskDueDateActivity({
              userObj: activityUser,
              taskId: task.id,
              toDueDate: dueDateValue ?? undefined,
              fromDueDate: oldTask.dueDate ?? undefined,
            });
            await cancelDueDateJob(task.id, task.projectId);
            if (dueDateValue) {
              await scheduleDueDateJob(
                { taskId: task.id, projectId: task.projectId },
                dueDateValue
              );
            }
            await sendNotificationForTask(
              user.id,
              "TaskDueDate",
              task.id,
              task.projectId,
              undefined
            );
          }
        }

        if (input.priority !== undefined) {
          const priorityResult = await applyPriorityUpdate(
            task.id,
            input.priority,
            user.id,
            activityUser
          );
          if (priorityResult.error) {
            return { success: false, error: priorityResult.error };
          }
        }

        if (input.estimate !== undefined) {
          const estimateResult = await applyEstimateUpdate(
            task.id,
            input.estimate,
            user.id,
            activityUser
          );
          if (estimateResult.error) {
            return { success: false, error: estimateResult.error };
          }
        }

        const labelActor = {
          id: userObj.id,
          email: userObj.email ?? "",
          displayName: userObj.displayName,
          photoURL: userObj.photoURL,
        };
        if (input.labels !== undefined) {
          await setTaskLabels(task.id, task.projectId, input.labels, labelActor);
        }
        if (input.add_labels !== undefined || input.remove_labels !== undefined) {
          await mutateTaskLabels(
            task.id,
            task.projectId,
            { add: input.add_labels, remove: input.remove_labels },
            labelActor
          );
        }

        const finalTask = await prisma.task.findUnique({
          where: { id: task.id },
          include: taskDetailInclude(user.id),
        });
        if (!finalTask) {
          return { success: false, error: "Task updated but could not be retrieved" };
        }

        void broadcastBoardChange(finalTask.projectId, { originUserId: user.id });
        void broadcastTaskChange(finalTask.id, { originUserId: user.id });

        return sanitizeForJson({
          success: true,
          task: mapTaskToDetail(finalTask, user.id),
          url: buildMcpTaskUrl(finalTask.projectId, finalTask.uniqueIndex),
          ...(sectionWarning ? { warning: sectionWarning } : {}),
        });
        };

        const targets = resolveBulkTaskTargets(input);
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
        // HTPR-4218: wide or destructive writes get shown to the user first.
        const destructive =
          input.status === "Deleted" || input.status === "Archive";
        // HTPR-5536: a tag change is reversible, so it never confirms.
        const needsConfirmation = updateTasksNeedConfirmation({
          targetCount: targets.length,
          update: input,
        });
        if (needsConfirmation) {
          const operationChanges: unknown[] = [];
          if (input.title !== undefined) {
            operationChanges.push(["title", input.title]);
          }
          if (input.description !== undefined) {
            operationChanges.push(["description", input.description]);
          }
          if (input.priority !== undefined) {
            operationChanges.push(["priority", input.priority]);
          }
          if (input.estimate !== undefined) {
            operationChanges.push(["estimate", input.estimate]);
          }
          if (input.due_date !== undefined) {
            operationChanges.push(["due_date", input.due_date]);
          }
          if (input.status !== undefined) {
            operationChanges.push(["status", input.status]);
          }
          if (input.parent_task_id !== undefined) {
            operationChanges.push(["parent_task_id", input.parent_task_id]);
          }
          if (input.section !== undefined) {
            operationChanges.push(["section", input.section]);
          }
          if (input.labels !== undefined) {
            operationChanges.push([
              "labels",
              [...input.labels].sort((left, right) =>
                JSON.stringify(left).localeCompare(JSON.stringify(right))
              ),
            ]);
          }
          if (input.add_labels !== undefined) {
            operationChanges.push([
              "add_labels",
              [...input.add_labels].sort((left, right) =>
                JSON.stringify(left).localeCompare(JSON.stringify(right))
              ),
            ]);
          }
          if (input.remove_labels !== undefined) {
            operationChanges.push([
              "remove_labels",
              [...input.remove_labels].sort((left, right) =>
                JSON.stringify(left).localeCompare(JSON.stringify(right))
              ),
            ]);
          }
          const operationKey = buildBulkOperationKey(
            "update-tasks",
            operationTargets.map(({ identifier, resolution }) => ({
              identifier,
              resolvedTaskId: resolution.task?.id ?? null,
            })),
            operationChanges
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
                if (!details) {
                  return { ...identifier, error: "Not found" };
                }
                return {
                  task_id: details.id,
                  title: details.title,
                  url: buildMcpTaskUrl(details.projectId, details.uniqueIndex),
                };
              })
            );
            return sanitizeForJson({
              success: false,
              confirmation_required: true,
              affected,
              message:
                `This would change ${targets.length} tasks` +
                (destructive ? ` (status: ${input.status})` : "") +
                ". Nothing has been changed yet. End your turn now: list the affected tasks for the user and ask them to confirm. Only after they say yes, in a new message, call this tool again with confirmed: true.",
            });
          }
        }

        const results = await Promise.all(
          operationTargets.map(async ({ identifier, resolution }) => {
            try {
              return await updateOneTask(identifier, resolution);
            } catch (error) {
              return { success: false, error: errorMessage(error) };
            }
          })
        );

        if (results.length === 1) return results[0];

        const tasks = results.flatMap((result) =>
          result.success && "task" in result ? [result.task] : []
        );
        const failures = results.flatMap((result, index) =>
          "task" in result
            ? []
            : [{
                ...operationTargets[index].identifier,
                error: "error" in result ? result.error : "Task update failed",
              }]
        );
        return sanitizeForJson({
          success: tasks.length > 0,
          partial: tasks.length > 0 && failures.length > 0,
          succeeded_count: tasks.length,
          failed_count: failures.length,
          tasks,
          failures,
        });
      }),
    }),

    hypertask_add_comment: tool({
      description:
        `Add the same comment to one or many tasks. For multiple tasks, pass up to 50 combined task_ids or ticket_numbers in one call instead of looping. Supports plain-text @mentions and image attachment URLs. ${COMMENT_TASK_LINK_RULE}`,
      inputSchema: z
        .object({
        task_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(TOOL_TASK_ID_DESCRIPTION),
        task_ids: z
          .array(z.coerce.number().int().positive())
          .max(MAX_BULK_TOOL_TARGETS)
          .optional(),
        ticket_number: z.string().optional(),
        ticket_numbers: z
          .array(z.string())
          .max(MAX_BULK_TOOL_TARGETS)
          .optional(),
        unique_index: z.coerce.number().int().positive().optional(),
        project_id: z.coerce.number().int().positive().optional(),
        text: z.string().min(1).max(5000),
        images: z.array(z.string()).optional(),
        mentions: z
          .array(
            z.object({
              user_id: z.coerce.number().int().positive(),
              display_name: z.string(),
            })
          )
          .optional(),
        confirmed: z
          .boolean()
          .optional()
          .describe(
            "Set true ONLY after the user has explicitly approved commenting on 4 or more tasks in their own message. Never set it to confirm your own proposal."
          ),
        })
        .refine(
          (input) => bulkTaskTargetCount(input) <= MAX_BULK_TOOL_TARGETS,
          {
            message: `Pass no more than ${MAX_BULK_TOOL_TARGETS} combined task_ids and ticket_numbers`,
            path: ["task_ids"],
          }
        ),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_add_comment");
        const targets = resolveBulkTaskTargets(input);
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
        if (targets.length >= 4) {
          const operationKey = buildBulkOperationKey(
            "comment-on-tasks",
            operationTargets.map(({ identifier, resolution }) => ({
              identifier,
              resolvedTaskId: resolution.task?.id ?? null,
            })),
            [["text", input.text.trim()]]
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
                `This would comment on ${targets.length} tasks. Nothing has been changed yet. ` +
                "End your turn now: list the affected tasks for the user and ask them to confirm. Only after they say yes, in a new message, call this tool again with confirmed: true.",
            });
          }
        }

        const userObj = await prisma.user.findUnique({
          where: { id: user.id },
          select: { id: true, email: true, displayName: true, photoURL: true },
        });
        if (!userObj) return { success: false, error: "User not found" };

        const addCommentToTask = async ({
          identifier,
          resolution: taskResult,
        }: (typeof operationTargets)[number]) => {
        if (taskResult.error) {
          return { success: false, error: taskResult.error };
        }

        const task = taskResult.task;
        if (!task) {
          return { success: false, error: "Task not found or access denied" };
        }

        const taskWithOwner = await prisma.task.findUnique({
          where: { id: task.id },
          select: { id: true, title: true, userId: true, projectId: true, uniqueIndex: true },
        });
        if (!taskWithOwner) return { success: false, error: "Task not found" };

        // Mentions resolve BEFORE the HTML conversion: both matchers look for a literal
        // "@Name", and conversion escapes the apostrophe in "@O'Brien" (and the & in
        // "@R&D Bot") so the match would silently fail and nobody would be notified.
        let sanitizedText = input.text.trim();
        if (input.mentions?.length) {
          sanitizedText = convertPlainTextMentionsToHtml(sanitizedText, input.mentions);
        }
        sanitizedText = await resolveTextMentions(
          sanitizedText,
          taskWithOwner.projectId,
          user.id,
        );
        sanitizedText = toStoredHtml(sanitizedText);
        sanitizedText = await linkifyTicketRefs(
          sanitizedText,
          user.id,
          actingAgentId
        );

        const comment = await createCommentService({
          text: sanitizedText,
          creatorId: user.id,
          taskId: task.id,
          ownerId: taskWithOwner.userId,
          currentUser: userObj,
          agentId: actingAgentId,
        });

        const imageUrls = input.images?.length
          ? buildMcpImageUrls(input.images, task.id)
          : [];
        await persistUrlsForComment(sanitizedText, task.id, comment.id, "POST", imageUrls);

        const commentWithAttachments = await prisma.comment.findUnique({
          where: { id: comment.id },
          include: commentInclude(user.id),
        });

        void broadcastTaskComment(task.id, { originUserId: user.id });

        return sanitizeForJson({
          success: true,
          task: {
            id: taskWithOwner.id,
            title: taskWithOwner.title,
            url: buildMcpTaskUrl(taskWithOwner.projectId, taskWithOwner.uniqueIndex),
          },
          comment: commentWithAttachments
            ? mapCommentToResponse(commentWithAttachments, user.id)
            : { id: comment.id, text: sanitizedText },
          url: buildMcpTaskUrl(taskWithOwner.projectId, taskWithOwner.uniqueIndex),
        });
        };

        const results = await Promise.all(
          operationTargets.map(async (target) => {
            try {
              return await addCommentToTask(target);
            } catch (error) {
              return { success: false, error: errorMessage(error) };
            }
          })
        );
        if (results.length === 1) return results[0];

        const tasks = results.flatMap((result) =>
          result.success && "task" in result
            ? [{ ...result.task, comment: result.comment }]
            : []
        );
        const failures = results.flatMap((result, index) =>
          result.success
            ? []
            : [{
                ...operationTargets[index].identifier,
                error: "error" in result ? result.error : "Comment failed",
              }]
        );
        return sanitizeForJson({ success: tasks.length > 0, tasks, failures });
      }),
    }),

    hypertask_decision_request: tool({
      description:
        "Create a durable request for a human decision on a task, with 2-10 distinct options.",
      inputSchema: z.object({
        task_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(TOOL_TASK_ID_DESCRIPTION),
        ticket_number: z.string().trim().min(1).optional(),
        unique_index: z.coerce.number().int().positive().optional(),
        project_id: z.coerce.number().int().positive().optional(),
        question: z.string().min(1).max(2000),
        options: z.array(z.string().min(1).max(200)).min(2).max(10),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_decision_request");
        const identifierValidation = validateTaskIdentifier({
          task_id: input.task_id,
          ticket_number: input.ticket_number,
          project_id: input.project_id,
          unique_index: input.unique_index,
        });
        if (!identifierValidation.valid) {
          return { success: false, error: identifierValidation.error };
        }

        const question = input.question.trim();
        const options = input.options.map((option: string) => option.trim());
        if (!question) {
          return { success: false, error: "question is required" };
        }
        if (options.some((option: string) => !option)) {
          return {
            success: false,
            error: "each option must be a non-empty string",
          };
        }
        if (new Set(options).size !== options.length) {
          return { success: false, error: "options must not contain duplicates" };
        }

        const task = await findTaskByIdentifier(user, {
          task_id: input.task_id,
          ticket_number: input.ticket_number,
          project_id: input.project_id,
          unique_index: input.unique_index,
        });
        if (!task) {
          return { success: false, error: "Task not found or access denied" };
        }

        const [taskOwner, currentUser] = await Promise.all([
          prisma.task.findUnique({
            where: { id: task.id },
            select: { userId: true },
          }),
          prisma.user.findUnique({
            where: { id: user.id },
            select: {
              id: true,
              email: true,
              displayName: true,
              photoURL: true,
            },
          }),
        ]);
        if (!taskOwner || !currentUser) {
          return { success: false, error: "Task not found or access denied" };
        }

        const decisionRequest = await prisma.decisionRequest.create({
          data: {
            taskId: task.id,
            question,
            options,
            status: DecisionRequestStatus.Pending,
            createdById: user.id,
            agentId: actingAgentId,
          },
        });
        const optionItems = options
          .map((option: string) => `<li>${escapeHtml(option)}</li>`)
          .join("");
        const comment = await createCommentService({
          text: sanitizeRichHtml(
            `<p><strong>Decision needed:</strong> ${escapeHtml(question)}</p>` +
              `<ol>${optionItems}</ol>` +
              "<p>Reply with your choice, or this will be answerable from the UI soon.</p>"
          ),
          creatorId: user.id,
          taskId: task.id,
          ownerId: taskOwner.userId,
          currentUser,
          agentId: actingAgentId,
        });
        const savedDecisionRequest = await prisma.decisionRequest.update({
          where: { id: decisionRequest.id },
          data: { commentId: comment.id },
        });

        return sanitizeForJson({
          success: true,
          decision_request: {
            id: savedDecisionRequest.id,
            taskId: savedDecisionRequest.taskId,
            question: savedDecisionRequest.question,
            options: savedDecisionRequest.options,
            status: savedDecisionRequest.status.toLowerCase(),
            answer: savedDecisionRequest.answer,
            answerNote: savedDecisionRequest.answerNote,
            createdAt: savedDecisionRequest.createdAt,
            answeredAt: savedDecisionRequest.answeredAt,
            commentId: savedDecisionRequest.commentId,
          },
          comment_id: comment.id,
        });
      }),
    }),

    hypertask_attach_files: tool({
      description:
        "Attach files from public URLs to a task description or to an existing task comment. URL-sourced only; chat cannot upload local files or base64 data.",
      inputSchema: z.object({
        task_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(TOOL_TASK_ID_DESCRIPTION),
        ticket_number: z
          .string()
          .optional()
          .describe(
            "Ticket number such as HTPR-1234. Prefer this when the user gives a ticket number; do not also invent task_id."
          ),
        unique_index: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Task's board-local numeric index. Only pass with project_id; do not use it by itself."
          ),
        project_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Project/board id required with unique_index and useful to disambiguate ticket_number. Omit when only task_id is known."
          ),
        comment_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Existing comment id on the task. Only pass when attaching to that specific comment; omit to attach to the task description."
          ),
        attachments: z
          .array(
            z.object({
              url: z
                .string()
                .url()
                .describe(
                  "Public http(s) URL to fetch. Do not pass local file paths, data URLs, private intranet URLs, or already-uploaded local files."
                ),
              filename: z
                .string()
                .max(255)
                .optional()
                .describe(
                  "Optional display filename without path segments. Omit to derive a filename from the URL or MIME type."
                ),
            })
          )
          .min(1)
          .max(MCP_ATTACHMENT_MAX_FILES)
          .describe(
            "Files to attach from URLs only. Do not include content_type, base64 data, or local upload handles."
          ),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_attach_files");
        const taskResult = await resolveTaskForTool(user, {
          task_id: input.task_id,
          ticket_number: input.ticket_number,
          unique_index: input.unique_index,
          project_id: input.project_id,
        });
        if (taskResult.error) {
          return { success: false, error: taskResult.error };
        }

        const task = taskResult.task;
        if (!task) {
          return { success: false, error: "Task not found or access denied" };
        }

        const fetchedByIndex: Array<{ buffer: Buffer; contentType: string }> = [];
        const filesForValidation: Array<{
          filename: string;
          content_type: string;
          url: string;
        }> = [];

        for (const [index, attachment] of input.attachments.entries()) {
          let fetched: { buffer: Buffer; contentType: string };
          try {
            fetched = await safeFetchAttachmentUrl(attachment.url);
          } catch (error) {
            if (error instanceof McpAttachmentFetchError) {
              return { success: false, error: error.message };
            }
            throw error;
          }

          if (!bufferMatchesDeclaredMime(fetched.buffer, fetched.contentType)) {
            return {
              success: false,
              error: "Downloaded content does not match declared content type",
            };
          }

          fetchedByIndex.push(fetched);
          filesForValidation.push({
            filename:
              attachment.filename?.trim() ||
              deriveChatAttachmentFilename(
                attachment.url,
                fetched.contentType,
                index
              ),
            content_type: fetched.contentType,
            url: attachment.url,
          });
        }

        let parsed: ReturnType<typeof parseAndValidateAttachmentsBody>;
        try {
          parsed = parseAndValidateAttachmentsBody({
            task_id: task.id,
            comment_id: input.comment_id,
            files: filesForValidation,
          });
        } catch (error) {
          return { success: false, error: errorMessage(error) };
        }

        let descriptionId: string | null = null;
        let commentId: number | null = null;

        if (parsed.comment_id !== undefined) {
          const comment = await prisma.comment.findFirst({
            where: { id: parsed.comment_id, taskId: task.id },
            select: { id: true },
          });
          if (!comment) {
            return {
              success: false,
              error: "Comment not found or does not belong to this task",
            };
          }
          commentId = comment.id;
        } else {
          const description = await prisma.description.findUnique({
            where: { taskId: task.id },
            select: { id: true },
          });
          if (!description) {
            return { success: false, error: "Task description not found" };
          }
          descriptionId = description.id;
        }

        const taskForUrl = await prisma.task.findUnique({
          where: { id: task.id },
          select: { uniqueIndex: true },
        });

        const attachmentsOut: Array<{
          id: number;
          fileName: string;
          fileType: string;
          fileSize: number;
          url: string;
        }> = [];
        const failures: Array<{
          filename: string;
          source_url: string;
          error: string;
        }> = [];

        for (const [index, spec] of parsed.files.entries()) {
          const failureContext = {
            filename: spec.filename,
            source_url: input.attachments[index]?.url ?? "",
          };
          if (spec.kind !== "url") {
            failures.push({
              ...failureContext,
              error: "Chat attachment uploads only support URL-sourced files",
            });
            continue;
          }

          const fetched = fetchedByIndex[index];
          if (!fetched) {
            failures.push({
              ...failureContext,
              error: "Attachment fetch result missing",
            });
            continue;
          }

          if (
            normalizeMime(spec.contentType) !==
            normalizeMime(fetched.contentType)
          ) {
            failures.push({
              ...failureContext,
              error: `Declared content_type ${spec.contentType} does not match URL response ${fetched.contentType}`,
            });
            continue;
          }
          if (!bufferMatchesDeclaredMime(fetched.buffer, fetched.contentType)) {
            failures.push({
              ...failureContext,
              error: "Downloaded content does not match declared content type",
            });
            continue;
          }

          try {
            const url = await uploadTaskAttachmentToS3(
              fetched.buffer,
              spec.filename,
              fetched.contentType
            );

            const created = await prisma.attachment.create({
              data: {
                fileType: fetched.contentType,
                fileSource: url,
                fileName: spec.filename,
                fileSize: String(fetched.buffer.length),
                taskId: task.id,
                ...(commentId !== null ? { commentId } : {}),
                ...(descriptionId !== null ? { descriptionId } : {}),
              },
              select: {
                id: true,
                fileName: true,
                fileType: true,
                fileSize: true,
                fileSource: true,
              },
            });

            attachmentsOut.push({
              id: created.id,
              fileName: created.fileName,
              fileType: created.fileType,
              fileSize: fetched.buffer.length,
              url: created.fileSource,
            });
          } catch (error) {
            console.error("[AI chat attachments]", error);
            failures.push({
              ...failureContext,
              error: "Failed to store attachment",
            });
          }
        }

        return sanitizeForJson({
          success: attachmentsOut.length > 0,
          partial: attachmentsOut.length > 0 && failures.length > 0,
          attached_count: attachmentsOut.length,
          failed_count: failures.length,
          attachments: attachmentsOut,
          failures,
          url: taskForUrl
            ? buildMcpTaskUrl(task.projectId, taskForUrl.uniqueIndex)
            : undefined,
        });
      }),
    }),

    hypertask_update_comment: tool({
      description:
        `Update one of your comments. Supports plain-text @mentions; mentioned users must belong to the task project. ${COMMENT_TASK_LINK_RULE}`,
      inputSchema: z.object({
        comment_id: z.coerce.number().int().positive(),
        text: z.string().min(1).max(5000),
        mentions: z
          .array(
            z.object({
              user_id: z.coerce.number().int().positive(),
              display_name: z.string(),
            })
          )
          .optional(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_update_comment");
        const comment = await prisma.comment.findUnique({
          where: { id: input.comment_id },
          include: {
            task: {
              select: {
                id: true,
                projectId: true,
                project: {
                  select: {
                    ownerId: true,
                    members: { select: { userId: true } },
                  },
                },
              },
            },
          },
        });

        if (!comment) {
          return { success: false, error: "Comment not found" };
        }
        if (!comment.task) {
          return { success: false, error: "Comment is not attached to a task" };
        }
        if (!userHasProjectAccess(comment.task.project, user.id)) {
          return {
            success: false,
            error: "Permission denied",
            message: "You do not have access to this task",
          };
        }
        if (comment.creatorId !== user.id) {
          return {
            success: false,
            error: "Permission denied",
            message: "You can only edit your own comments",
          };
        }

        const mentionError = await validateMentionUsers(
          comment.task.projectId,
          input.mentions
        );
        if (mentionError) {
          return { success: false, error: mentionError };
        }

        // Mentions first, then convert — see hypertask_add_comment for why.
        let sanitizedText = input.text.trim();
        if (input.mentions?.length) {
          sanitizedText = convertPlainTextMentionsToHtml(
            sanitizedText,
            input.mentions
          );
        }
        sanitizedText = toStoredHtml(sanitizedText);
        sanitizedText = await linkifyTicketRefs(
          sanitizedText,
          user.id,
          actingAgentId
        );

        await updateCommentService({
          commentId: input.comment_id,
          text: sanitizedText,
          userId: user.id,
        });

        await persistUrlsForComment(
          sanitizedText,
          comment.task.id,
          input.comment_id,
          "PUT"
        );

        const updatedComment = await prisma.comment.findUnique({
          where: { id: input.comment_id },
          include: commentInclude(user.id),
        });

        void broadcastTaskComment(comment.task.id, { originUserId: user.id });

        return sanitizeForJson({
          success: true,
          comment: updatedComment
            ? mapCommentToResponse(updatedComment, user.id)
            : { id: input.comment_id, text: sanitizedText },
        });
      }),
    }),

    hypertask_delete_comment: tool({
      description:
        "Delete one of your comments. HyperAI-authored comments may also be deleted when accessible.",
      inputSchema: z.object({
        comment_id: z.coerce.number().int().positive(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_delete_comment");
        const comment = await prisma.comment.findUnique({
          where: { id: input.comment_id },
          include: {
            task: {
              select: {
                id: true,
                project: {
                  select: {
                    ownerId: true,
                    members: { select: { userId: true } },
                  },
                },
              },
            },
          },
        });

        if (!comment) {
          return { success: false, error: "Comment not found" };
        }
        if (!comment.task) {
          return { success: false, error: "Comment is not attached to a task" };
        }
        if (!userHasProjectAccess(comment.task.project, user.id)) {
          return {
            success: false,
            error: "Permission denied",
            message: "You do not have access to this task",
          };
        }

        const hyperAiId = parseInt(
          process.env.NEXT_PUBLIC_HYPERAI_ID || "332",
          10
        );
        const canDelete =
          comment.creatorId === user.id || comment.creatorId === hyperAiId;
        if (!canDelete) {
          return {
            success: false,
            error: "Permission denied",
            message: "You can only delete your own comments",
          };
        }

        await deleteCommentService({ commentId: input.comment_id });

        void broadcastTaskComment(comment.task.id, { originUserId: user.id });

        return sanitizeForJson({
          success: true,
          message: "Comment deleted",
        });
      }),
    }),

    hypertask_assign_user: tool({
      description:
        "Assign one or more people or board agents to one or many tasks, up to 50 task/assignee pairs per call. For multiple tasks, pass task_ids or ticket_numbers in one call instead of looping. Pass users with user ids, \"me\", people's display names or emails, or agents' display names or UUIDs; user_ids remains supported for people. Additive and idempotent.",
      inputSchema: z
        .object({
        task_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(TOOL_TASK_ID_DESCRIPTION),
        task_ids: z
          .array(z.coerce.number().int().positive())
          .max(MAX_BULK_TOOL_TARGETS)
          .optional(),
        ticket_number: z.string().optional(),
        ticket_numbers: z
          .array(z.string())
          .max(MAX_BULK_TOOL_TARGETS)
          .optional(),
        unique_index: z.coerce.number().int().positive().optional(),
        project_id: z.coerce.number().int().positive().optional(),
        user_ids: z
          .array(z.coerce.number().int().positive())
          .max(MAX_BULK_TOOL_TARGETS)
          .optional(),
        users: z
          .array(z.union([z.number().int().positive(), z.string().min(1)]))
          .max(MAX_BULK_TOOL_TARGETS)
          .optional(),
        confirmed: z
          .boolean()
          .optional()
          .describe(
            "Set true ONLY after the user has explicitly approved assigning users to 4 or more tasks in their own message. Never set it to confirm your own proposal."
          ),
        })
        .refine(
          (input) => bulkTaskTargetCount(input) <= MAX_BULK_TOOL_TARGETS,
          {
            message: `Pass no more than ${MAX_BULK_TOOL_TARGETS} combined task_ids and ticket_numbers`,
            path: ["task_ids"],
          }
        )
        .refine(
          (input) => bulkUserTargetCount(input) <= MAX_BULK_TOOL_TARGETS,
          {
            message: `Pass no more than ${MAX_BULK_TOOL_TARGETS} combined user_ids and users`,
            path: ["user_ids"],
          }
        )
        .refine(
          (input) =>
            Math.max(1, bulkTaskTargetCount(input)) *
              bulkUserTargetCount(input) <=
            MAX_BULK_TOOL_TARGETS,
          {
            message: `Pass no more than ${MAX_BULK_TOOL_TARGETS} task/user pairs per call`,
            path: ["users"],
          }
        ),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_assign_user");
        return mutateTaskAssignees(input, "assign");
      }),
    }),

    hypertask_unassign_user: tool({
      description:
        "Unassign one or more people or board agents from one or many tasks, up to 50 task/assignee pairs per call. For multiple tasks, pass task_ids or ticket_numbers in one call instead of looping. Pass users with user ids, \"me\", people's display names or emails, or agents' display names or UUIDs; user_ids remains supported for people. Idempotent.",
      inputSchema: z
        .object({
        task_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(TOOL_TASK_ID_DESCRIPTION),
        task_ids: z
          .array(z.coerce.number().int().positive())
          .max(MAX_BULK_TOOL_TARGETS)
          .optional(),
        ticket_number: z.string().optional(),
        ticket_numbers: z
          .array(z.string())
          .max(MAX_BULK_TOOL_TARGETS)
          .optional(),
        unique_index: z.coerce.number().int().positive().optional(),
        project_id: z.coerce.number().int().positive().optional(),
        user_ids: z
          .array(z.coerce.number().int().positive())
          .max(MAX_BULK_TOOL_TARGETS)
          .optional(),
        users: z
          .array(z.union([z.number().int().positive(), z.string().min(1)]))
          .max(MAX_BULK_TOOL_TARGETS)
          .optional(),
        confirmed: z
          .boolean()
          .optional()
          .describe(
            "Set true ONLY after the user has explicitly approved unassigning users from 4 or more tasks in their own message. Never set it to confirm your own proposal."
          ),
        })
        .refine(
          (input) => bulkTaskTargetCount(input) <= MAX_BULK_TOOL_TARGETS,
          {
            message: `Pass no more than ${MAX_BULK_TOOL_TARGETS} combined task_ids and ticket_numbers`,
            path: ["task_ids"],
          }
        )
        .refine(
          (input) => bulkUserTargetCount(input) <= MAX_BULK_TOOL_TARGETS,
          {
            message: `Pass no more than ${MAX_BULK_TOOL_TARGETS} combined user_ids and users`,
            path: ["user_ids"],
          }
        )
        .refine(
          (input) =>
            Math.max(1, bulkTaskTargetCount(input)) *
              bulkUserTargetCount(input) <=
            MAX_BULK_TOOL_TARGETS,
          {
            message: `Pass no more than ${MAX_BULK_TOOL_TARGETS} task/user pairs per call`,
            path: ["users"],
          }
        ),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_unassign_user");
        return mutateTaskAssignees(input, "unassign");
      }),
    }),

    hypertask_move_task_between_boards: tool({
      description:
        "Move a task and its subtasks to a different project/board. Use hypertask_update_task for moving within the same board. Provide whichever task identifier you know; extra identifiers are tolerated.",
      inputSchema: z.object({
        task_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(TOOL_TASK_ID_DESCRIPTION),
        ticket_number: z.string().optional(),
        unique_index: z.coerce.number().int().positive().optional(),
        project_id: z.coerce.number().int().positive().optional(),
        target_project_id: z.coerce.number().int().positive(),
        target_section_id: z.coerce.number().int().positive().optional(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_move_task_between_boards");
        const taskResult = await resolveTaskForTool(user, {
          task_id: input.task_id,
          ticket_number: input.ticket_number,
          unique_index: input.unique_index,
          project_id: input.project_id,
        });
        if (taskResult.error) {
          return { success: false, error: taskResult.error };
        }

        const task = taskResult.task;
        if (!task) {
          return { success: false, error: "Task not found or access denied" };
        }

        const targetAccess = await validateProjectAccess(
          input.target_project_id,
          user.id
        );
        if (targetAccess.error) {
          return { success: false, error: targetAccess.error.message };
        }

        const sectionResult = await getSectionForTask(
          input.target_project_id,
          input.target_section_id
        );
        if (sectionResult.error) {
          return { success: false, error: sectionResult.error.message };
        }

        const userObj = await prisma.user.findUnique({
          where: { id: user.id },
          select: { id: true, email: true, displayName: true, photoURL: true },
        });
        if (!userObj) return { success: false, error: "User not found" };
        const currentUser = buildActivityUser(userObj);

        const result = await moveTaskToDifferentBoard({
          taskId: task.id,
          targetProjectId: input.target_project_id,
          targetSectionId: sectionResult.section.id,
          currentProjectId: task.projectId,
          currentUser,
          agentId: actingAgentId,
        });

        if (!result.success) {
          return { success: false, error: result.error || "Failed to move task" };
        }

        void broadcastBoardChange(task.projectId, { originUserId: user.id });
        void broadcastBoardChange(input.target_project_id, { originUserId: user.id });

        const finalTask = await prisma.task.findUnique({
          where: { id: task.id },
          include: taskDetailInclude(user.id),
        });
        if (!finalTask && !result.task) {
          return { success: false, error: "Task moved but could not be retrieved" };
        }

        const mappedTask = finalTask
          ? mapTaskToDetail(finalTask, user.id)
          : mapTaskToDetail(result.task, user.id);

        return sanitizeForJson({
          success: true,
          task: mappedTask,
          url:
            mappedTask && "projectId" in mappedTask && "uniqueIndex" in mappedTask
              ? buildMcpTaskUrl(
                  Number(mappedTask.projectId),
                  Number(mappedTask.uniqueIndex)
                )
              : undefined,
          message: "Task moved successfully",
        });
      }),
    }),

    hypertask_inbox_archive: tool({
      description:
        "Archive one or more of the authenticated user's inbox notifications.",
      inputSchema: z.object({
        notification_ids: z.array(z.coerce.number().int().positive()).min(1),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_inbox_archive");
        // The inbox shows one row per task, so archiving a row has to take its
        // siblings with it or the task reappears and the archive looks broken.
        // The UI route deletes those siblings; archiving them instead keeps the
        // task out of the inbox without destroying notifications nobody asked
        // to lose.
        const notifications = await prisma.notification.findMany({
          where: { id: { in: input.notification_ids }, userId: user.id },
          select: { taskId: true },
        });
        const taskIds = notifications
          .map((notification) => notification.taskId)
          .filter((taskId): taskId is number => taskId !== null);

        const archivedAt = new Date();
        if (taskIds.length) {
          await prisma.notification.updateMany({
            where: {
              id: { notIn: input.notification_ids },
              taskId: { in: taskIds },
              userId: user.id,
              // An owned agent's notifications carry the owner's userId, so
              // without this the user's archive would empty their agent's inbox.
              agentId: null,
              status: "Normal",
            },
            data: { status: "Archive", archivedAt },
          });
        }

        const result = await prisma.notification.updateMany({
          where: { id: { in: input.notification_ids }, userId: user.id },
          data: { status: "Archive", archivedAt },
        });

        void broadcastInboxChange(user.id, { originUserId: user.id });

        return sanitizeForJson({ success: true, archived_count: result.count });
      }),
    }),

    hypertask_inbox_unarchive: tool({
      description:
        "Unarchive one or more of the authenticated user's archived inbox notifications. Discover archived notification ids with hypertask_inbox_list using archived=true.",
      inputSchema: z.object({
        notification_ids: z.array(z.coerce.number().int().positive()).min(1),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_inbox_unarchive");
        const result = await prisma.notification.updateMany({
          where: {
            id: { in: input.notification_ids },
            userId: user.id,
            status: "Archive",
          },
          data: {
            status: "Normal",
            archivedAt: null,
          },
        });

        void broadcastInboxChange(user.id, { originUserId: user.id });

        return sanitizeForJson({
          success: true,
          unarchived_count: result.count,
        });
      }),
    }),

    hypertask_draft: tool({
      description:
        `Create, list, update, publish, or delete task drafts. Draft types are description or comment. Provide whichever task identifier you know; extra identifiers are tolerated. For comment drafts: ${COMMENT_TASK_LINK_RULE}`,
      inputSchema: z.object({
        action: z.enum(["create", "list", "update", "publish", "delete"]),
        task_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(TOOL_TASK_ID_DESCRIPTION),
        ticket_number: z.string().optional(),
        unique_index: z.coerce.number().int().positive().optional(),
        project_id: z.coerce.number().int().positive().optional(),
        draft_id: z.coerce.number().int().positive().optional(),
        draft_type: z.enum(["description", "comment"]).optional(),
        text: z.string().max(20000).optional(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_draft");

        if (input.action === "create" || input.action === "list") {
          const taskResult = await resolveTaskForTool(user, {
            task_id: input.task_id,
            ticket_number: input.ticket_number,
            unique_index: input.unique_index,
            project_id: input.project_id,
          });
          if (taskResult.error) {
            return { success: false, error: taskResult.error };
          }

          const task = taskResult.task;
          if (!task) {
            return { success: false, error: "Task not found or access denied" };
          }

          if (input.action === "list") {
            const drafts = await prisma.drafts.findMany({
              where: { taskId: task.id, content: { not: "<p></p>" } },
              include: {
                task: { select: { ticketNumber: true } },
                user: { select: { id: true, email: true, displayName: true } },
              },
              orderBy: { updatedAt: "desc" },
            });

            return sanitizeForJson({
              success: true,
              drafts: drafts.map(mapDraftToResponse),
            });
          }

          if (!input.draft_type) {
            return { success: false, error: "draft_type is required to create a draft" };
          }
          let text = input.text?.trim() ? toStoredHtml(input.text) : undefined;
          if (!text) {
            return { success: false, error: "text is required to create a draft" };
          }

          const draftTypeEnum =
            input.draft_type === "comment" ? "Comment" : "Description";
          if (draftTypeEnum === "Comment") {
            text = await linkifyTicketRefs(text, user.id, actingAgentId);
            const mentionUserIds = extractTipTapContent(text).mentions
              .map((id) => parseInt(id, 10))
              .filter(Number.isInteger);
            const mentionError = await validateMentionUserIds(
              task.projectId,
              mentionUserIds
            );
            if (mentionError) {
              return { success: false, error: mentionError };
            }
          }
          const existing = await prisma.drafts.findFirst({
            where: {
              taskId: task.id,
              type: draftTypeEnum,
              userId: user.id,
            },
          });

          const draft = existing
            ? await prisma.drafts.update({
                where: { id: existing.id },
                data: { content: text },
                include: {
                  task: { select: { ticketNumber: true } },
                  user: { select: { id: true, email: true, displayName: true } },
                },
              })
            : await prisma.drafts.create({
                data: {
                  taskId: task.id,
                  projectId: task.projectId,
                  type: draftTypeEnum,
                  content: text,
                  userId: user.id,
                  saved: true,
                },
                include: {
                  task: { select: { ticketNumber: true } },
                  user: { select: { id: true, email: true, displayName: true } },
                },
              });

          return sanitizeForJson({
            success: true,
            draft: mapDraftToResponse(draft),
            message: "Draft created successfully",
          });
        }

        if (!input.draft_id) {
          return { success: false, error: "draft_id is required for this draft action" };
        }

        const draft = await findDraftWithAccess(input.draft_id);
        if (!draft) {
          return { success: false, error: "Draft not found" };
        }
        if (!draft.task) {
          return { success: false, error: "Draft task not found" };
        }
        if (!userHasProjectAccess(draft.task.project, user.id)) {
          return {
            success: false,
            error: "Permission denied",
            message: "You do not have access to this task",
          };
        }
        if (draft.userId !== user.id) {
          const verb =
            input.action === "publish"
              ? "publish"
              : input.action === "delete"
                ? "delete"
                : "update";
          return {
            success: false,
            error: "Permission denied",
            message: `You can only ${verb} your own drafts`,
          };
        }

        if (input.action === "update") {
          let text = input.text?.trim() ? toStoredHtml(input.text) : undefined;
          if (!text) {
            return { success: false, error: "text is required to update a draft" };
          }
          if (draft.type === "Comment") {
            text = await linkifyTicketRefs(text, user.id, actingAgentId);
            const mentionUserIds = extractTipTapContent(text).mentions
              .map((id) => parseInt(id, 10))
              .filter(Number.isInteger);
            const mentionError = await validateMentionUserIds(
              draft.task.projectId,
              mentionUserIds
            );
            if (mentionError) {
              return { success: false, error: mentionError };
            }
          }
          const updatedDraft = await prisma.drafts.update({
            where: { id: input.draft_id },
            data: {
              content: text,
              updatedAt: new Date(),
            },
            include: {
              task: { select: { ticketNumber: true } },
              user: { select: { id: true, email: true, displayName: true } },
            },
          });

          return sanitizeForJson({
            success: true,
            draft: mapDraftToResponse(updatedDraft),
            message: "Draft updated successfully",
          });
        }

        if (input.action === "delete") {
          await prisma.drafts.delete({ where: { id: input.draft_id } });
          return sanitizeForJson({
            success: true,
            message: "Draft deleted successfully",
          });
        }

        const taskId = draft.taskId;
        const taskTicketNumber = draft.task.ticketNumber || `Task #${taskId}`;

        if (draft.type === "Comment") {
          const commentText = await linkifyTicketRefs(
            draft.content || "",
            user.id,
            actingAgentId
          );
          const mentionUserIds = extractTipTapContent(commentText).mentions
            .map((id) => parseInt(id, 10))
            .filter(Number.isInteger);
          const mentionError = await validateMentionUserIds(
            draft.task.projectId,
            mentionUserIds
          );
          if (mentionError) {
            return { success: false, error: mentionError };
          }

          const taskWithOwner = await prisma.task.findUnique({
            where: { id: taskId },
            select: { userId: true },
          });
          if (!taskWithOwner) {
            return { success: false, error: "Task not found" };
          }

          const userObj = await prisma.user.findUnique({
            where: { id: user.id },
            select: { id: true, email: true, displayName: true, photoURL: true },
          });
          if (!userObj) {
            return { success: false, error: "User not found" };
          }

          const comment = await createCommentService({
            text: commentText,
            creatorId: user.id,
            taskId,
            ownerId: taskWithOwner.userId,
            currentUser: userObj,
            agentId: actingAgentId,
          });

          await persistUrlsForComment(commentText, taskId, comment.id, "POST");
          void broadcastTaskComment(taskId, { originUserId: user.id });

          return sanitizeForJson({
            success: true,
            message: `Draft published — comment added to ${taskTicketNumber}`,
          });
        }

        if (draft.type === "Description") {
          const userObj = await prisma.user.findUnique({
            where: { id: user.id },
            select: { id: true, email: true, displayName: true, photoURL: true },
          });
          if (!userObj) {
            return { success: false, error: "User not found" };
          }

          const result = await updateTaskSingle(
            { id: taskId, description: draft.content },
            buildActivityUser(userObj),
            actingAgentId
          );
          if (result.status !== 200) {
            return {
              success: false,
              error:
                (result.json as { message?: string })?.message ||
                "Failed to publish draft",
            };
          }

          await persistUrlsForDescription(draft.content, taskId);
          void broadcastBoardChange(draft.projectId, { originUserId: user.id });

          return sanitizeForJson({
            success: true,
            message: `Draft published — description updated for ${taskTicketNumber}`,
          });
        }

        return { success: false, error: "Unknown draft type" };
      }),
    }),

    hypertask_get_task_tree: tool({
      description:
        "Return the parent/subtask tree for a task, starting from its topmost ancestor.",
      inputSchema: z.object({
        task_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(TOOL_TASK_ID_DESCRIPTION),
        ticket_number: z.string().min(1).optional(),
        depth: z.coerce.number().int().min(0).optional(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_get_task_tree");
        const taskResult = await resolveTaskForTool(user, {
          task_id: input.task_id,
          ticket_number: input.ticket_number,
        });
        if (taskResult.error) {
          return { success: false, error: taskResult.error };
        }

        const anchor = taskResult.task;
        if (!anchor) {
          return { success: false, error: "Task not found or access denied" };
        }

        const rootResult = await findRootTaskIdForTree(anchor.id, user.id);
        if ("error" in rootResult) {
          return { success: false, error: rootResult.error };
        }

        const tree = await buildTaskTreeNode(
          rootResult.rootId,
          user.id,
          input.depth
        );

        return sanitizeForJson({
          success: true,
          tree,
        });
      }),
    }),

    hypertask_list_views: tool({
      description:
        "List accessible board views, list views for one project, or get one view by id. Returns each view's id, slug, title, and shareable url.",
      inputSchema: z.object({
        view_id: z.string().optional(),
        project_id: z.coerce.number().int().positive().optional(),
        visibility: z.enum(["Public", "Private"]).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        sort_by: z.enum(["title", "createdAt", "lastUsedAt"]).default("lastUsedAt"),
        sort_order: sortOrderSchema.default("desc"),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_list_views");

        const viewSelect = {
          id: true,
          title: true,
          slug: true,
          visibility: true,
          board_sorting_stack: true,
          createdAt: true,
          lastUsedAt: true,
          owner: { select: { id: true, email: true, displayName: true } },
          ViewLastUsed: {
            where: { userId: user.id },
            select: { lastUsedAt: true },
            take: 1,
          },
        } as const;

        if (input.view_id) {
          const view = await prisma.view.findFirst({
            where: { id: input.view_id },
            select: {
              ...viewSelect,
              slug: true,
              board_sorting_mode: true,
              board_sorting_order: true,
              board_filters: true,
              board_columns_view: true,
              board_subtask_setting: true,
              board_empty_sections: true,
              project_view_id: true,
              project_view: {
                select: {
                  default_view_id: true,
                  project: { select: { id: true, name: true, title: true } },
                },
              },
            },
          });

          if (!view) {
            return { success: false, error: "View does not exist" };
          }

          const hasAccess = await assertAccessibleProject(
            user.id,
            view.project_view.project.id
          );
          if (!hasAccess) {
            return {
              success: false,
              error: "User does not have access to project this view belongs to",
            };
          }

          if (view.owner.id !== user.id && view.visibility === "Private") {
            return {
              success: false,
              error: "Cannot access another user's private view",
            };
          }

          return sanitizeForJson({
            success: true,
            view: mapViewToResponse(view, view.project_view, true),
          });
        }

        const orderBy: Prisma.ViewOrderByWithRelationInput =
          input.sort_by === "title"
            ? { title: input.sort_order }
            : input.sort_by === "createdAt"
              ? { createdAt: input.sort_order }
              : { lastUsedAt: input.sort_order };

        if (input.project_id) {
          const access = await validateProjectAccess(input.project_id, user.id);
          if (access.error) {
            return { success: false, error: access.error.message };
          }

          const viewWhere: Prisma.ViewWhereInput = {
            project_view: { projectId: input.project_id },
            OR: [
              { visibility: "Public" },
              { visibility: "Private", userId: user.id },
            ],
            ...(input.visibility ? { visibility: input.visibility } : {}),
          };

          const [total, views] = await Promise.all([
            prisma.view.count({ where: viewWhere }),
            prisma.view.findMany({
              where: viewWhere,
              select: {
                ...viewSelect,
                project_view: {
                  select: {
                    default_view_id: true,
                    project: { select: { id: true, name: true, title: true } },
                  },
                },
              },
              orderBy,
              take: input.limit,
              skip: input.offset,
            }),
          ]);

          return sanitizeForJson({
            success: true,
            views: views.map((view) => mapViewToResponse(view, view.project_view)),
            total,
            limit: input.limit,
            offset: input.offset,
          });
        }

        const userProjects = await prisma.project.findMany({
          where: { status: "Normal", ...getProjectWhere(user.id) },
          select: { id: true },
        });
        const projectIds = userProjects.map((project) => project.id);

        if (projectIds.length === 0) {
          return sanitizeForJson({
            success: true,
            views: [],
            total: 0,
            limit: input.limit,
            offset: input.offset,
          });
        }

        const allProjectViews = await prisma.project_View.findMany({
          where: { projectId: { in: projectIds } },
          select: {
            default_view_id: true,
            default_view: { select: viewSelect },
            user_project_views: {
              where: { userId: user.id },
              select: { appliedView: { select: viewSelect } },
              take: 1,
            },
            project: { select: { id: true, name: true, title: true } },
          },
        });

        const allResolved = allProjectViews.flatMap((projectView) => {
          const appliedView =
            projectView.user_project_views[0]?.appliedView ?? null;
          const defaultView = projectView.default_view;
          let view = appliedView ?? defaultView;

          if (input.visibility && view?.visibility !== input.visibility) {
            view =
              defaultView?.visibility === input.visibility ? defaultView : null;
          }

          if (!view) return [];
          return [
            mapViewToResponse(view, {
              default_view_id: projectView.default_view_id,
              project: projectView.project,
            }),
          ];
        });

        const views = allResolved.slice(input.offset, input.offset + input.limit);

        return sanitizeForJson({
          success: true,
          views,
          total: allResolved.length,
          limit: input.limit,
          offset: input.offset,
        });
      }),
    }),

    hypertask_get_view: tool({
      description:
        "Get one saved board view and its filters, sorting, and visibility. Returns the view's id, slug, title, and shareable url.",
      inputSchema: z.object({
        viewId: z.string().min(1),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_get_view");
        const view = await prisma.view.findFirst({
          where: { id: input.viewId },
          select: {
            id: true,
            title: true,
            slug: true,
            visibility: true,
            createdAt: true,
            lastUsedAt: true,
            board_sorting_mode: true,
            board_sorting_order: true,
            board_sorting_stack: true,
            board_filters: true,
            board_columns_view: true,
            board_subtask_setting: true,
            board_empty_sections: true,
            project_view_id: true,
            owner: {
              select: { id: true, email: true, displayName: true },
            },
            ViewLastUsed: {
              where: { userId: user.id },
              select: { lastUsedAt: true },
              take: 1,
            },
            project_view: {
              select: {
                default_view_id: true,
                project: {
                  select: { id: true, name: true, title: true },
                },
              },
            },
          },
        });
        if (!view) {
          return { success: false, error: "View does not exist" };
        }

        const hasAccess = await assertAccessibleProject(
          user.id,
          view.project_view.project.id
        );
        if (!hasAccess) {
          return {
            success: false,
            error: "User does not have access to project this view belongs to",
          };
        }
        if (view.owner.id !== user.id && view.visibility === "Private") {
          return {
            success: false,
            error: "Cannot access another user's private view",
          };
        }

        return sanitizeForJson({
          success: true,
          view: {
            id: view.id,
            title: view.title || "",
            slug: view.slug,
            url: view.slug
              ? getViewUrl(view.project_view.project.id, view.slug)
              : null,
            visibility: view.visibility,
            createdAt: view.createdAt,
            lastUsedAt: view.ViewLastUsed[0]?.lastUsedAt ?? view.lastUsedAt,
            owner: {
              id: view.owner.id,
              email: view.owner.email,
              displayName: view.owner.displayName || undefined,
            },
            board_sorting_mode: view.board_sorting_mode,
            board_sorting_order: view.board_sorting_order,
            board_sorting_stack: view.board_sorting_stack,
            board_filters: sanitizeBoardFilters(view.board_filters) || undefined,
            board_columns_view: view.board_columns_view || undefined,
            board_subtask_setting: view.board_subtask_setting,
            board_empty_sections: view.board_empty_sections,
            project: {
              id: view.project_view.project.id,
              name: view.project_view.project.name,
              title: view.project_view.project.title || undefined,
            },
            is_default: view.project_view.default_view_id === view.id,
          },
        });
      }),
    }),

    hypertask_create_view: tool({
      description:
        "Create a saved board view: a named, filtered lens on one board (e.g. 'Overdue and mine', 'Bugs'). Filters can be label names and/or assignee user ids. Public = visible to the whole team, Private = only the caller. Returns the view's id, slug, title, and shareable url.",
      inputSchema: z.object({
        project_id: z.coerce.number().int().positive(),
        title: z.string().min(1).max(200),
        visibility: z.enum(["Public", "Private"]).default("Public"),
        label_names: z
          .array(z.string())
          .optional()
          .describe("Only show tasks carrying these labels."),
        assignee_ids: z
          .array(z.union([z.coerce.number().int().positive(), z.string().uuid()]))
          .optional()
          .describe("Only show tasks assigned to these users (numeric id) or agents (uuid)."),
        match: z
          .enum(["ALL", "ANY"])
          .default("ANY")
          .describe("ALL = a task must satisfy every filter; ANY = at least one."),
        sorting_mode: z
          .enum(SORTING_MODES)
          .optional(),
        sorting_order: z.enum(["Ascending", "Descending"]).optional(),
        sorting_stack: viewSortingStackSchema
          .optional()
          .describe("Up to two tie-break sorting levels after sorting_mode."),
        subtask_setting: z
          .enum(SUBTASK_SETTINGS)
          .optional()
          .describe(
            "Subtask display: None hides subtasks and their count; Parent shows parent tasks with a subtask count; Flattened shows subtasks as rows; Card shows subtasks on parent cards; Flattened_Card does both."
          ),
        set_as_default: z
          .boolean()
          .default(false)
          .describe("Make this the board's default view for everyone. Ask first."),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_create_view");

        const access = await validateProjectAccess(input.project_id, user.id);
        if (access.error) {
          return { success: false, error: access.error.message };
        }

        const view = await createView({
          projectId: input.project_id,
          userId: user.id,
          title: input.title,
          visibility: input.visibility,
          filters: {
            label_names: input.label_names,
            assignee_ids: input.assignee_ids,
            match: input.match,
          },
          sorting_mode: input.sorting_mode,
          sorting_order: input.sorting_order,
          sorting_stack: input.sorting_stack,
          subtask_setting: input.subtask_setting,
          setAsDefault: input.set_as_default,
        });

        return sanitizeForJson({ success: true, view });
      }),
    }),

    hypertask_update_view: tool({
      description:
        "Edit an existing saved board view: rename it, change its filters (label names / assignee ids), visibility, or sorting. Find the id with hypertask_list_views first. Only provide the fields you want to change. Cannot edit someone else's private view. Returns the view's id, slug, title, and shareable url.",
      inputSchema: z.object({
        view_id: z.string().min(1),
        title: z.string().min(1).max(200).optional(),
        visibility: z.enum(["Public", "Private"]).optional(),
        label_names: z
          .array(z.string())
          .optional()
          .describe(
            "Replace the view's label filter with these labels. Pass [] to clear it."
          ),
        assignee_ids: z
          .array(z.union([z.coerce.number().int().positive(), z.string().uuid()]))
          .optional()
          .describe(
            "Replace the view's assignee filter with these user ids (numeric) or agent ids (uuid). Pass [] to clear it."
          ),
        match: z
          .enum(["ALL", "ANY"])
          .optional()
          .describe("ALL = a task must satisfy every filter; ANY = at least one."),
        sorting_mode: z
          .enum(SORTING_MODES)
          .optional(),
        sorting_order: z.enum(["Ascending", "Descending"]).optional(),
        sorting_stack: viewSortingStackSchema
          .optional()
          .describe(
            "Replace the view's tie-break sorting levels. Pass [] to clear them."
          ),
        subtask_setting: z
          .enum(SUBTASK_SETTINGS)
          .optional()
          .describe(
            "Subtask display: None hides subtasks and their count; Parent shows parent tasks with a subtask count; Flattened shows subtasks as rows; Card shows subtasks on parent cards; Flattened_Card does both."
          ),
        set_as_default: z
          .boolean()
          .optional()
          .describe("Make this the board's default view for everyone. Ask first."),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_update_view");
        const filtersProvided =
          input.label_names !== undefined ||
          input.assignee_ids !== undefined ||
          input.match !== undefined;
        const updated = await updateView({
          viewId: input.view_id,
          userId: user.id,
          title: input.title,
          visibility: input.visibility,
          filters: filtersProvided
            ? {
                label_names: input.label_names,
                assignee_ids: input.assignee_ids,
                match: input.match,
              }
            : undefined,
          sorting_mode: input.sorting_mode,
          sorting_order: input.sorting_order,
          sorting_stack: input.sorting_stack,
          subtask_setting: input.subtask_setting,
          setAsDefault: input.set_as_default,
        });
        return sanitizeForJson({ success: true, view: updated });
      }),
    }),

    hypertask_switch_view: tool({
      description:
        "Switch the user's active view on a board to the given view id (what the highlighted tab shows). Find the id with hypertask_list_views. Passing the board's default view id returns them to the default (all tasks) view.",
      inputSchema: z.object({
        view_id: z.string().min(1),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_switch_view");
        const result = await applyView({ viewId: input.view_id, userId: user.id });
        return sanitizeForJson({ success: true, ...result });
      }),
    }),

    hypertask_delete_view: tool({
      description:
        "Delete a saved board view by id. Find the id with hypertask_list_views first. Cannot delete a board's default view or someone else's private view.",
      inputSchema: z.object({
        view_id: z.string().min(1),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_delete_view");
        const deleted = await deleteView(input.view_id, user.id);
        return sanitizeForJson({ success: true, view: deleted });
      }),
    }),

    hypertask_create_skill: tool({
      description:
        "Create a personal or project skill from complete SKILL.md content or structured fields.",
      inputSchema: z.object({
        scope: z.enum(["user", "project"]).default("user"),
        project_id: z.coerce.number().int().positive().optional(),
        markdown: z.string().optional(),
        raw_markdown: z.string().optional(),
        slug: z.string().optional(),
        name: z.string().optional(),
        description: z.string().nullable().optional(),
        argument_hint: z.string().nullable().optional(),
        body: z.string().optional(),
        enabled: z.boolean().default(true),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_create_skill");
        const scope = await assertSkillScopeAccess(
          user.id,
          input.scope,
          input.project_id
        );
        const markdown = input.markdown ?? input.raw_markdown;
        let parsed;
        if (markdown) {
          parsed = parseSkillMarkdown(markdown);
        } else {
          const name = input.name?.trim() || "";
          const slug = slugifySkill(input.slug || name);
          const skillBody = input.body?.trim() || "";
          if (!name) {
            return { success: false, error: "Skill name is required" };
          }
          if (!slug) {
            return { success: false, error: "Skill slug is required" };
          }
          if (!skillBody) {
            return { success: false, error: "Skill body is required" };
          }
          if (Buffer.byteLength(skillBody, "utf8") > MAX_SKILL_BODY_BYTES) {
            return {
              success: false,
              error: "Skill body exceeds the 64KB limit",
            };
          }
          parsed = {
            name,
            slug,
            body: skillBody,
            description: input.description?.trim() || null,
            argumentHint: input.argument_hint?.trim() || null,
          };
        }

        try {
          const skill = await prisma.aI_Skill.create({
            data: {
              ...scope,
              ...parsed,
              enabled: input.enabled,
              createdById: user.id,
            },
          });
          return sanitizeForJson({ success: true, skill });
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
          ) {
            return {
              success: false,
              error: "A skill with this slug already exists in this scope",
            };
          }
          throw error;
        }
      }),
    }),

    hypertask_get_skill: tool({
      description:
        "Get one accessible personal or project skill by its positive integer ID.",
      inputSchema: z.object({
        skill_id: z.coerce.number().int().positive(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_get_skill");
        const skill = await getAccessibleSkill(user.id, input.skill_id);
        return sanitizeForJson({ success: true, skill });
      }),
    }),

    hypertask_list_skills: tool({
      description:
        "List personal skills, plus project skills when project_id is provided.",
      inputSchema: z.object({
        project_id: z.coerce.number().int().positive().optional(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_list_skills");
        if (input.project_id) {
          await assertProjectAccess(user.id, input.project_id);
        }
        const skills = await prisma.aI_Skill.findMany({
          where: {
            OR: [
              { userId: user.id, projectId: null },
              ...(input.project_id
                ? [{ projectId: input.project_id, userId: null }]
                : []),
            ],
          },
          orderBy: [{ name: "asc" }, { id: "asc" }],
        });
        return sanitizeForJson({
          success: true,
          skills,
          total: skills.length,
        });
      }),
    }),

    hypertask_update_skill: tool({
      description:
        "Update an accessible personal or project skill by ID using structured fields or complete SKILL.md content.",
      inputSchema: z.object({
        skill_id: z.coerce.number().int().positive(),
        markdown: z.string().optional(),
        raw_markdown: z.string().optional(),
        slug: z.string().optional(),
        name: z.string().optional(),
        description: z.string().nullable().optional(),
        argument_hint: z.string().nullable().optional(),
        body: z.string().optional(),
        enabled: z.boolean().optional(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_update_skill");
        const skill = await getAccessibleSkill(user.id, input.skill_id);
        const markdown = input.markdown ?? input.raw_markdown;
        let data: Record<string, string | null>;
        if (markdown) {
          data = parseSkillMarkdown(markdown);
        } else {
          data = {};
          if (input.name !== undefined) {
            const name = input.name.trim();
            if (!name) {
              return { success: false, error: "Skill name is required" };
            }
            data.name = name;
          }
          if (input.slug !== undefined) {
            const slug = slugifySkill(input.slug);
            if (!slug) {
              return { success: false, error: "Skill slug is required" };
            }
            data.slug = slug;
          } else if (!skill.slug) {
            return { success: false, error: "Skill slug is required" };
          }
          if (input.body !== undefined) {
            const skillBody = input.body.trim();
            if (!skillBody) {
              return { success: false, error: "Skill body is required" };
            }
            if (Buffer.byteLength(skillBody, "utf8") > MAX_SKILL_BODY_BYTES) {
              return {
                success: false,
                error: "Skill body exceeds the 64KB limit",
              };
            }
            data.body = skillBody;
          }
          if (input.description !== undefined) {
            data.description = input.description?.trim() || null;
          }
          if (input.argument_hint !== undefined) {
            data.argumentHint = input.argument_hint?.trim() || null;
          }
        }

        try {
          const updated = await prisma.aI_Skill.update({
            where: { id: skill.id },
            data: {
              ...data,
              ...(input.enabled === undefined
                ? {}
                : { enabled: input.enabled }),
            },
          });
          return sanitizeForJson({ success: true, skill: updated });
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
          ) {
            return {
              success: false,
              error: "A skill with this slug already exists in this scope",
            };
          }
          throw error;
        }
      }),
    }),

    hypertask_delete_skill: tool({
      description: "Delete an accessible personal or project skill by ID.",
      inputSchema: z.object({
        skill_id: z.coerce.number().int().positive(),
        confirmed: z
          .boolean()
          .optional()
          .describe(
            "Set true only after the user explicitly confirms deleting this shared project skill."
          ),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_delete_skill");
        const skill = await getAccessibleSkill(user.id, input.skill_id);
        if (skill.projectId !== null) {
          const operationKey = `delete-project-skill:${skill.id}`;
          if (
            await requireCrossMessageConfirmation({
              userId: user.id,
              sessionId: confirmationSessionId,
              operationKey,
              confirmed: input.confirmed,
              previewsIssuedThisRequest: bulkPreviewsIssued,
            }) === "preview"
          ) {
            return sanitizeForJson({
              success: false,
              confirmation_required: true,
              skill: {
                id: skill.id,
                name: skill.name,
                projectId: skill.projectId,
              },
              message:
                "This is a shared project skill. Nothing has been changed yet. Ask the user to confirm deleting it, then call this tool in a new message with confirmed: true.",
            });
          }
        }
        await prisma.aI_Skill.delete({ where: { id: skill.id } });
        return sanitizeForJson({ success: true });
      }),
    }),

    hypertask_import_skills: tool({
      description:
        "Import personal or project skills from a GitHub URL, with optional dry-run and slug selection.",
      inputSchema: z.object({
        url: z.string().url(),
        scope: z.enum(["user", "project"]),
        project_id: z.coerce.number().int().positive().optional(),
        dry_run: z.boolean().default(false),
        slugs: z.array(z.string()).optional(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_import_skills");
        const scope = await assertSkillScopeAccess(
          user.id,
          input.scope,
          input.project_id
        );
        const parsed = await importSkillsFromGitHub(input.url);
        const selected = input.slugs
          ? parsed.filter((skill) => input.slugs?.includes(skill.slug))
          : parsed;
        if (input.dry_run) {
          return sanitizeForJson({ success: true, skills: parsed });
        }
        if (selected.length === 0) {
          return {
            success: false,
            error: "Select at least one skill to import",
          };
        }

        const skills = await prisma.$transaction(
          selected.map((skill) => {
            const data = {
              name: skill.name,
              description: skill.description,
              argumentHint: skill.argumentHint,
              body: skill.body,
              sourceUrl: skill.sourceUrl,
              enabled: true,
              createdById: user.id,
            };
            return input.scope === "project"
              ? prisma.aI_Skill.upsert({
                  where: {
                    projectId_slug: {
                      projectId: scope.projectId as number,
                      slug: skill.slug,
                    },
                  },
                  create: { ...scope, ...data, slug: skill.slug },
                  update: data,
                })
              : prisma.aI_Skill.upsert({
                  where: {
                    userId_slug: { userId: user.id, slug: skill.slug },
                  },
                  create: { ...scope, ...data, slug: skill.slug },
                  update: data,
                });
          })
        );
        return sanitizeForJson({
          success: true,
          skills,
          total: skills.length,
        });
      }),
    }),

    hypertask_start_timer: tool({
      description:
        "Start a timer for a task. Provide whichever task identifier you know; extra identifiers are tolerated.",
      inputSchema: z.object({
        task_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(TOOL_TASK_ID_DESCRIPTION),
        ticket_number: z.string().optional(),
        unique_index: z.coerce.number().int().positive().optional(),
        project_id: z.coerce.number().int().positive().optional(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_start_timer");
        const taskResult = await resolveTaskForTool(user, input);
        if (taskResult.error) {
          return { success: false, error: taskResult.error };
        }

        const task = taskResult.task;
        if (!task) {
          return { success: false, error: "Task not found or access denied" };
        }

        try {
          const entry = await startTimer(user.id, task.id);
          return sanitizeForJson({ success: true, entry });
        } catch (error) {
          if (error instanceof TimeTrackingDisabledError) {
            return { success: false, error: error.message };
          }
          throw error;
        }
      }),
    }),

    hypertask_stop_timer: tool({
      description:
        "Stop the running timer for a task. Provide whichever task identifier you know; extra identifiers are tolerated.",
      inputSchema: z.object({
        task_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(TOOL_TASK_ID_DESCRIPTION),
        ticket_number: z.string().optional(),
        unique_index: z.coerce.number().int().positive().optional(),
        project_id: z.coerce.number().int().positive().optional(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_stop_timer");
        const taskResult = await resolveTaskForTool(user, input);
        if (taskResult.error) {
          return { success: false, error: taskResult.error };
        }

        const task = taskResult.task;
        if (!task) {
          return { success: false, error: "Task not found or access denied" };
        }

        try {
          const entry = await stopTimer(user.id, task.id);
          return sanitizeForJson({ success: true, entry });
        } catch (error) {
          if (error instanceof TimeTrackingDisabledError) {
            return { success: false, error: error.message };
          }
          throw error;
        }
      }),
    }),

    hypertask_pause_timer: tool({
      description:
        "Pause the running timer for a task. Provide whichever task identifier you know; extra identifiers are tolerated.",
      inputSchema: z.object({
        task_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(TOOL_TASK_ID_DESCRIPTION),
        ticket_number: z.string().optional(),
        unique_index: z.coerce.number().int().positive().optional(),
        project_id: z.coerce.number().int().positive().optional(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_pause_timer");
        const taskResult = await resolveTaskForTool(user, input);
        if (taskResult.error) {
          return { success: false, error: taskResult.error };
        }

        const task = taskResult.task;
        if (!task) {
          return { success: false, error: "Task not found or access denied" };
        }

        try {
          const entry = await pauseTimer(user.id, task.id);
          if (!entry) {
            return {
              success: false,
              error: "There is no running timer on that task.",
            };
          }
          return sanitizeForJson({ success: true, entry });
        } catch (error) {
          if (error instanceof TimeTrackingDisabledError) {
            return { success: false, error: error.message };
          }
          throw error;
        }
      }),
    }),

    hypertask_resume_timer: tool({
      description:
        "Resume the paused timer for a task. Provide whichever task identifier you know; extra identifiers are tolerated.",
      inputSchema: z.object({
        task_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(TOOL_TASK_ID_DESCRIPTION),
        ticket_number: z.string().optional(),
        unique_index: z.coerce.number().int().positive().optional(),
        project_id: z.coerce.number().int().positive().optional(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_resume_timer");
        const taskResult = await resolveTaskForTool(user, input);
        if (taskResult.error) {
          return { success: false, error: taskResult.error };
        }

        const task = taskResult.task;
        if (!task) {
          return { success: false, error: "Task not found or access denied" };
        }

        try {
          const entry = await resumeTimer(user.id, task.id);
          if (!entry) {
            return {
              success: false,
              error: "There is no paused timer on that task.",
            };
          }
          return sanitizeForJson({ success: true, entry });
        } catch (error) {
          if (error instanceof TimeTrackingDisabledError) {
            return { success: false, error: error.message };
          }
          throw error;
        }
      }),
    }),

    hypertask_time_status: tool({
      description:
        "Get the time-tracking status and totals for a task. Provide whichever task identifier you know; extra identifiers are tolerated.",
      inputSchema: z.object({
        task_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(TOOL_TASK_ID_DESCRIPTION),
        ticket_number: z.string().optional(),
        unique_index: z.coerce.number().int().positive().optional(),
        project_id: z.coerce.number().int().positive().optional(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_time_status");
        const taskResult = await resolveTaskForTool(user, input);
        if (taskResult.error) {
          return { success: false, error: taskResult.error };
        }

        const task = taskResult.task;
        if (!task) {
          return { success: false, error: "Task not found or access denied" };
        }

        const summary = await taskSummary(user.id, task.id);
        return sanitizeForJson({ success: true, summary });
      }),
    }),

    hypertask_time_report: tool({
      description:
        "Query up to 1,000 time entries across work the signed-in user can access. Optional filters match the MCP/API report: team, board, task, user, date range, and running-only.",
      inputSchema: z
        .object({
          team_id: z.string().trim().min(1).optional(),
          board_id: z.coerce.number().int().positive().optional(),
          task_id: z.coerce
            .number()
            .int()
            .positive()
            .optional()
            .describe(TOOL_TASK_ID_DESCRIPTION),
          ticket_number: z.string().trim().min(1).optional(),
          unique_index: z.coerce.number().int().positive().optional(),
          project_id: z.coerce.number().int().positive().optional(),
          user: z
            .union([z.literal("me"), z.coerce.number().int().positive()])
            .optional(),
          from: z.string().datetime({ offset: true }).optional(),
          to: z.string().datetime({ offset: true }).optional(),
          running_only: z.boolean().optional().default(false),
        })
        .strict()
        .superRefine((input, ctx) => {
          if (input.unique_index !== undefined && input.project_id === undefined) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["project_id"],
              message: "project_id is required with unique_index",
            });
          }
          if (
            input.project_id !== undefined &&
            input.unique_index === undefined &&
            input.ticket_number === undefined &&
            input.task_id === undefined
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["project_id"],
              message:
                "project_id must scope a task identifier; use board_id to filter a whole board",
            });
          }
          if (
            input.from &&
            input.to &&
            new Date(input.from).getTime() > new Date(input.to).getTime()
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["to"],
              message: "to must be on or after from",
            });
          }
        }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_time_report");
        let taskId: number | undefined;
        if (
          input.task_id !== undefined ||
          input.ticket_number !== undefined ||
          input.unique_index !== undefined
        ) {
          const resolved = await resolveTaskForTool(user, input);
          if (resolved.error || !resolved.task) {
            return {
              success: false,
              error: resolved.error ?? "Task not found or access denied",
            };
          }
          taskId = resolved.task.id;
        }

        const entries = await listReport(user.id, {
          teamId: input.team_id,
          boardId: input.board_id,
          taskId,
          filterUserId:
            input.user === "me"
              ? user.id
              : typeof input.user === "number"
                ? input.user
                : undefined,
          from: input.from ? new Date(input.from) : undefined,
          to: input.to ? new Date(input.to) : undefined,
          runningOnly: input.running_only,
        });
        return sanitizeForJson({ success: true, entries });
      }),
    }),

    hypertask_running_timers: tool({
      description: "List the authenticated user's running timers.",
      inputSchema: z.object({}),
      execute: withToolErrors(async () => {
        sendStatus("hypertask_running_timers");
        const now = new Date();
        const entries = await listRunning(user.id);
        const timers = entries.map((entry) => ({
          id: entry.id,
          task: {
            title: entry.task.title,
            ticketId: entry.task.ticketNumber ?? String(entry.task.uniqueIndex),
          },
          pausedAt: entry.pausedAt,
          elapsedSeconds: elapsedSeconds(entry.startedAt, null, entry.pausedAt, now),
        }));

        return sanitizeForJson({ success: true, timers });
      }),
    }),

    hypertask_log_time: tool({
      description:
        "Log a positive number of minutes for a task. Provide whichever task identifier you know; extra identifiers are tolerated.",
      inputSchema: z.object({
        task_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(TOOL_TASK_ID_DESCRIPTION),
        ticket_number: z.string().optional(),
        unique_index: z.coerce.number().int().positive().optional(),
        project_id: z.coerce.number().int().positive().optional(),
        minutes: z.number().int().min(1).max(1440),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_log_time");
        const taskResult = await resolveTaskForTool(user, input);
        if (taskResult.error) {
          return { success: false, error: taskResult.error };
        }

        const task = taskResult.task;
        if (!task) {
          return { success: false, error: "Task not found or access denied" };
        }

        try {
          const entry = await logMinutes(user.id, task.id, input.minutes);
          return sanitizeForJson({ success: true, entry });
        } catch (error) {
          if (error instanceof TimeTrackingDisabledError) {
            return { success: false, error: error.message };
          }
          throw error;
        }
      }),
    }),

    rag_retrieval: tool({
      description:
        "Retrieve semantically relevant Hypertask task/comment context from Turbopuffer hybrid search. Use for conversational, ambiguous, or semantic task/comment questions.",
      inputSchema: z.object({
        query: z.string().min(1).max(500),
        metadata_filters: z.record(z.string(), z.unknown()).optional(),
        limit: z.coerce.number().int().min(1).max(25).default(10),
      }),
      execute: async (input) => {
        sendStatus("rag_retrieval");
        return sanitizeForJson(
          await retrieveBoardKnowledge(
            {
              query: input.query,
              metadataFilters: input.metadata_filters,
              limit: input.limit,
              defaultProjectId: body.default_context?.project_id,
            },
            { userId: user.id }
          )
        );
      },
    }),

    web_search: tool({
      description:
        process.env.TAVILY_API_KEY
          ? "Search the web for current information using Tavily."
          : "Unavailable: TAVILY_API_KEY is not configured on the server.",
      inputSchema: z.object({
        query: z.string().min(1).max(400),
        max_results: z.coerce.number().int().min(1).max(10).default(5),
        search_depth: z.enum(["basic", "advanced"]).default("basic"),
      }),
      execute: async (input) => {
        sendStatus("web_search");
        const apiKey = process.env.TAVILY_API_KEY;
        if (!apiKey) {
          return {
            success: false,
            unavailable: true,
            error: "web_search is unavailable because TAVILY_API_KEY is not configured.",
          };
        }
        const response = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            query: input.query,
            max_results: input.max_results,
            search_depth: input.search_depth,
            include_answer: true,
            include_raw_content: false,
          }),
        });
        if (!response.ok) {
          const text = await response.text().catch(() => response.statusText);
          return {
            success: false,
            error: `Tavily search failed (${response.status}): ${text}`,
          };
        }
        const json = (await response.json()) as {
          answer?: string;
          results?: Array<{
            title?: string;
            url?: string;
            content?: string;
            score?: number;
          }>;
        };
        return sanitizeForJson({
          success: true,
          answer: json.answer,
          results: (json.results ?? []).map((result) => ({
            title: result.title,
            url: result.url,
            content: result.content,
            score: result.score,
          })),
        });
      },
    }),

    search_help_docs: tool({
      description:
        "Search the Hypertask help center (help.hypertask.ai) for how-to and product-feature articles. Use for questions about how Hypertask itself works — boards, columns/sections, the Command Center (Ctrl+K), keyboard shortcuts, AI features and models, notifications, sharing, pricing, MCP/CLI setup. Do NOT use for questions about the user's own tasks or comments (use rag_retrieval/list_tasks/search_tasks for those).",
      inputSchema: z.object({
        query: z.string().min(1).max(200),
        limit: z.coerce.number().int().min(1).max(6).default(4),
      }),
      execute: async (input) => {
        sendStatus("search_help_docs");
        return sanitizeForJson(await searchHelpDocs(input));
      },
    }),
  };

  // The parity inventory is defined by the object literal above. Seal it
  // immediately so aliases and helper calls cannot add or remove runtime tools.
  Object.seal(tools);

  return trackToolSetExecutions(
    tools,
    recordToolExecution,
    recordToolStart,
    actingAgentId ? { agentId: actingAgentId, userId: user.id } : null
  );
}

function fallbackTitle(message: string) {
  return message
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 8)
    .join(" ")
    .replace(/^["']|["']$/g, "")
    .replace(/[.!?;:,]+$/g, "")
    .trim();
}

async function generateConversationTitle(
  content: string,
  message: string,
  byokApiKey?: string,
  tags?: AiGatewayTags,
  usageContext?: {
    userId: number;
    projectId?: number | null;
    taskId?: number | null;
    agentId?: string | null;
  },
  abortSignal?: AbortSignal,
) {
  const fallback = fallbackTitle(message);
  if (!byokApiKey && !isAiGatewayEnabled()) {
    return fallback;
  }
  try {
    const model = resolveAiModel("openai", "gpt-5.4-mini", byokApiKey);
    const result = await generateText({
      model,
      instructions:
        "Write a very short chat thread title (at most 8 words). No quotes. No trailing punctuation. Output only the title text.",
      messages: [{ role: "user", content: content || message }],
      temperature: 1,
      maxRetries: 1,
      abortSignal,
      providerOptions: providerOptionsForAiModel(model, "chat", tags),
    });
    if (usageContext) {
      await logAiUsage({
        ...usageContext,
        teamId: tags?.teamId ?? null,
        provider: "openai",
        model: "gpt-5.4-mini",
        feature: "chat",
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
        totalTokens: result.usage.totalTokens ?? 0,
      });
    }
    const cleaned = fallbackTitle(result.text);
    return cleaned || fallback;
  } catch (error) {
    if (abortSignal?.aborted) throw error;
    console.error("[ai/chat/stream] title generation failed", error);
    return fallback;
  }
}

export async function POST(request: NextRequest) {
  const requestUser =
    (await getAiRequestUser(request)) ??
    (await getCronServiceRequestUser(request));
  if (!requestUser?.id) {
    return createSseErrorResponse("Unauthorized");
  }

  let body: ChatRequest;
  let json: unknown;
  try {
    json = await request.json();
  } catch (error) {
    return createSseErrorResponse(requestErrorMessage(error, "body"));
  }
  try {
    body = chatRequestSchema.parse(json);
  } catch (error) {
    return createSseErrorResponse(requestErrorMessage(error, "validation"));
  }

  const heartbeatExecutionId = request.headers.get(
    "x-hypertask-heartbeat-execution-id"
  );
  if (
    (heartbeatExecutionId || body.heartbeat_execution_id) &&
    heartbeatExecutionId !== body.heartbeat_execution_id
  ) {
    return createSseErrorResponse("Heartbeat execution identity mismatch", 409);
  }
  const heartbeatTurn = heartbeatExecutionId
    ? decodeHeartbeatTurnMessage(body.message)
    : null;
  if (heartbeatExecutionId) {
    const agentId = request.headers.get("x-hypertask-heartbeat-agent-id");
    const claimedAt = request.headers.get("x-hypertask-heartbeat-claimed-at");
    if (
      !heartbeatTurn ||
      heartbeatTurn.metadata.executionId !== heartbeatExecutionId ||
      heartbeatTurn.metadata.agentId !== agentId ||
      heartbeatTurn.metadata.claimedAt !== claimedAt ||
      heartbeatTurn.metadata.scanWatermark !== claimedAt
    ) {
      return createSseErrorResponse("Heartbeat turn marker mismatch", 409);
    }
  }
  const requestMessage = heartbeatTurn?.prompt ?? body.message;

  let dbUser: AuthedUser | null;
  try {
    dbUser = await prisma.user.findUnique({
      where: { id: requestUser.id },
      select: { id: true, email: true, displayName: true },
    });
  } catch (error) {
    await reportHandledChatError(error, "load-user");
    return createSseErrorResponse(errorMessage(error));
  }
  if (!dbUser) {
    return createSseErrorResponse("Unauthorized");
  }

  let userMessagePersisted = false;
  if (body.session_id && body.user_message_id) {
    try {
      const nativeTurnPersistence = await ensureNativeChatTurn({
        db: prisma,
        sessionId: body.session_id,
        messageId: body.user_message_id,
        userId: dbUser.id,
        content: body.message,
      });
      if (nativeTurnPersistence === "conflict") {
        return createSseErrorResponse(
          "This chat could not be synchronized. Start a new chat and try again.",
          409,
        );
      }
      userMessagePersisted = true;
    } catch (error) {
      console.error(
        "[ai/chat/stream] native user-message persistence failed; local history remains authoritative",
        error,
      );
    }
  }

  if (body.session_id && body.assistant_message_id) {
    try {
      const replay = await findNativeAssistantReplay({
        db: prisma,
        sessionId: body.session_id,
        messageId: body.assistant_message_id,
        userId: dbUser.id,
      });
      if (replay.status === "conflict") {
        return createSseErrorResponse(
          "This chat could not be synchronized. Start a new chat and try again.",
          409,
        );
      }
      if (replay.status === "completed") {
        return new Response(
          sseFrame("content", { content: replay.content }) +
            sseFrame("done", {
              status: "complete",
              replayed: true,
              user_message_persisted: userMessagePersisted,
              assistant_persisted: true,
            }),
          { headers: SSE_HEADERS },
        );
      }
    } catch (error) {
      await reportHandledChatError(error, "native-replay-check");
      return createSseErrorResponse(
        "AI chat could not verify this request. Try again.",
        503,
      );
    }
  }

  // Best-effort: link the session to the board used for its first message. The
  // null guard makes the original board sticky if the composer scope changes.
  const contextProjectId = body.default_context?.project_id;
  if (body.session_id && typeof contextProjectId === "number") {
    try {
      await prisma.chatSession.updateMany({
        where: {
          id: body.session_id,
          userId: dbUser.id,
          projectId: null,
        },
        data: { projectId: contextProjectId },
      });
    } catch (error) {
      console.error("[ai/chat/stream] session projectId stamp failed:", error);
    }
  }

  // Best-effort: link the session to the ticket it was opened on (HTPR-4311). Never
  // blocks the chat request — a bad task_id just leaves the session unlinked.
  const contextTaskId = await resolveAiUsageTaskId({
    taskId: body.default_context?.task_id,
    projectId: body.default_context?.project_id,
    userId: dbUser.id,
  });
  if (body.session_id && contextTaskId !== null) {
    try {
      await prisma.chatSession.updateMany({
        where: {
          id: body.session_id,
          userId: dbUser.id,
          taskId: null,
        },
        data: { taskId: contextTaskId },
      });
    } catch (error) {
      console.error("[ai/chat/stream] session taskId stamp failed:", error);
    }
  }

  let selected: {
    provider: ProviderId;
    usageProvider: string;
    modelId: string;
    model: LanguageModel;
    settings: { temperature?: number; maxOutputTokens?: number };
    providerOptions?: AiProviderOptions;
  };
  let titleByokApiKey: string | undefined;
  const gatewayTags: AiGatewayTags = {
    teamId: null,
    projectId: null,
    userId: dbUser.id,
  };
  let usageProjectId: number | null = null;
  let actingAgent: Awaited<ReturnType<typeof loadActingAgent>> = null;
  // External agents are chatted with from Agent Chat, not this native stream.
  // Checked before any provider or model work so the turn never starts.
  if (body.session_id) {
    const chatAgent = await prisma.chatSession.findFirst({
      where: { id: body.session_id, userId: dbUser.id },
      select: { agent: { select: { runtimeType: true } } },
    });
    if (chatAgent?.agent?.runtimeType === "EXTERNAL") {
      return NextResponse.json(
        { error: "External agents are chatted with from Agent Chat" },
        { status: 400 }
      );
    }
  }
  try {
    const requestedProjectId = body.default_context?.project_id;
    // Global chat pages intentionally omit a board. Reuse the session's board
    // when possible, then fund an ordinary account chat from the strongest
    // team the user can access. This keeps every provider key lookup attributed.
    const chatTeamContext = await resolveChatTeamContext({
      userId: dbUser.id,
      requestedProjectId,
      requestedTeamId: body.teamId ?? undefined,
      sessionId: body.session_id,
    });
    const providerContext = buildChatProviderContext(
      dbUser.id,
      chatTeamContext,
      requestedProjectId,
      body.teamId ?? undefined,
    );
    if (!providerContext) {
      return createSseErrorResponse(
        "The requested board or team is unavailable.",
        403,
      );
    }
    const planGateProjectId = providerContext.planGateProjectId;
    const teamProviderSettings = chatTeamContext?.aiProviderSettings;
    usageProjectId = chatTeamContext?.projectId ?? null;
    gatewayTags.projectId = usageProjectId;
    gatewayTags.teamId = chatTeamContext?.teamId ?? null;
    let keyLookupContext = providerContext.keyLookupContext;
    if (!isAiFeatureEnabled(body.aiFeature, teamProviderSettings)) {
      return createSseErrorResponse(
        "This AI feature is turned off for your team",
        403,
      );
    }
    const userSetting = await prisma.userSetting.findUnique({
      where: { userId: dbUser.id },
      select: { aiModelPreferences: true },
    });
    const personalIds = getAiModelPreferenceIds(
      userSetting?.aiModelPreferences as
        | TAiModelPreferences
        | null
        | undefined,
      body.aiFeature as TAiModelPreferenceSurface,
      gatewayTags.teamId,
    );
    const personalModelOptionId =
      personalIds.teamScoped ?? personalIds.global ?? null;
    const storePlanId = await storePlanIdForProject(
      gatewayTags.teamId ? undefined : planGateProjectId,
      gatewayTags.teamId,
    );
    // Loaded here rather than alongside the skills below, because the model
    // this turn runs on depends on it and that is decided before the stream
    // opens. A failure surfaces through this block's catch as a stream error,
    // which is what we want: never silently fall back to the human's identity.
    actingAgent = await loadActingAgent(body.session_id, dbUser.id);
    // An agent with its own provider credential runs on that account, so the
    // key lookup has to know which agent is acting before it resolves a key
    // (HTPR-5389). Server-derived from the session, never request input.
    keyLookupContext = { ...keyLookupContext, agentId: actingAgent?.id ?? null };
    let hasEligibleByokCredential = false;
    if (storePlanId === "BYOK") {
      const credential = await getByokOrTeamGatewayApiKeyForModelOption(
        preferredAiModelOption,
        body.byokProviderFlags,
        keyLookupContext,
      );
      const sharedKey = process.env.AI_GATEWAY_API_KEY?.trim();
      hasEligibleByokCredential =
        (typeof credential === "string" &&
          credential.trim().length > 0 &&
          credential.trim() !== sharedKey) ||
        (credential !== null && typeof credential === "object");
    }
    const requestDefaultModelOption = getDefaultAiModelOptionForPlan(
      storePlanId,
      hasEligibleByokCredential,
    );
    // An agent pinned to a model runs its own turns on it, which is the point
    // of pinning: a sweeper on a cheap model, a coordinator on an expensive
    // one. An explicit choice in the request still wins, so switching model
    // inside the agent's chat keeps working.
    const modelOptionIdForTurn = resolveAgentModelPin({
      requestedModelOptionId: body.modelOptionId,
      requestedModel: body.model,
      agentModelOptionId: actingAgent?.modelOptionId,
    });
    let selection = resolveModelSelection(
      body.provider,
      body.model,
      modelOptionIdForTurn,
      teamProviderSettings,
      body.aiFeature,
      personalModelOptionId,
      requestDefaultModelOption,
    );
    if (selection.modelOption) {
      selection = selectionFromModelOption(
        filterModelOptionForTeam(selection.modelOption, teamProviderSettings)
      );
    }
    const getSelectionApiKey = (
      selected: ModelSelection
    ) =>
      selected.modelOption
        ? getByokOrTeamGatewayApiKeyForModelOption(
            selected.modelOption,
            body.byokProviderFlags,
            keyLookupContext
          )
        : selected.provider === "gateway"
          ? getTeamGatewayApiKey(keyLookupContext)
          : getByokOrTeamGatewayApiKeyForProvider(
              selected.provider,
              body.byokProviderFlags,
              keyLookupContext,
              { resolveOpenRouterWithoutFlag: false }
            );
    let byokApiKey = await getSelectionApiKey(selection);

    if (
      selection.provider === "custom" &&
      !isCustomEndpointConfig(byokApiKey)
    ) {
      selection = defaultModelSelection(
        teamProviderSettings,
        body.aiFeature,
        personalModelOptionId,
        false,
        requestDefaultModelOption,
      );
      byokApiKey = await getSelectionApiKey(selection);
    }

    if (selection.provider === "openrouter") {
      if (isVercelAiGatewayKey(byokApiKey)) {
        selection = defaultModelSelection(
          teamProviderSettings,
          body.aiFeature,
          personalModelOptionId,
          true,
          requestDefaultModelOption,
        );
      } else if (!byokApiKey) {
        selection = defaultModelSelection(
          teamProviderSettings,
          body.aiFeature,
          personalModelOptionId,
          true,
          requestDefaultModelOption,
        );
        byokApiKey = await getSelectionApiKey(selection);
      }
    }

    await assertModelAllowedForPlan(
      planGateProjectId,
      selection.modelOption,
      gatewayTags.teamId,
      byokApiKey,
    );

    titleByokApiKey =
      selection.provider === "openai" && typeof byokApiKey === "string"
        ? byokApiKey
        : await getByokOrTeamGatewayApiKeyForProvider(
            "openai",
            body.byokProviderFlags,
            keyLookupContext,
            { resolveOpenRouterWithoutFlag: false }
          );
    const resolvedModel = selectModel(
      selection.provider,
      selection.model,
      byokApiKey,
      selection.modelOption,
      gatewayTags
    );
    selected = {
      ...resolvedModel,
      provider: selection.provider,
      modelId: resolvedModel.resolvedModelId,
    };
  } catch (error) {
    await reportHandledChatError(error, "select-model");
    return createSseErrorResponse(errorMessage(error));
  }

  // A retry reuses the assistant UUID for idempotent persistence, while each
  // network attempt gets its own cancellation identity. The server generates
  // one for older clients, which can stream safely but cannot issue exact Stop.
  const streamId = body.stream_id ?? randomUUID();
  const streamLease = await acquireAiChatStreamLease(
    dbUser.id,
    body.session_id ? { sessionId: body.session_id, streamId } : undefined,
  );
  if (streamLease === "busy") {
    return createSseErrorResponse(
      "Another AI reply is already in progress. Reopen that chat or wait for it to finish.",
      409,
    );
  }
  if (streamLease === "limited") {
    return createSseErrorResponse(
      "Too many AI replies were started recently. Please wait a minute and try again.",
      429,
    );
  }
  if (streamLease === "unavailable") {
    return createSseErrorResponse(
      "AI chat is temporarily unavailable. Please try again shortly.",
      503,
    );
  }

  let heartbeatExecutionTerminal = false;
  if (heartbeatExecutionId) {
    const agentId = request.headers.get("x-hypertask-heartbeat-agent-id");
    const claimedAt = request.headers.get("x-hypertask-heartbeat-claimed-at");
    if (
      !agentId ||
      !claimedAt ||
      !body.session_id ||
      !body.user_message_id ||
      !body.assistant_message_id
    ) {
      await releaseAiChatStreamLease(streamLease);
      return createSseErrorResponse("Incomplete heartbeat execution", 409);
    }
    try {
      await startHeartbeatExecution({
        executionId: heartbeatExecutionId,
        agentId,
        userId: dbUser.id,
        sessionId: body.session_id,
        userMessageId: body.user_message_id,
        assistantMessageId: body.assistant_message_id,
        claimedAt: new Date(claimedAt).toISOString(),
      });
    } catch (error) {
      await releaseAiChatStreamLease(streamLease);
      return createSseErrorResponse(errorMessage(error), 409);
    }
  }

  const firstTurn = !body.chat_history?.length;
  const encoder = new TextEncoder();
  let clientConnected = true;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let doneSent = false;
      let errorSent = false;
      let cancelled = false;
      const providerAbort = new AbortController();
      const stopCancellationWatch = body.session_id && streamId
        ? watchAiChatCancellation(
            streamLease.redis,
            dbUser.id,
            body.session_id,
            streamId,
            () => {
              if (cancelled) return;
              cancelled = true;
              providerAbort.abort("User stopped this reply");
            },
          )
        : () => undefined;
      const send: SendSse = (event, data) => {
        if (!clientConnected) return;
        try {
          controller.enqueue(encoder.encode(sseFrame(event, data)));
        } catch (error) {
          clientConnected = false;
          console.info(
            "[ai/chat/stream] client disconnected; completing in background",
            error,
          );
        }
      };
      const finish = (
        status: "complete" | "error",
        data: Record<string, unknown> = {},
      ) => {
        if (doneSent) return;
        doneSent = true;
        send("done", { status, ...data });
        if (!clientConnected) return;
        try {
          controller.close();
        } catch {
          clientConnected = false;
        }
      };

      try {
        const skillResolution = await resolveSkills(requestMessage, {
          userId: dbUser.id,
          projectId: body.default_context?.project_id,
        });
        const resolvedBody = {
          ...body,
          // A message of only "/standup" strips to empty; fall back to the raw
          // message so retrieval and the model query are never blank. The skill
          // body in the system prompt still carries the intent.
          message: skillResolution.cleanedText || requestMessage,
        };
        const agentPromptAddition = actingAgent
          ? `You are acting as "${actingAgent.displayName}", a native Hypertask agent. ` +
            `Comments, assignments, moves, and tasks you create are attributed to this ` +
            `agent, not the human you're talking to.` +
            (actingAgent.prompt ? ` Follow these instructions:\n${actingAgent.prompt}` : "")
          : null;
        const instructions = [
          AGENT_SYSTEM_PROMPT,
          skillResolution.systemPromptAddition,
          agentPromptAddition,
        ]
          .filter(Boolean)
          .join("\n\n");
        // Always load the ticket the user is viewing so the chat can answer
        // about "this ticket" without depending on the model choosing to search.
        const currentTaskContext = await loadCurrentTaskContext(
          contextTaskId ? [contextTaskId] : [],
          dbUser.id,
          undefined,
          { projectId: body.default_context?.project_id },
        );
        const messages: ModelMessage[] = [
          {
            role: "user",
            content: createUserContent(resolvedBody, dbUser, currentTaskContext),
          },
        ];
        const toolExecutions: ToolExecution[] = [];
        const tools = buildTools(
          dbUser,
          resolvedBody,
          send,
          (execution) => {
            toolExecutions.push(execution);
          },
          actingAgent?.id ?? null,
          async (toolName) => {
            // Stop is cooperative: an operation already committed cannot be
            // undone, but no later tool may begin after cancellation lands.
            assertAiChatToolCanStart(cancelled, providerAbort.signal);
            const release = body.session_id && streamId
              ? await acquireAiChatToolFence(
                  streamLease.redis,
                  dbUser.id,
                  body.session_id,
                  streamId,
                )
              : undefined;
            try {
              if (heartbeatExecutionId && writeToolNames.has(toolName)) {
                // Persist the unsafe-to-replay boundary BEFORE a mutating tool
                // begins. If Redis cannot record it, the tool does not run.
                await markHeartbeatMutationStarted(heartbeatExecutionId);
              }
              return release;
            } catch (error) {
              await release?.();
              throw error;
            }
          },
          heartbeatTurn?.metadata
        );
        if (
          heartbeatExecutionId &&
          body.session_id &&
          body.user_message_id
        ) {
          // This durable phase flip happens immediately before the model can
          // execute tools. Recovery can retry an unstarted reservation, but
          // never treats a started turn as safe to replay after Redis loss.
          const started = await prisma.chatMessage.updateMany({
            where: {
              id: body.user_message_id,
              sessionId: body.session_id,
              role: "human",
              content: body.message,
              isDelivered: false,
            },
            data: { isDelivered: true },
          });
          if (started.count !== 1) {
            throw new Error("Heartbeat durable reservation could not start");
          }
        }
        const result = streamText({
          model: selected.model,
          instructions,
          messages,
          tools,
          stopWhen: stepCountIs(MAX_TOOL_STEPS),
          maxRetries: 2,
          abortSignal: providerAbort.signal,
          onFinish: async ({ usage }) => {
            await logAiUsage({
              userId: dbUser.id,
              teamId: gatewayTags.teamId ?? null,
              projectId: usageProjectId,
              taskId: contextTaskId,
              // Without this an agent's own turns land as agentId: null, so the
              // team is billed for work nobody can trace back to the agent.
              agentId: actingAgent?.id ?? null,
              provider: selected.usageProvider,
              model: selected.modelId,
              feature: "chat",
              inputTokens: usage.inputTokens ?? 0,
              outputTokens: usage.outputTokens ?? 0,
              totalTokens: usage.totalTokens ?? 0,
            });
          },
          onError: async ({ error }) => {
            if (errorSent) return;
            errorSent = true;
            if (cancelled) {
              if (heartbeatExecutionId) {
                await failHeartbeatExecution(
                  heartbeatExecutionId,
                  "AI reply cancelled",
                );
                heartbeatExecutionTerminal = true;
              }
              finish("error", { cancelled: true, content: "Stream cancelled." });
              return;
            }
            // This is the only path that can end the turn with no assistant
            // message ever persisted (every other exit reaches
            // persistAssistantMessage, even the empty-completion fallback).
            // A tool can execute before the model errors out, so callers
            // that infer "nothing happened" from an absent reply (the
            // native-agent heartbeat's retry logic) need this flag to avoid
            // re-sending the same instructions and replaying that write.
            send("error", {
              content: userFacingErrorMessage(error, "model-stream"),
              toolsExecuted: toolExecutions.length > 0,
              ...userFacingErrorDetails(error),
            });
            finish("error");
            if (heartbeatExecutionId) {
              await failHeartbeatExecution(
                heartbeatExecutionId,
                errorMessage(error)
              );
              heartbeatExecutionTerminal = true;
            }
            await reportHandledChatError(error, "model-stream");
          },
          providerOptions: selected.providerOptions,
          ...selected.settings,
        });

        const chunks: string[] = [];
        for await (const chunk of result.textStream) {
          if (errorSent || cancelled) break;
          if (!chunk) continue;
          chunks.push(chunk);
          send("content", { content: chunk });
        }

        if (errorSent || cancelled) return;

        // GPT-5.5 (especially Instant / low effort) can return an empty completion
        // on a query it should answer. Retry once at higher effort, then fall back
        // to a clear message so the user never sees a blank reply. (HTPR-4007)
        //
        // SAFETY: only retry when the first attempt ran NO tools. If a tool already
        // executed (a write like create/update task may have side effects), re-running
        // the whole agentic loop could duplicate that action, so we skip straight to
        // the fallback instead.
        let emptyCompletionError: unknown;
        let emptyCompletionRetryFailed = false;
        let reachedStepLimit = false;
        if (!hasVisibleCompletion(chunks)) {
          const [toolCalls, steps] = await Promise.all([
            Promise.resolve(result.toolCalls).catch(() => []),
            Promise.resolve(result.steps).catch(() => []),
          ]);
          reachedStepLimit =
            Array.isArray(steps) && steps.length >= MAX_TOOL_STEPS;
          if (errorSent) return;
          const ranTools = Array.isArray(toolCalls) && toolCalls.length > 0;
          if (!ranTools && !cancelled && !providerAbort.signal.aborted) {
            try {
              const retry = await generateText({
                model: selected.model,
                instructions,
                messages,
                tools,
                stopWhen: stepCountIs(MAX_TOOL_STEPS),
                maxRetries: 1,
                abortSignal: providerAbort.signal,
                providerOptions: withHigherEffort(selected.providerOptions),
                ...selected.settings,
              });
              reachedStepLimit =
                reachedStepLimit || retry.steps.length >= MAX_TOOL_STEPS;
              await logAiUsage({
                userId: dbUser.id,
                teamId: gatewayTags.teamId ?? null,
                projectId: usageProjectId,
                taskId: contextTaskId,
                agentId: actingAgent?.id ?? null,
                provider: selected.usageProvider,
                model: selected.modelId,
                feature: "chat",
                inputTokens: retry.usage.inputTokens ?? 0,
                outputTokens: retry.usage.outputTokens ?? 0,
                totalTokens: retry.usage.totalTokens ?? 0,
              });
              const retryText = retry.text?.trim() ?? "";
              if (retryText) {
                chunks.push(retryText);
                send("content", { content: retryText });
              }
            } catch (retryError) {
              emptyCompletionError = retryError;
              emptyCompletionRetryFailed = true;
              console.error(
                "[ai/chat/stream] empty-completion retry failed",
                retryError
              );
            }
          }
        }
        if (errorSent) return;
        if (!hasVisibleCompletion(chunks)) {
          // Count only unrecovered empty completions. A successful retry is
          // invisible to the user and is not an incident worth ticketing.
          await reportEmptyCompletion(
            emptyCompletionRetryFailed,
            emptyCompletionError
          );
          const fallback = buildEmptyCompletionSummary({
            toolExecutions,
            writeToolNames,
            reachedStepLimit,
            maxToolSteps: MAX_TOOL_STEPS,
            currentUserId: dbUser.id,
          });
          send("content", { content: fallback });
          chunks.push(fallback);
        }

        let completionFenceToken: string | null = null;
        let stopCompletionFenceRenewal: (() => Promise<void>) | null = null;
        if (body.session_id && streamId && body.assistant_message_id) {
          completionFenceToken = await acquireAiChatCompletionFence(
            streamLease.redis,
            dbUser.id,
            body.session_id,
            streamId,
            body.assistant_message_id,
          );
          if (!completionFenceToken) {
            cancelled = true;
            providerAbort.abort("User stopped this reply before persistence");
            finish("error", { cancelled: true, content: "Stream cancelled." });
            return;
          }
          stopCompletionFenceRenewal = keepAiChatCompletionFenceAlive(
            streamLease.redis,
            dbUser.id,
            body.session_id,
            body.assistant_message_id,
            completionFenceToken,
          );
        }

        let assistantPersisted = false;
        if (body.session_id && body.assistant_message_id) {
          try {
            assistantPersisted = await persistAssistantMessage({
              db: prisma,
              messageId: body.assistant_message_id,
              sessionId: body.session_id,
              userId: dbUser.id,
              content: chunks.join(""),
              linkify: linkifyTicketRefs,
            });
          } catch (error) {
            console.error(
              "[ai/chat/stream] assistant persistence failed; client will retry",
              error,
            );
          } finally {
            if (completionFenceToken) {
              try {
                await stopCompletionFenceRenewal?.();
                if (assistantPersisted) {
                  await finishAiChatCompletionFence(
                    streamLease.redis,
                    dbUser.id,
                    body.session_id,
                    body.assistant_message_id,
                    completionFenceToken,
                  );
                } else {
                  await releaseAiChatCompletionFence(
                    streamLease.redis,
                    dbUser.id,
                    body.session_id,
                    body.assistant_message_id,
                    completionFenceToken,
                  );
                }
              } catch (error) {
                // Persistence already has its own durable outcome. Redis
                // cleanup must never turn that outcome into a retryable write.
                console.error(
                  "[ai/chat/stream] completion fence will expire automatically",
                  error,
                );
              }
            }
          }
        }

        if (heartbeatExecutionId) {
          if (assistantPersisted) {
            await completeHeartbeatExecution(heartbeatExecutionId);
          } else {
            await failHeartbeatExecution(
              heartbeatExecutionId,
              "assistant reply was not persisted"
            );
          }
          heartbeatExecutionTerminal = true;
        }

        // The completed reply is durable before title enrichment begins. A
        // title-provider or metadata-write failure must never cost the answer.
        if (firstTurn) {
          const generatedTitle = await generateConversationTitle(
            chunks.join(""),
            skillResolution.cleanedText,
            titleByokApiKey,
            gatewayTags,
            {
              userId: dbUser.id,
              projectId: usageProjectId,
              taskId: contextTaskId,
              agentId: actingAgent?.id ?? null,
            },
            providerAbort.signal,
          );
          if (generatedTitle) {
            send("title", { content: generatedTitle });
            if (body.session_id) {
              try {
                await prisma.chatSession.updateMany({
                  where: { id: body.session_id, userId: dbUser.id },
                  data: { title: generatedTitle },
                });
              } catch (error) {
                console.error(
                  "[ai/chat/stream] title persistence failed after reply persistence",
                  error,
                );
              }
            }
          }
        }

        finish("complete", {
          user_message_persisted: userMessagePersisted,
          assistant_persisted: assistantPersisted,
        });
      } catch (error) {
        if (cancelled) {
          if (!doneSent) {
            finish("error", { cancelled: true, content: "Stream cancelled." });
          }
          return;
        }
        console.error("[ai/chat/stream] stream error", error);
        await reportHandledChatError(error, "stream-handler");
        if (!errorSent) {
          errorSent = true;
          send("error", {
            content: userFacingErrorMessage(error, "stream-handler"),
            ...userFacingErrorDetails(error),
          });
          finish("error");
        }
        if (heartbeatExecutionId && !heartbeatExecutionTerminal) {
          await failHeartbeatExecution(
            heartbeatExecutionId,
            errorMessage(error)
          ).catch(() => undefined);
          heartbeatExecutionTerminal = true;
        }
      } finally {
        stopCancellationWatch();
        await releaseAiChatStreamLease(streamLease);
      }
    },
    cancel() {
      // Do not abort the model request. The server owns completion and
      // persistence so a mobile tab can be suspended or evicted safely.
      clientConnected = false;
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
