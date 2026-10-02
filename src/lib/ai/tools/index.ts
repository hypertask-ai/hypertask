import type { ToolSet } from "ai";
import { type HeartbeatTurnMetadata } from "@/lib/nativeAgent/heartbeatTurnEnvelope";
import { AuthedUser, ToolExecutionRecorder, ToolStartRecorder } from "@/lib/ai/chatStream/types";
import { ChatRequest, SendSse } from "@/lib/ai/chatStream/request";
import { trackToolSetExecutions } from "@/lib/ai/tools/execution";

import { createListAgentsTool } from "./listAgents";
import { createAgentWebhookTool } from "./agentWebhook";
import { createCreateAgentTool } from "./createAgent";
import { createRevokeAgentTool } from "./revokeAgent";
import { createMintTokenTool } from "./mintToken";
import { createRevokeTokenTool } from "./revokeToken";
import { createListConnectionsTool } from "./listConnections";
import { createAskAgentTool } from "./askAgent";
import { createGetUserContextTool } from "./getUserContext";
import { createUpdateProfileTool } from "./updateProfile";
import { createAgentPresenceTool } from "./agentPresence";
import { createListProjectsTool } from "./listProjects";
import { createBoardManifestTool } from "./boardManifest";
import { createGetBoardPlaybookTool } from "./getBoardPlaybook";
import { createBoardConfigTool } from "./boardConfig";
import { createProjectAdminTool } from "./projectAdmin";
import { createCreateBoardTool } from "./createBoard";
import { createListProjectMembersTool } from "./listProjectMembers";
import { createListCustomFieldsTool } from "./listCustomFields";
import { createSetCustomFieldValueTool } from "./setCustomFieldValue";
import { createListTasksTool } from "./listTasks";
import { createGetTasksTool } from "./getTasks";
import { createMyTasksTool } from "./myTasks";
import { createSearchTasksTool } from "./searchTasks";
import { createTaskContextTool } from "./taskContext";
import { createTaskDescriptionHistoryTool } from "./taskDescriptionHistory";
import { createNextTasksTool } from "./nextTasks";
import { createLinkTasksTool } from "./linkTasks";
import { createFindRelatedTasksTool } from "./findRelatedTasks";
import { createGetCommentsForTaskTool } from "./getCommentsForTask";
import { createInboxListTool } from "./inboxList";
import { createMoveTaskToInboxTool } from "./moveTaskToInbox";
import { createSectionTool } from "./section";
import { createCreateTaskTool } from "./createTask";
import { createCreatePageTool } from "./createPage";
import { createGetPageTool } from "./getPage";
import { createUpdatePageTool } from "./updatePage";
import { createListPagesTool } from "./listPages";
import { createSearchPagesTool } from "./searchPages";
import { createPageHistoryTool } from "./pageHistory";
import { createListReportsTool } from "./listReports";
import { createGetReportTool } from "./getReport";
import { createCreateReportTool } from "./createReport";
import { createUpdateReportTool } from "./updateReport";
import { createDeleteReportTool } from "./deleteReport";
import { createListLabelsTool } from "./listLabels";
import { createCreateLabelTool } from "./createLabel";
import { createUpdateTaskTool } from "./updateTask";
import { createAddCommentTool } from "./addComment";
import { createDecisionRequestTool } from "./decisionRequest";
import { createAttachFilesTool } from "./attachFiles";
import { createUpdateCommentTool } from "./updateComment";
import { createDeleteCommentTool } from "./deleteComment";
import { createAssignUserTool } from "./assignUser";
import { createUnassignUserTool } from "./unassignUser";
import { createMoveTaskBetweenBoardsTool } from "./moveTaskBetweenBoards";
import { createInboxArchiveTool } from "./inboxArchive";
import { createInboxUnarchiveTool } from "./inboxUnarchive";
import { createDraftTool } from "./draft";
import { createGetTaskTreeTool } from "./getTaskTree";
import { createListViewsTool } from "./listViews";
import { createGetViewTool } from "./getView";
import { createCreateViewTool } from "./createView";
import { createUpdateViewTool } from "./updateView";
import { createSwitchViewTool } from "./switchView";
import { createDeleteViewTool } from "./deleteView";
import { createCreateSkillTool } from "./createSkill";
import { createGetSkillTool } from "./getSkill";
import { createListSkillsTool } from "./listSkills";
import { createUpdateSkillTool } from "./updateSkill";
import { createDeleteSkillTool } from "./deleteSkill";
import { createImportSkillsTool } from "./importSkills";
import { createStartTimerTool } from "./startTimer";
import { createStopTimerTool } from "./stopTimer";
import { createPauseTimerTool } from "./pauseTimer";
import { createResumeTimerTool } from "./resumeTimer";
import { createTimeStatusTool } from "./timeStatus";
import { createTimeReportTool } from "./timeReport";
import { createRunningTimersTool } from "./runningTimers";
import { createLogTimeTool } from "./logTime";
import { createRagRetrievalTool } from "./ragRetrieval";
import { createWebSearchTool } from "./webSearch";
import { createSearchHelpDocsTool } from "./searchHelpDocs";
import { createToolContext } from "./context";

