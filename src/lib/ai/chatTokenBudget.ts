export const MAX_CONTEXT_LIST_CHARS = 4_000;
export const MAX_DEFAULT_CONTEXT_CHARS = 2_000;
export const MAX_DOCUMENT_CONTEXT_CHARS = 2_000;
export const MAX_RAG_DOCUMENT_CHARS = 600;
export const MAX_HISTORY_SUMMARY_CHARS = 3_000;
export const MAX_RECENT_HISTORY_MESSAGES = 10;
export const MAX_HISTORY_MESSAGE_CHARS = 2_000;
export const CHAT_MAX_OUTPUT_TOKENS = 1_200;

const TRUNCATION_MARKER = "\n[truncated]";
const SUMMARY_TRUNCATION_MARKER = "[earlier turns truncated]\n";

export type ChatHistoryMessage = {
  content?: string;
  role?: string;
};

type ToolDefinition = {
  providerOptions?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
};

export function truncatePromptText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= TRUNCATION_MARKER.length) {
    return TRUNCATION_MARKER.slice(0, maxChars);
  }
  return value.slice(0, maxChars - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}

export function stringifyPromptValue(value: unknown, maxChars: number): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(value ?? {}, null, 2);
  } catch {
    serialized = String(value ?? "");
  }
  return truncatePromptText(serialized, maxChars);
}

