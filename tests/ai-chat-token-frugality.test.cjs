const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  alias: { "@": path.join(root, "src") },
  cache: false,
  interopDefault: true,
});
const {
  CHAT_LONG_FORM_MAX_OUTPUT_TOKENS,
  CHAT_MAX_OUTPUT_TOKENS,
  MAX_CONTEXT_LIST_CHARS,
  MAX_RAG_DOCUMENT_CHARS,
  chatMaxOutputTokens,
  compactChatHistory,
  excerptAroundQuery,
  stringifyPromptValue,
  subsetToolsForTurn,
  truncatePromptText,
  withAnthropicToolCacheBreakpoint,
} = jiti(path.join(root, "src/lib/ai/chatTokenBudget.ts"));
const { mapTaskDescriptionText } = jiti(
  path.join(root, "src/lib/mcp/tasks/mappers.ts"),
);

const toolNames = [
  "hypertask_list_agents",
  "hypertask_agent_webhook",
  "hypertask_create_agent",
  "hypertask_revoke_agent",
  "hypertask_mint_token",
  "hypertask_revoke_token",
  "hypertask_list_connections",
  "hypertask_ask_agent",
  "hypertask_get_user_context",
  "hypertask_update_profile",
  "hypertask_agent_presence",
  "hypertask_list_projects",
  "hypertask_board_manifest",
  "hypertask_get_board_playbook",
  "hypertask_board_config",
  "hypertask_project_admin",
  "hypertask_create_board",
  "hypertask_list_project_members",
  "hypertask_list_custom_fields",
  "hypertask_set_custom_field_value",
  "hypertask_list_tasks",
  "hypertask_get_tasks",
  "hypertask_my_tasks",
  "hypertask_search_tasks",
  "hypertask_task_context",
  "hypertask_task_description_history",
  "hypertask_next_tasks",
  "hypertask_link_tasks",
  "hypertask_find_related_tasks",
  "hypertask_get_comments_for_task",
  "hypertask_inbox_list",
  "hypertask_move_task_to_inbox",
  "hypertask_section",
  "hypertask_create_task",
  "hypertask_create_page",
  "hypertask_get_page",
  "hypertask_update_page",
  "hypertask_list_pages",
  "hypertask_search_pages",
  "hypertask_page_history",
  "hypertask_list_reports",
  "hypertask_get_report",
  "hypertask_create_report",
  "hypertask_update_report",
  "hypertask_delete_report",
  "hypertask_list_labels",
  "hypertask_create_label",
  "hypertask_update_task",
  "hypertask_add_comment",
  "hypertask_decision_request",
  "hypertask_attach_files",
  "hypertask_update_comment",
  "hypertask_delete_comment",
  "hypertask_assign_user",
  "hypertask_unassign_user",
  "hypertask_move_task_between_boards",
  "hypertask_inbox_archive",
  "hypertask_inbox_unarchive",
  "hypertask_draft",
  "hypertask_get_task_tree",
  "hypertask_list_views",
  "hypertask_get_view",
  "hypertask_create_view",
  "hypertask_update_view",
  "hypertask_switch_view",
  "hypertask_delete_view",
  "hypertask_create_skill",
  "hypertask_get_skill",
  "hypertask_list_skills",
  "hypertask_update_skill",
  "hypertask_delete_skill",
  "hypertask_import_skills",
  "hypertask_start_timer",
  "hypertask_stop_timer",
  "hypertask_pause_timer",
  "hypertask_resume_timer",
  "hypertask_time_status",
  "hypertask_time_report",
  "hypertask_running_timers",
  "hypertask_log_time",
  "rag_retrieval",
  "web_search",
  "search_help_docs",
];

function fakeTools() {
  return Object.fromEntries(
    toolNames.map((name) => [name, { description: `${name} ${"x".repeat(700)}` }]),
  );
}

