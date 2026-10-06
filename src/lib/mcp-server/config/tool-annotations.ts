import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'

const readOnly: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
const additive: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
const destructive: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }

// Classify legacy operations once; mixed catalogs aggregate only permitted actions.
export const TOOL_ANNOTATIONS: Record<string, ToolAnnotations> = Object.fromEntries([
  ...'agent_presence board_manifest find_related_tasks get_board_playbook get_comments_for_task get_page get_skill get_task_tree get_tasks get_user_context get_view hello inbox_list list_agents list_connections list_custom_fields list_labels list_pages list_project_members list_projects list_skills list_tasks list_views next_tasks rag_retrieval search_help_docs search_pages search_tasks task_context search_tools describe_tool'.split(' ').map((name) => [`hypertask_${name}`, readOnly]),
  ...'attach_files create_agent create_board create_label create_page create_skill create_task create_view mint_token move_task_to_inbox'.split(' ').map((name) => [`hypertask_${name}`, additive]),
  ...'add_comment_to_task agent_webhook assign_user board_config decision_request delete_agent delete_comment delete_skill delete_view draft import_skills inbox_archive inbox_unarchive link_tasks move_task_between_boards page_history pause_timer project_admin rename_board report resume_timer revoke_agent revoke_token section set_custom_field_value switch_view task_description_history time update_comment update_page update_profile update_skill update_task update_view'.split(' ').map((name) => [`hypertask_${name}`, destructive]),
  ['hypertask_archive_agent', { ...destructive, idempotentHint: true }],
])
for (const name of ['import_skills', 'attach_files', 'create_task', 'update_task', 'add_comment_to_task', 'update_comment', 'agent_webhook']) {
  TOOL_ANNOTATIONS[`hypertask_${name}`] = { ...TOOL_ANNOTATIONS[`hypertask_${name}`], openWorldHint: true }
}

export function annotationsForActions(actions: readonly { tool: string; read_only: boolean }[]): ToolAnnotations {
  const hints = actions.map((action) => {
    const hints = TOOL_ANNOTATIONS[action.tool]
    if (!hints) throw new Error(`Missing annotations for ${action.tool}`)
    return action.read_only ? readOnly : {
      ...hints,
      readOnlyHint: false,
      destructiveHint: hints.readOnlyHint || hints.destructiveHint !== false,
    }
  })
  return {
    readOnlyHint: hints.every((hint) => hint.readOnlyHint),
    destructiveHint: hints.some((hint) => hint.destructiveHint),
    idempotentHint: hints.every((hint) => hint.idempotentHint),
    openWorldHint: hints.some((hint) => hint.openWorldHint),
  }
}
