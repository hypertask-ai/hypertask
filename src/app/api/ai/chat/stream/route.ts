import { NextRequest } from "next/server";
import type { ToolSet } from "ai";
import { createChatToolContext, type ChatRequest, type SendSse } from "./buildTools";
import { trackToolSetExecutions, type AuthedUser, type ToolExecutionRecorder, type ToolStartRecorder } from "./toolSupport";
import type { HeartbeatTurnMetadata } from "@/lib/nativeAgent/heartbeatTurnEnvelope";
import { handlePost } from "./post";
import { createHypertaskListAgentsTool } from "@/lib/ai/tools/chat/hypertask_list_agents";
import { createHypertaskAgentWebhookTool } from "@/lib/ai/tools/chat/hypertask_agent_webhook";
import { createHypertaskCreateAgentTool } from "@/lib/ai/tools/chat/hypertask_create_agent";
import { createHypertaskRevokeAgentTool } from "@/lib/ai/tools/chat/hypertask_revoke_agent";
import { createHypertaskMintTokenTool } from "@/lib/ai/tools/chat/hypertask_mint_token";
import { createHypertaskRevokeTokenTool } from "@/lib/ai/tools/chat/hypertask_revoke_token";
import { createHypertaskListConnectionsTool } from "@/lib/ai/tools/chat/hypertask_list_connections";
import { createHypertaskAskAgentTool } from "@/lib/ai/tools/chat/hypertask_ask_agent";
import { createHypertaskGetUserContextTool } from "@/lib/ai/tools/chat/hypertask_get_user_context";
import { createHypertaskUpdateProfileTool } from "@/lib/ai/tools/chat/hypertask_update_profile";
import { createHypertaskAgentPresenceTool } from "@/lib/ai/tools/chat/hypertask_agent_presence";
import { createHypertaskListProjectsTool } from "@/lib/ai/tools/chat/hypertask_list_projects";
import { createHypertaskBoardManifestTool } from "@/lib/ai/tools/chat/hypertask_board_manifest";
import { createHypertaskGetBoardPlaybookTool } from "@/lib/ai/tools/chat/hypertask_get_board_playbook";
import { createHypertaskBoardConfigTool } from "@/lib/ai/tools/chat/hypertask_board_config";
import { createHypertaskProjectAdminTool } from "@/lib/ai/tools/chat/hypertask_project_admin";
import { createHypertaskCreateBoardTool } from "@/lib/ai/tools/chat/hypertask_create_board";
import { createHypertaskListProjectMembersTool } from "@/lib/ai/tools/chat/hypertask_list_project_members";
import { createHypertaskListCustomFieldsTool } from "@/lib/ai/tools/chat/hypertask_list_custom_fields";
import { createHypertaskSetCustomFieldValueTool } from "@/lib/ai/tools/chat/hypertask_set_custom_field_value";
import { createHypertaskListTasksTool } from "@/lib/ai/tools/chat/hypertask_list_tasks";
import { createHypertaskGetTasksTool } from "@/lib/ai/tools/chat/hypertask_get_tasks";
import { createHypertaskMyTasksTool } from "@/lib/ai/tools/chat/hypertask_my_tasks";
import { createHypertaskSearchTasksTool } from "@/lib/ai/tools/chat/hypertask_search_tasks";
import { createHypertaskTaskContextTool } from "@/lib/ai/tools/chat/hypertask_task_context";
import { createHypertaskTaskDescriptionHistoryTool } from "@/lib/ai/tools/chat/hypertask_task_description_history";
import { createHypertaskNextTasksTool } from "@/lib/ai/tools/chat/hypertask_next_tasks";
import { createHypertaskLinkTasksTool } from "@/lib/ai/tools/chat/hypertask_link_tasks";
import { createHypertaskFindRelatedTasksTool } from "@/lib/ai/tools/chat/hypertask_find_related_tasks";
import { createHypertaskGetCommentsForTaskTool } from "@/lib/ai/tools/chat/hypertask_get_comments_for_task";
import { createHypertaskInboxListTool } from "@/lib/ai/tools/chat/hypertask_inbox_list";
import { createHypertaskMoveTaskToInboxTool } from "@/lib/ai/tools/chat/hypertask_move_task_to_inbox";
import { createHypertaskSectionTool } from "@/lib/ai/tools/chat/hypertask_section";
import { createHypertaskCreateTaskTool } from "@/lib/ai/tools/chat/hypertask_create_task";
import { createHypertaskCreatePageTool } from "@/lib/ai/tools/chat/hypertask_create_page";
import { createHypertaskGetPageTool } from "@/lib/ai/tools/chat/hypertask_get_page";
import { createHypertaskUpdatePageTool } from "@/lib/ai/tools/chat/hypertask_update_page";
import { createHypertaskListPagesTool } from "@/lib/ai/tools/chat/hypertask_list_pages";
import { createHypertaskSearchPagesTool } from "@/lib/ai/tools/chat/hypertask_search_pages";
import { createHypertaskPageHistoryTool } from "@/lib/ai/tools/chat/hypertask_page_history";
import { createHypertaskListReportsTool } from "@/lib/ai/tools/chat/hypertask_list_reports";
import { createHypertaskGetReportTool } from "@/lib/ai/tools/chat/hypertask_get_report";
import { createHypertaskCreateReportTool } from "@/lib/ai/tools/chat/hypertask_create_report";
import { createHypertaskUpdateReportTool } from "@/lib/ai/tools/chat/hypertask_update_report";
import { createHypertaskDeleteReportTool } from "@/lib/ai/tools/chat/hypertask_delete_report";
import { createHypertaskListLabelsTool } from "@/lib/ai/tools/chat/hypertask_list_labels";
import { createHypertaskCreateLabelTool } from "@/lib/ai/tools/chat/hypertask_create_label";
import { createHypertaskUpdateTaskTool } from "@/lib/ai/tools/chat/hypertask_update_task";
import { createHypertaskAddCommentTool } from "@/lib/ai/tools/chat/hypertask_add_comment";
import { createHypertaskDecisionRequestTool } from "@/lib/ai/tools/chat/hypertask_decision_request";
import { createHypertaskAttachFilesTool } from "@/lib/ai/tools/chat/hypertask_attach_files";
import { createHypertaskUpdateCommentTool } from "@/lib/ai/tools/chat/hypertask_update_comment";
import { createHypertaskDeleteCommentTool } from "@/lib/ai/tools/chat/hypertask_delete_comment";
import { createHypertaskAssignUserTool } from "@/lib/ai/tools/chat/hypertask_assign_user";
import { createHypertaskUnassignUserTool } from "@/lib/ai/tools/chat/hypertask_unassign_user";
import { createHypertaskMoveTaskBetweenBoardsTool } from "@/lib/ai/tools/chat/hypertask_move_task_between_boards";
import { createHypertaskInboxArchiveTool } from "@/lib/ai/tools/chat/hypertask_inbox_archive";
import { createHypertaskInboxUnarchiveTool } from "@/lib/ai/tools/chat/hypertask_inbox_unarchive";
import { createHypertaskDraftTool } from "@/lib/ai/tools/chat/hypertask_draft";
import { createHypertaskGetTaskTreeTool } from "@/lib/ai/tools/chat/hypertask_get_task_tree";
import { createHypertaskListViewsTool } from "@/lib/ai/tools/chat/hypertask_list_views";
import { createHypertaskGetViewTool } from "@/lib/ai/tools/chat/hypertask_get_view";
import { createHypertaskCreateViewTool } from "@/lib/ai/tools/chat/hypertask_create_view";
import { createHypertaskUpdateViewTool } from "@/lib/ai/tools/chat/hypertask_update_view";
import { createHypertaskSwitchViewTool } from "@/lib/ai/tools/chat/hypertask_switch_view";
import { createHypertaskDeleteViewTool } from "@/lib/ai/tools/chat/hypertask_delete_view";
import { createHypertaskCreateSkillTool } from "@/lib/ai/tools/chat/hypertask_create_skill";
import { createHypertaskGetSkillTool } from "@/lib/ai/tools/chat/hypertask_get_skill";
import { createHypertaskListSkillsTool } from "@/lib/ai/tools/chat/hypertask_list_skills";
import { createHypertaskUpdateSkillTool } from "@/lib/ai/tools/chat/hypertask_update_skill";
import { createHypertaskDeleteSkillTool } from "@/lib/ai/tools/chat/hypertask_delete_skill";
import { createHypertaskImportSkillsTool } from "@/lib/ai/tools/chat/hypertask_import_skills";
import { createHypertaskStartTimerTool } from "@/lib/ai/tools/chat/hypertask_start_timer";
import { createHypertaskStopTimerTool } from "@/lib/ai/tools/chat/hypertask_stop_timer";
import { createHypertaskPauseTimerTool } from "@/lib/ai/tools/chat/hypertask_pause_timer";
import { createHypertaskResumeTimerTool } from "@/lib/ai/tools/chat/hypertask_resume_timer";
import { createHypertaskTimeStatusTool } from "@/lib/ai/tools/chat/hypertask_time_status";
import { createHypertaskTimeReportTool } from "@/lib/ai/tools/chat/hypertask_time_report";
import { createHypertaskRunningTimersTool } from "@/lib/ai/tools/chat/hypertask_running_timers";
import { createHypertaskLogTimeTool } from "@/lib/ai/tools/chat/hypertask_log_time";
import { createRagRetrievalTool } from "@/lib/ai/tools/chat/rag_retrieval";
import { createWebSearchTool } from "@/lib/ai/tools/chat/web_search";
import { createSearchHelpDocsTool } from "@/lib/ai/tools/chat/search_help_docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export function buildTools(
  user: AuthedUser,
  body: ChatRequest,
  send: SendSse,
  recordToolExecution: ToolExecutionRecorder,
  actingAgentId: string | null = null,
  recordToolStart?: ToolStartRecorder,
  heartbeatTurn?: HeartbeatTurnMetadata
): ToolSet {
  const context = createChatToolContext(user, body, send, recordToolExecution, actingAgentId, recordToolStart, heartbeatTurn);
  const tools: ToolSet = {
    hypertask_list_agents: createHypertaskListAgentsTool(context),

    hypertask_agent_webhook: createHypertaskAgentWebhookTool(context),

    hypertask_create_agent: createHypertaskCreateAgentTool(context),

    hypertask_revoke_agent: createHypertaskRevokeAgentTool(context),

    hypertask_mint_token: createHypertaskMintTokenTool(context),

    hypertask_revoke_token: createHypertaskRevokeTokenTool(context),

    hypertask_list_connections: createHypertaskListConnectionsTool(context),

    hypertask_ask_agent: createHypertaskAskAgentTool(context),

    hypertask_get_user_context: createHypertaskGetUserContextTool(context),

    hypertask_update_profile: createHypertaskUpdateProfileTool(context),

    hypertask_agent_presence: createHypertaskAgentPresenceTool(context),

    hypertask_list_projects: createHypertaskListProjectsTool(context),

    hypertask_board_manifest: createHypertaskBoardManifestTool(context),

    hypertask_get_board_playbook: createHypertaskGetBoardPlaybookTool(context),

    hypertask_board_config: createHypertaskBoardConfigTool(context),

    hypertask_project_admin: createHypertaskProjectAdminTool(context),

    hypertask_create_board: createHypertaskCreateBoardTool(context),

    hypertask_list_project_members: createHypertaskListProjectMembersTool(context),

    hypertask_list_custom_fields: createHypertaskListCustomFieldsTool(context),

    hypertask_set_custom_field_value: createHypertaskSetCustomFieldValueTool(context),

    hypertask_list_tasks: createHypertaskListTasksTool(context),

    hypertask_get_tasks: createHypertaskGetTasksTool(context),

    hypertask_my_tasks: createHypertaskMyTasksTool(context),

    hypertask_search_tasks: createHypertaskSearchTasksTool(context),

    hypertask_task_context: createHypertaskTaskContextTool(context),

    hypertask_task_description_history: createHypertaskTaskDescriptionHistoryTool(context),

    hypertask_next_tasks: createHypertaskNextTasksTool(context),

    hypertask_link_tasks: createHypertaskLinkTasksTool(context),

    hypertask_find_related_tasks: createHypertaskFindRelatedTasksTool(context),

    hypertask_get_comments_for_task: createHypertaskGetCommentsForTaskTool(context),

    hypertask_inbox_list: createHypertaskInboxListTool(context),

    hypertask_move_task_to_inbox: createHypertaskMoveTaskToInboxTool(context),

    hypertask_section: createHypertaskSectionTool(context),

    hypertask_create_task: createHypertaskCreateTaskTool(context),

    hypertask_create_page: createHypertaskCreatePageTool(context),

    hypertask_get_page: createHypertaskGetPageTool(context),

    hypertask_update_page: createHypertaskUpdatePageTool(context),

    hypertask_list_pages: createHypertaskListPagesTool(context),

    hypertask_search_pages: createHypertaskSearchPagesTool(context),

    hypertask_page_history: createHypertaskPageHistoryTool(context),

    hypertask_list_reports: createHypertaskListReportsTool(context),

    hypertask_get_report: createHypertaskGetReportTool(context),

    hypertask_create_report: createHypertaskCreateReportTool(context),

    hypertask_update_report: createHypertaskUpdateReportTool(context),

    hypertask_delete_report: createHypertaskDeleteReportTool(context),

    hypertask_list_labels: createHypertaskListLabelsTool(context),

    hypertask_create_label: createHypertaskCreateLabelTool(context),

    hypertask_update_task: createHypertaskUpdateTaskTool(context),

    hypertask_add_comment: createHypertaskAddCommentTool(context),

    hypertask_decision_request: createHypertaskDecisionRequestTool(context),

    hypertask_attach_files: createHypertaskAttachFilesTool(context),

    hypertask_update_comment: createHypertaskUpdateCommentTool(context),

    hypertask_delete_comment: createHypertaskDeleteCommentTool(context),

    hypertask_assign_user: createHypertaskAssignUserTool(context),

    hypertask_unassign_user: createHypertaskUnassignUserTool(context),

    hypertask_move_task_between_boards: createHypertaskMoveTaskBetweenBoardsTool(context),

    hypertask_inbox_archive: createHypertaskInboxArchiveTool(context),

    hypertask_inbox_unarchive: createHypertaskInboxUnarchiveTool(context),

    hypertask_draft: createHypertaskDraftTool(context),

    hypertask_get_task_tree: createHypertaskGetTaskTreeTool(context),

    hypertask_list_views: createHypertaskListViewsTool(context),

    hypertask_get_view: createHypertaskGetViewTool(context),

    hypertask_create_view: createHypertaskCreateViewTool(context),

    hypertask_update_view: createHypertaskUpdateViewTool(context),

    hypertask_switch_view: createHypertaskSwitchViewTool(context),

    hypertask_delete_view: createHypertaskDeleteViewTool(context),

    hypertask_create_skill: createHypertaskCreateSkillTool(context),

    hypertask_get_skill: createHypertaskGetSkillTool(context),

    hypertask_list_skills: createHypertaskListSkillsTool(context),

    hypertask_update_skill: createHypertaskUpdateSkillTool(context),

    hypertask_delete_skill: createHypertaskDeleteSkillTool(context),

    hypertask_import_skills: createHypertaskImportSkillsTool(context),

    hypertask_start_timer: createHypertaskStartTimerTool(context),

    hypertask_stop_timer: createHypertaskStopTimerTool(context),

    hypertask_pause_timer: createHypertaskPauseTimerTool(context),

    hypertask_resume_timer: createHypertaskResumeTimerTool(context),

    hypertask_time_status: createHypertaskTimeStatusTool(context),

    hypertask_time_report: createHypertaskTimeReportTool(context),

    hypertask_running_timers: createHypertaskRunningTimersTool(context),

    hypertask_log_time: createHypertaskLogTimeTool(context),

    rag_retrieval: createRagRetrievalTool(context),

    web_search: createWebSearchTool(context),

    search_help_docs: createSearchHelpDocsTool(context),
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

export async function POST(request: NextRequest) {
  return handlePost(request, buildTools);
}