test("a normal chat turn sends at most ten relevant tool definitions", () => {
  const allTools = fakeTools();
  const selected = subsetToolsForTurn(allTools, {
    message: "What has been happening with the login ticket?",
  });

  assert.ok(Object.keys(selected).length >= 5);
  assert.ok(Object.keys(selected).length <= 10);
  assert.ok(selected.rag_retrieval);
  assert.ok(selected.hypertask_get_tasks);

  const boardList = subsetToolsForTurn(allTools, {
    message: "List the tasks on this board",
  });
  assert.ok(boardList.hypertask_list_tasks);

  const allChars = JSON.stringify(allTools).length;
  const selectedChars = JSON.stringify(selected).length;
  assert.ok(
    selectedChars <= allChars / 2,
    `expected at least a 50% tool-prefix cut, got ${selectedChars}/${allChars}`,
  );
});

test("write, confirmation, and mention turns retain the required tools", () => {
  const allTools = fakeTools();
  const taskWrite = subsetToolsForTurn(allTools, {
    message: "Assign HTPR-6507 to Dev 1 and add the frugal label",
  });
  assert.ok(taskWrite.hypertask_assign_user);
  assert.ok(taskWrite.hypertask_update_task);
  assert.ok(taskWrite.hypertask_list_project_members);
  assert.ok(Object.keys(taskWrite).length <= 10);

  const multiIntent = subsetToolsForTurn(allTools, {
    message: "Create a task and add a comment to it",
  });
  assert.ok(multiIntent.hypertask_create_task);
  assert.ok(multiIntent.hypertask_add_comment);
  assert.ok(Object.keys(multiIntent).length <= 10);

  const confirmation = subsetToolsForTurn(allTools, {
    message: "Yes, do it",
    recentHistory: [
      { role: "assistant", content: "Confirm that I should delete the report." },
    ],
  });
  assert.ok(confirmation.hypertask_delete_report);

  const mention = subsetToolsForTurn(allTools, {
    message: "Ask the release agent for status",
    hasAgentMention: true,
  });
  assert.ok(mention.hypertask_ask_agent);

  const taskContext = subsetToolsForTurn(allTools, {
    message: "Archive this",
    hasTaskContext: true,
  });
  assert.ok(taskContext.hypertask_update_task);

  const related = subsetToolsForTurn(allTools, {
    message: "Show the related tasks and task tree",
  });
  assert.ok(related.hypertask_find_related_tasks);
  assert.ok(related.hypertask_get_task_tree);

  const profile = subsetToolsForTurn(allTools, {
    message: "Change my profile photo",
  });
  assert.ok(profile.hypertask_update_profile);
});

test("the final selected tool carries one Anthropic cache breakpoint", () => {
  const selected = subsetToolsForTurn(fakeTools(), { message: "List my tasks" });
  const cached = withAnthropicToolCacheBreakpoint(selected);
  const entries = Object.entries(cached);
  const marked = entries.filter(
    ([, definition]) =>
      definition.providerOptions?.anthropic?.cacheControl?.type === "ephemeral",
  );

  assert.equal(marked.length, 1);
  assert.equal(marked[0][0], entries.at(-1)[0]);
});

test("history sends recent turns plus a capped rolling summary", () => {
  const messages = Array.from({ length: 30 }, (_, index) => ({
    role: index % 2 ? "assistant" : "human",
    content: `<p>turn ${index} ${"detail ".repeat(80)}</p>`,
  }));
  const compacted = compactChatHistory(messages);

  assert.equal(compacted.recent.length, 10);
  assert.match(compacted.summary, /turn 19/);
  assert.doesNotMatch(compacted.summary, /<p>/);
  assert.ok(compacted.summary.length <= 3000);
});

test("context and RAG values are capped with an explicit marker", () => {
  const context = stringifyPromptValue({ text: "x".repeat(20_000) }, MAX_CONTEXT_LIST_CHARS);
  const rag = truncatePromptText("y".repeat(20_000), MAX_RAG_DOCUMENT_CHARS);

  assert.ok(context.length <= MAX_CONTEXT_LIST_CHARS);
  assert.ok(rag.length <= MAX_RAG_DOCUMENT_CHARS);
  assert.match(context, /\[truncated\]$/);
  assert.match(rag, /\[truncated\]$/);
});

