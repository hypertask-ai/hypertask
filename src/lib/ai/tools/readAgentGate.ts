import { requireAgentWriteRole } from "@/lib/mcp/agents/readRoleGuard";

export const NATIVE_READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "hypertask_list_agents",
  "hypertask_list_connections",
  "hypertask_get_user_context",
  "hypertask_agent_presence",
  "hypertask_list_projects",
  "hypertask_board_manifest",
  "hypertask_get_board_playbook",
  "hypertask_list_project_members",
  "hypertask_list_custom_fields",
  "hypertask_list_tasks",
  "hypertask_get_tasks",
  "hypertask_my_tasks",
  "hypertask_search_tasks",
  "hypertask_task_context",
  "hypertask_next_tasks",
  "hypertask_find_related_tasks",
  "hypertask_get_comments_for_task",
  "hypertask_inbox_list",
  "hypertask_get_page",
  "hypertask_list_pages",
  "hypertask_search_pages",
  "hypertask_list_labels",
  "hypertask_get_task_tree",
  "hypertask_list_views",
  "hypertask_get_view",
  "hypertask_list_skills",
  "hypertask_get_skill",
  "hypertask_list_reports",
  "hypertask_get_report",
  "hypertask_time_status",
  "hypertask_time_report",
  "hypertask_running_timers",
  "rag_retrieval",
  "web_search",
  "search_help_docs",
]);

export const NATIVE_READ_ACTIONS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["hypertask_agent_webhook", new Set(["get"])],
  ["hypertask_task_description_history", new Set(["versions"])],
  ["hypertask_board_config", new Set(["get_playbook", "get_instructions"])],
  ["hypertask_section", new Set(["list"])],
  ["hypertask_page_history", new Set(["versions"])],
  ["hypertask_draft", new Set(["list"])],
]);

export function isNativeReadOnlyCall(toolName: string, input: unknown): boolean {
  if (NATIVE_READ_ONLY_TOOLS.has(toolName)) return true;
  const readActions = NATIVE_READ_ACTIONS.get(toolName);
  if (!readActions) return false;
  const action = typeof input === "object" && input !== null ? (input as { action?: unknown }).action : undefined;
  return typeof action === "string" && readActions.has(action);
}

export async function refuseReadAgentToolCall(
  actor: { agentId: string; userId: number },
  toolName: string,
  input: unknown
): Promise<Record<string, unknown> | null> {
  if (isNativeReadOnlyCall(toolName, input)) return null;
  const refusal = await requireAgentWriteRole({ agentId: actor.agentId, user: { id: actor.userId } });
  return refusal ? ((await refusal.json()) as Record<string, unknown>) : null;
}
