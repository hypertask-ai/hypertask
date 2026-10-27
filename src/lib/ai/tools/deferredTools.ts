import { asSchema, tool, type PrepareStepFunction, type ToolSet } from "ai";
import { z } from "zod";
import { searchToolCatalog } from "@/lib/mcp-server/deferred-tools";

export const CORE_CHAT_TOOL_NAMES = [
  "hypertask_get_user_context",
  "hypertask_list_projects",
  "hypertask_board_manifest",
  "hypertask_get_board_playbook",
  "hypertask_list_project_members",
  "hypertask_list_labels",
  "hypertask_list_tasks",
  "hypertask_get_tasks",
  "hypertask_my_tasks",
  "hypertask_search_tasks",
  "hypertask_task_context",
  "hypertask_get_comments_for_task",
  "hypertask_inbox_list",
  "hypertask_create_task",
  "hypertask_update_task",
  "hypertask_add_comment",
  "hypertask_assign_user",
  "hypertask_unassign_user",
  "hypertask_inbox_archive",
  "hypertask_inbox_unarchive",
  "rag_retrieval",
  "web_search",
  "search_help_docs",
] as const;

export function deferredChatTools(tools: ToolSet): { tools: ToolSet; prepareStep: PrepareStepFunction<ToolSet> } {
  const catalog = Object.entries(tools).map(([name, definition]) => ({
    name,
    description: typeof definition.description === "function"
      ? definition.description({ context: undefined })
      : definition.description ?? "",
  }));
  const active = new Set<string>([
    ...CORE_CHAT_TOOL_NAMES.filter((name) => Object.hasOwn(tools, name)),
    "hypertask_search_tools",
    "hypertask_describe_tool",
  ]);
  return {
    tools: {
      ...tools,
      hypertask_search_tools: tool({
        description: "Find additional Hypertask tools by name or purpose, including views, pages, agents, timers and board settings. Call hypertask_describe_tool with a result's exact name to enable it before calling it.",
        inputSchema: z.object({
          query: z.string(),
          limit: z.number().int().min(1).max(50).optional(),
        }).strict(),
        execute: async ({ query, limit }) => ({
          tools: searchToolCatalog(catalog, query, limit),
        }),
      }),
      hypertask_describe_tool: tool({
        description: "Get a tool's full description and input schema, and enable that tool for this conversation turn. Use an exact name from hypertask_search_tools.",
        inputSchema: z.object({ name: z.string() }).strict(),
        execute: async ({ name }) => {
          const definition = Object.hasOwn(tools, name) ? tools[name] : undefined;
          if (!definition) return { error: `Unknown tool: ${name}` };
          const inputSchema = await asSchema(definition.inputSchema).jsonSchema;
          active.add(name);
          return { name, description: catalog.find((entry) => entry.name === name)?.description, inputSchema };
        },
      }),
    },
    prepareStep: () => ({ activeTools: [...active] }),
  };
}