function plainHistoryText(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function compactChatHistory(messages: ChatHistoryMessage[] | null | undefined): {
  recent: Array<{ content: string; role: string }>;
  summary: string;
} {
  const readable = (messages ?? []).flatMap((message) => {
    const content = plainHistoryText(message.content ?? "");
    if (!content) return [];
    return [{
      content: truncatePromptText(content, MAX_HISTORY_MESSAGE_CHARS),
      role: message.role?.toLowerCase() === "assistant" ? "assistant" : "human",
    }];
  });
  const recent = readable.slice(-MAX_RECENT_HISTORY_MESSAGES);
  const dropped = readable.slice(0, -MAX_RECENT_HISTORY_MESSAGES);
  const fullSummary = dropped
    .map((message) => {
      const label = message.role === "assistant" ? "Assistant" : "User";
      return `${label}: ${truncatePromptText(message.content, 240)}`;
    })
    .join("\n");

  if (fullSummary.length <= MAX_HISTORY_SUMMARY_CHARS) {
    return { recent, summary: fullSummary };
  }
  const available = MAX_HISTORY_SUMMARY_CHARS - SUMMARY_TRUNCATION_MARKER.length;
  return {
    recent,
    summary: SUMMARY_TRUNCATION_MARKER + fullSummary.slice(-available),
  };
}

const DEFAULT_TOOLS = [
  "hypertask_get_user_context",
  "hypertask_list_projects",
  "hypertask_list_tasks",
  "hypertask_get_tasks",
  "hypertask_my_tasks",
  "hypertask_search_tasks",
  "rag_retrieval",
  "web_search",
  "search_help_docs",
] as const;

const TOOL_GROUPS = {
  agent: [
    "hypertask_list_agents",
    "hypertask_agent_webhook",
    "hypertask_create_agent",
    "hypertask_revoke_agent",
    "hypertask_list_connections",
    "hypertask_mint_token",
    "hypertask_revoke_token",
    "hypertask_ask_agent",
    "hypertask_get_user_context",
    "hypertask_agent_presence",
  ],
  board: [
    "hypertask_list_projects",
    "hypertask_board_manifest",
    "hypertask_get_board_playbook",
    "hypertask_board_config",
    "hypertask_project_admin",
    "hypertask_create_board",
    "hypertask_list_project_members",
    "hypertask_section",
    "hypertask_list_custom_fields",
    "hypertask_set_custom_field_value",
  ],
  comment: [
    "hypertask_get_tasks",
    "hypertask_task_context",
    "hypertask_get_comments_for_task",
    "hypertask_add_comment",
    "hypertask_update_comment",
    "hypertask_delete_comment",
    "hypertask_draft",
    "hypertask_list_project_members",
    "rag_retrieval",
  ],
  taskContext: [
    "hypertask_get_tasks",
    "hypertask_task_context",
    "hypertask_task_description_history",
    "hypertask_get_task_tree",
    "hypertask_next_tasks",
    "hypertask_link_tasks",
    "hypertask_find_related_tasks",
    "hypertask_search_tasks",
    "rag_retrieval",
  ],
  inbox: [
    "hypertask_inbox_list",
    "hypertask_inbox_archive",
    "hypertask_inbox_unarchive",
    "hypertask_move_task_to_inbox",
    "hypertask_get_tasks",
    "hypertask_list_tasks",
  ],
  page: [
    "hypertask_create_page",
    "hypertask_get_page",
    "hypertask_update_page",
    "hypertask_list_pages",
    "hypertask_search_pages",
    "hypertask_page_history",
    "hypertask_get_tasks",
  ],
  report: [
    "hypertask_list_reports",
    "hypertask_get_report",
    "hypertask_create_report",
    "hypertask_update_report",
    "hypertask_delete_report",
  ],
  skill: [
    "hypertask_create_skill",
    "hypertask_get_skill",
    "hypertask_list_skills",
    "hypertask_update_skill",
    "hypertask_delete_skill",
    "hypertask_import_skills",
  ],
  time: [
    "hypertask_start_timer",
    "hypertask_stop_timer",
    "hypertask_pause_timer",
    "hypertask_resume_timer",
    "hypertask_time_status",
    "hypertask_time_report",
    "hypertask_running_timers",
    "hypertask_log_time",
  ],
  view: [
    "hypertask_list_views",
    "hypertask_get_view",
    "hypertask_create_view",
    "hypertask_update_view",
    "hypertask_switch_view",
    "hypertask_delete_view",
    "hypertask_list_projects",
  ],
} as const;

function taskToolNames(text: string, hasAttachments: boolean): string[] {
  const names = [
    "hypertask_list_tasks",
    "hypertask_get_tasks",
    "hypertask_my_tasks",
    "hypertask_search_tasks",
    "rag_retrieval",
  ];
  const add = (...values: string[]) => names.push(...values);

  if (/\b(create|add)\s+(?:a\s+)?(?:task|ticket|card)\b|\bnew\s+(?:task|ticket|card)\b/.test(text)) {
    add(
      "hypertask_create_task",
      "hypertask_section",
      "hypertask_list_labels",
      "hypertask_find_related_tasks",
    );
  }
  if (/\b(assign|unassign|owner|responsible)\b/.test(text)) {
    add(
      "hypertask_assign_user",
      "hypertask_unassign_user",
      "hypertask_list_project_members",
    );
  }
  if (/\b(labels?|tags?)\b/.test(text)) {
    add("hypertask_update_task", "hypertask_list_labels");
    if (/\b(create|new|add)\b/.test(text)) add("hypertask_create_label");
  }
  if (/\b(move|transfer)\b/.test(text)) {
    add(
      "hypertask_update_task",
      "hypertask_move_task_between_boards",
      "hypertask_section",
    );
  }
  if (/\b(update|edit|change|rename|archive|restore|priority|due date|estimate)\b/.test(text)) {
    add("hypertask_update_task");
  }
  if (/\b(decision|approval)\b/.test(text)) add("hypertask_decision_request");
  if (/\bdraft\b/.test(text)) add("hypertask_draft");
  if (hasAttachments || /\b(attach|upload|file)\b/.test(text)) {
    add("hypertask_attach_files");
  }

  return [...new Set(names)].slice(0, 10);
}

function selectRequestedToolNames(args: {
  message: string;
  recentHistory?: ChatHistoryMessage[];
  hasAgentMention?: boolean;
  hasAttachments?: boolean;
  hasTaskContext?: boolean;
}): string[] {
  const history = (args.recentHistory ?? [])
    .slice(-2)
    .map((message) => message.content ?? "")
    .join(" ");
  const text = `${history} ${args.message}`.toLowerCase();
  let names: readonly string[];

  if (/\b(report|dashboard)\b/.test(text)) names = TOOL_GROUPS.report;
  else if (/\b(page|document)\b/.test(text)) names = TOOL_GROUPS.page;
  else if (/\b(saved view|board view|view tab|switch view)\b/.test(text)) names = TOOL_GROUPS.view;
  else if (/\b(skill|\/skill)\b/.test(text)) names = TOOL_GROUPS.skill;
  else if (/\b(timer|time tracking|log time|timesheet)\b/.test(text)) names = TOOL_GROUPS.time;
  else if (/\b(inbox|notification)\b/.test(text)) names = TOOL_GROUPS.inbox;
  else if (/\b(comment|reply|mention)\b/.test(text)) names = TOOL_GROUPS.comment;
  else if (/\b(profile|display name|profile photo)\b/.test(text)) {
    names = ["hypertask_get_user_context", "hypertask_update_profile"];
  } else if (/\b(agent|webhook|mcp token|connection)\b/.test(text)) {
    names = TOOL_GROUPS.agent;
  } else if (/\b(task tree|subtasks?|parents?|related|duplicate|blocked? by|links? tasks?|next tasks?|task description history|description versions?)\b/.test(text)) {
    names = TOOL_GROUPS.taskContext;
  } else if (
    args.hasTaskContext ||
    /\b(tasks?|tickets?|cards?|assignees?|assign|unassign|priorities|due dates?|labels?|tags?|archive|restore)\b/.test(text)
  ) {
    names = taskToolNames(text, Boolean(args.hasAttachments));
  } else if (/\b(board|project|section|column|custom field)\b/.test(text)) {
    names = TOOL_GROUPS.board;
  } else names = DEFAULT_TOOLS;

  const selected = [...names];
  if (args.hasAgentMention) selected.unshift("hypertask_ask_agent");
  if (args.hasAttachments) selected.unshift("hypertask_attach_files");
  return [...new Set(selected)].slice(0, 10);
}

export function subsetToolsForTurn<T extends Record<string, ToolDefinition>>(
  tools: T,
  args: {
    message: string;
    recentHistory?: ChatHistoryMessage[];
    hasAgentMention?: boolean;
    hasAttachments?: boolean;
    hasTaskContext?: boolean;
  },
): Partial<T> {
  const names = selectRequestedToolNames(args);
  return Object.fromEntries(
    names.flatMap((name) => tools[name] ? [[name, tools[name]]] : []),
  ) as Partial<T>;
}

export function withAnthropicToolCacheBreakpoint<
  T extends Record<string, ToolDefinition>,
>(tools: T): T {
  const entries = Object.entries(tools);
  const last = entries.at(-1);
  if (!last) return tools;
  const [name, definition] = last;
  const providerOptions = definition.providerOptions ?? {};
  const anthropic = providerOptions.anthropic ?? {};

  return {
    ...tools,
    [name]: {
      ...definition,
      providerOptions: {
        ...providerOptions,
        anthropic: {
          ...anthropic,
          cacheControl: { type: "ephemeral" },
        },
      },
    },
  };
}