test("long-form requests retain enough output budget", () => {
  assert.equal(chatMaxOutputTokens("List my open tasks"), CHAT_MAX_OUTPUT_TOKENS);
  assert.equal(
    chatMaxOutputTokens("Write a comprehensive project report"),
    CHAT_LONG_FORM_MAX_OUTPUT_TOKENS,
  );
  assert.equal(
    chatMaxOutputTokens("Give me a full report"),
    CHAT_LONG_FORM_MAX_OUTPUT_TOKENS,
  );
});

test("RAG excerpts retain a match near the end of long content", () => {
  const excerpt = excerptAroundQuery(
    `${"prefix ".repeat(200)}matched passage ${"suffix ".repeat(200)}`,
    "matched passage",
    MAX_RAG_DOCUMENT_CHARS,
  );
  assert.ok(excerpt.length <= MAX_RAG_DOCUMENT_CHARS);
  assert.match(excerpt, /matched passage/);
});

test("chat route wires caching, selected tools, capped context, and cache usage", () => {
  const route = fs.readFileSync(
    path.join(root, "src/app/api/ai/chat/stream/route.ts"),
    "utf8",
  );
  assert.match(route, /anthropic:\s*\{\s*cacheControl:\s*\{\s*type:\s*["']ephemeral["']/s);
  assert.match(route, /subsetToolsForTurn\(/);
  assert.match(route, /withAnthropicToolCacheBreakpoint\(/);
  assert.match(route, /cacheReadInputTokens:\s*usage\.inputTokenDetails\.cacheReadTokens/);
  assert.match(route, /stringifyPromptValue\(body\.context_list/);
  assert.match(route, /chat_history_summary/);
});

test("public MCP list and search payloads preserve descriptions", () => {
  const listRoute = fs.readFileSync(
    path.join(root, "src/app/api/mcp/tasks/route.ts"),
    "utf8",
  );
  const listMapper = listRoute.slice(
    listRoute.indexOf("const taskList: TaskListItem[]"),
    listRoute.indexOf("const presentedTasks"),
  );
  assert.match(listMapper, /description:\s*mapTaskDescriptionContent\(task\)/);

  const searchRoute = fs.readFileSync(
    path.join(root, "src/app/api/mcp/tasks/search/route.ts"),
    "utf8",
  );
  const searchMapper = searchRoute.slice(
    searchRoute.indexOf("const taskList: TaskSearchItem[]"),
    searchRoute.indexOf("const response: SearchTasksResponse"),
  );
  assert.match(searchMapper, /description:\s*task\.description/);
});

test("task context selects descriptions for linked PR extraction", () => {
  const route = fs.readFileSync(
    path.join(root, "src/app/api/ai/chat/stream/route.ts"),
    "utf8",
  );
  assert.match(
    route,
    /\.\.\.taskMcpGetInclude\(user\.id\),\s*description_:\s*true,/s,
  );
  assert.match(route, /extractPrLinks\(\s*mapTaskDescriptionContent\(task\)/s);
});

test("HTML text conversion does not double-decode entities", () => {
  assert.equal(
    compactChatHistory([
      { role: "human", content: "&amp;lt;script&amp;gt;" },
    ]).recent[0].content,
    "&lt;script&gt;",
  );
  assert.equal(
    mapTaskDescriptionText({
      description_: {
        content: "<p>Hello <strong>world</strong> &amp; team &amp;lt;tag&amp;gt;</p>",
      },
    }),
    "Hello world & team &lt;tag&gt;",
  );
  assert.equal(
    mapTaskDescriptionText({
      description:
        '<p><a href="https://example.test/pr/7">PR #7</a>' +
        '<img src="https://example.test/screenshot.png">' +
        '<img src="data:image/png;base64,AAAA"></p>',
    }),
    "PR #7 (https://example.test/pr/7) [image: https://example.test/screenshot.png]",
  );
});

test("RAG document content is capped at the production mapping boundary", () => {
  const ragSource = fs.readFileSync(
    path.join(root, "src/lib/rag/retrieveBoardKnowledge.ts"),
    "utf8",
  );
  assert.match(ragSource, /truncatePromptText\([\s\S]*?MAX_RAG_DOCUMENT_CHARS/);
});
