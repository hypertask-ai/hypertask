/**
 * Tool Registry
 * 
 * All MCP tools are exported from here.
 * To add a new tool:
 * 1. Create a new tool file (e.g., my-tool.tool.ts)
 * 2. Export the tool definition
 * 3. Import and add it to the tools array below
 */

import { helloTool } from './hello.tool';
import { agentPresenceTool } from './agent-presence.tool';
import { listAgentsTool } from './list-agents.tool';
import { agentWebhookTool } from './agent-webhook.tool';
import { createAgentTool } from './create-agent.tool';
import { revokeAgentTool } from './revoke-agent.tool';
import { archiveAgentTool } from './archive-agent.tool';
import { deleteAgentTool } from './delete-agent.tool';
import { mintTokenTool } from './mint-token.tool';
import { revokeTokenTool } from './revoke-token.tool';
import { listConnectionsTool } from './list-connections.tool';
import { getUserContextTool } from './get-user-context.tool';
import { updateProfileTool } from './update-profile.tool';
import { searchTasksTool } from './search-tasks.tool';
import { ragRetrievalTool } from './rag-retrieval.tool';
import { searchHelpDocsTool } from './search-help-docs.tool';
import { findRelatedTasksTool } from './find-related-tasks.tool';
import { addCommentTool } from './add-comment.tool';
import { listTasksTool } from './list-tasks.tool';
import { getTasksTool } from './get-tasks.tool';
import { taskContextTool } from './task-context.tool';
import { taskDescriptionHistoryTool } from './task-description-history.tool';
import { getTaskTreeTool } from './get-task-tree.tool';
import { nextTasksTool } from './next-tasks.tool';
import { linkTasksTool } from './link-tasks.tool';
import { listProjectsTool } from './list-projects.tool';
import { projectAdminTool } from './project-admin.tool';
import { boardManifestTool } from './board-manifest.tool';
import { getBoardPlaybookTool } from './get-board-playbook.tool';
import { boardConfigTool } from './board-config.tool';
import { listProjectMembersTool } from './list-project-members.tool';
import { createLabelTool } from './create-label.tool';
import { listLabelsTool } from './list-labels.tool';
import { listCustomFieldsTool } from './list-custom-fields.tool';
import { setCustomFieldValueTool } from './set-custom-field-value.tool';
import { inboxListTool } from './inbox-list.tool';
import { inboxArchiveTool } from './inbox-archive.tool';
import { inboxUnarchiveTool } from './inbox-unarchive.tool';
import { moveTaskToInboxTool } from './move-task-to-inbox.tool';
import { getCommentsTool } from './get-comments.tool';
import { updateCommentTool } from './update-comment.tool';
import { deleteCommentTool } from './delete-comment.tool';
import { sectionTool } from './section.tool';
import { updateTaskTool } from './update-task.tool';
import { createTaskTool } from './create-task.tool';
import { moveTaskBetweenBoardsTool } from './move-task-between-boards.tool';
import { assignUserTool } from './assign-user.tool';
import { attachFilesTool } from './attach-files.tool';
import { createBoardTool } from './create-board.tool';
import { decisionRequestTool } from './decision-request.tool';
import { draftTool } from './draft.tool';
import { listSkillsTool } from './list-skills.tool';
import { getSkillTool } from './get-skill.tool';
import { createSkillTool } from './create-skill.tool';
import { updateSkillTool } from './update-skill.tool';
import { deleteSkillTool } from './delete-skill.tool';
import { importSkillsTool } from './import-skills.tool';
import { timeTool } from './time.tool';
import { pauseTimerTool } from './pause-timer.tool';
import { resumeTimerTool } from './resume-timer.tool';
import { createPageTool } from './create-page.tool';
import { getPageTool } from './get-page.tool';
import { updatePageTool } from './update-page.tool';
import { listPagesTool } from './list-pages.tool';
import { searchPagesTool } from './search-pages.tool';
import { pageHistoryTool } from './page-history.tool';
import { reportTool } from './report.tool';
import { listViewsTool } from './list-views.tool';
import { getViewTool } from './get-view.tool';
import { createViewTool } from './create-view.tool';
import { updateViewTool } from './update-view.tool';
import { deleteViewTool } from './delete-view.tool';
import { switchViewTool } from './switch-view.tool';

/**
 * Array of all available MCP tools
 * FastMCP will register these automatically
 */
export const MCP_TOOLS = [
  helloTool,
  agentPresenceTool,
  listAgentsTool,
  agentWebhookTool,
  createAgentTool,
  revokeAgentTool,
  archiveAgentTool,
  deleteAgentTool,
  mintTokenTool,
  revokeTokenTool,
  listConnectionsTool,
  getUserContextTool,
  updateProfileTool,
  listTasksTool,
  getTasksTool,
  taskContextTool,
  taskDescriptionHistoryTool,
  getTaskTreeTool,
  nextTasksTool,
  linkTasksTool,
  searchTasksTool,
  ragRetrievalTool,
  searchHelpDocsTool,
  findRelatedTasksTool,
  listProjectsTool,
  projectAdminTool,
  boardManifestTool,
  getBoardPlaybookTool,
  boardConfigTool,
  createBoardTool,
  listProjectMembersTool,
  createLabelTool,
  listLabelsTool,
  listCustomFieldsTool,
  setCustomFieldValueTool,
  inboxListTool,
  inboxArchiveTool,
  inboxUnarchiveTool,
  moveTaskToInboxTool,
  sectionTool,
  getCommentsTool,
  addCommentTool,
  updateCommentTool,
  deleteCommentTool,
  createPageTool,
  getPageTool,
  updatePageTool,
  listPagesTool,
  searchPagesTool,
  pageHistoryTool,
  reportTool,
  listViewsTool,
  getViewTool,
  createViewTool,
  updateViewTool,
  deleteViewTool,
  switchViewTool,
  listSkillsTool,
  getSkillTool,
  createSkillTool,
  updateSkillTool,
  deleteSkillTool,
  importSkillsTool,
  attachFilesTool,
  updateTaskTool,
  createTaskTool,
  moveTaskBetweenBoardsTool,
  assignUserTool,
  decisionRequestTool,
  draftTool,
  timeTool,
  pauseTimerTool,
  resumeTimerTool,
];

Object.freeze(MCP_TOOLS);