export function buildTools(
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
  const context = createToolContext(user, body, send, recordToolExecution, actingAgentId, recordToolStart, heartbeatTurn);
  const tools: ToolSet = {
    hypertask_list_agents: createListAgentsTool(context).hypertask_list_agents,
    hypertask_agent_webhook: createAgentWebhookTool(context).hypertask_agent_webhook,
    hypertask_create_agent: createCreateAgentTool(context).hypertask_create_agent,
    hypertask_revoke_agent: createRevokeAgentTool(context).hypertask_revoke_agent,
    hypertask_mint_token: createMintTokenTool(context).hypertask_mint_token,
    hypertask_revoke_token: createRevokeTokenTool(context).hypertask_revoke_token,
    hypertask_list_connections: createListConnectionsTool(context).hypertask_list_connections,
    hypertask_ask_agent: createAskAgentTool(context).hypertask_ask_agent,
    hypertask_get_user_context: createGetUserContextTool(context).hypertask_get_user_context,
    hypertask_update_profile: createUpdateProfileTool(context).hypertask_update_profile,
    hypertask_agent_presence: createAgentPresenceTool(context).hypertask_agent_presence,
    hypertask_list_projects: createListProjectsTool(context).hypertask_list_projects,
    hypertask_board_manifest: createBoardManifestTool(context).hypertask_board_manifest,
    hypertask_get_board_playbook: createGetBoardPlaybookTool(context).hypertask_get_board_playbook,
    hypertask_board_config: createBoardConfigTool(context).hypertask_board_config,
    hypertask_project_admin: createProjectAdminTool(context).hypertask_project_admin,
    hypertask_create_board: createCreateBoardTool(context).hypertask_create_board,
    hypertask_list_project_members: createListProjectMembersTool(context).hypertask_list_project_members,
    hypertask_list_custom_fields: createListCustomFieldsTool(context).hypertask_list_custom_fields,
    hypertask_set_custom_field_value: createSetCustomFieldValueTool(context).hypertask_set_custom_field_value,
    hypertask_list_tasks: createListTasksTool(context).hypertask_list_tasks,
    hypertask_get_tasks: createGetTasksTool(context).hypertask_get_tasks,
    hypertask_my_tasks: createMyTasksTool(context).hypertask_my_tasks,
    hypertask_search_tasks: createSearchTasksTool(context).hypertask_search_tasks,
    hypertask_task_context: createTaskContextTool(context).hypertask_task_context,
    hypertask_task_description_history: createTaskDescriptionHistoryTool(context).hypertask_task_description_history,
    hypertask_next_tasks: createNextTasksTool(context).hypertask_next_tasks,
    hypertask_link_tasks: createLinkTasksTool(context).hypertask_link_tasks,
    hypertask_find_related_tasks: createFindRelatedTasksTool(context).hypertask_find_related_tasks,
    hypertask_get_comments_for_task: createGetCommentsForTaskTool(context).hypertask_get_comments_for_task,
    hypertask_inbox_list: createInboxListTool(context).hypertask_inbox_list,
    hypertask_move_task_to_inbox: createMoveTaskToInboxTool(context).hypertask_move_task_to_inbox,
    hypertask_section: createSectionTool(context).hypertask_section,
    hypertask_create_task: createCreateTaskTool(context).hypertask_create_task,
    hypertask_create_page: createCreatePageTool(context).hypertask_create_page,
    hypertask_get_page: createGetPageTool(context).hypertask_get_page,
    hypertask_update_page: createUpdatePageTool(context).hypertask_update_page,
    hypertask_list_pages: createListPagesTool(context).hypertask_list_pages,
    hypertask_search_pages: createSearchPagesTool(context).hypertask_search_pages,
    hypertask_page_history: createPageHistoryTool(context).hypertask_page_history,
    hypertask_list_reports: createListReportsTool(context).hypertask_list_reports,
    hypertask_get_report: createGetReportTool(context).hypertask_get_report,
    hypertask_create_report: createCreateReportTool(context).hypertask_create_report,
    hypertask_update_report: createUpdateReportTool(context).hypertask_update_report,
    hypertask_delete_report: createDeleteReportTool(context).hypertask_delete_report,
    hypertask_list_labels: createListLabelsTool(context).hypertask_list_labels,
    hypertask_create_label: createCreateLabelTool(context).hypertask_create_label,
    hypertask_update_task: createUpdateTaskTool(context).hypertask_update_task,
    hypertask_add_comment: createAddCommentTool(context).hypertask_add_comment,
    hypertask_decision_request: createDecisionRequestTool(context).hypertask_decision_request,
    hypertask_attach_files: createAttachFilesTool(context).hypertask_attach_files,
    hypertask_update_comment: createUpdateCommentTool(context).hypertask_update_comment,
    hypertask_delete_comment: createDeleteCommentTool(context).hypertask_delete_comment,
    hypertask_assign_user: createAssignUserTool(context).hypertask_assign_user,
    hypertask_unassign_user: createUnassignUserTool(context).hypertask_unassign_user,
    hypertask_move_task_between_boards: createMoveTaskBetweenBoardsTool(context).hypertask_move_task_between_boards,
    hypertask_inbox_archive: createInboxArchiveTool(context).hypertask_inbox_archive,
    hypertask_inbox_unarchive: createInboxUnarchiveTool(context).hypertask_inbox_unarchive,
    hypertask_draft: createDraftTool(context).hypertask_draft,
    hypertask_get_task_tree: createGetTaskTreeTool(context).hypertask_get_task_tree,
    hypertask_list_views: createListViewsTool(context).hypertask_list_views,
    hypertask_get_view: createGetViewTool(context).hypertask_get_view,
    hypertask_create_view: createCreateViewTool(context).hypertask_create_view,
    hypertask_update_view: createUpdateViewTool(context).hypertask_update_view,
    hypertask_switch_view: createSwitchViewTool(context).hypertask_switch_view,
    hypertask_delete_view: createDeleteViewTool(context).hypertask_delete_view,
    hypertask_create_skill: createCreateSkillTool(context).hypertask_create_skill,
    hypertask_get_skill: createGetSkillTool(context).hypertask_get_skill,
    hypertask_list_skills: createListSkillsTool(context).hypertask_list_skills,
    hypertask_update_skill: createUpdateSkillTool(context).hypertask_update_skill,
    hypertask_delete_skill: createDeleteSkillTool(context).hypertask_delete_skill,
    hypertask_import_skills: createImportSkillsTool(context).hypertask_import_skills,
    hypertask_start_timer: createStartTimerTool(context).hypertask_start_timer,
    hypertask_stop_timer: createStopTimerTool(context).hypertask_stop_timer,
    hypertask_pause_timer: createPauseTimerTool(context).hypertask_pause_timer,
    hypertask_resume_timer: createResumeTimerTool(context).hypertask_resume_timer,
    hypertask_time_status: createTimeStatusTool(context).hypertask_time_status,
    hypertask_time_report: createTimeReportTool(context).hypertask_time_report,
    hypertask_running_timers: createRunningTimersTool(context).hypertask_running_timers,
    hypertask_log_time: createLogTimeTool(context).hypertask_log_time,
    rag_retrieval: createRagRetrievalTool(context).rag_retrieval,
    web_search: createWebSearchTool(context).web_search,
    search_help_docs: createSearchHelpDocsTool(context).search_help_docs,
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
