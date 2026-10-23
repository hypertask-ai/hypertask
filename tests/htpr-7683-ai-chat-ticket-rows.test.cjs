const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const React = require("react");
const { createJiti } = require("jiti");
const root = path.resolve(__dirname, "..");
const flag = "htpr-7683-ai-chat-ticket-rows";
const flagModule = { HTPR_7683_AI_CHAT_TICKET_ROWS_FLAG: flag };
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true });
const { persistAssistantMessage } = jiti(path.join(root, "src/app/api/ai/chat/stream/persistAssistantMessage.ts"));
const { findNativeAssistantReplay } = jiti(path.join(root, "src/app/api/ai/chat/stream/ensureNativeChatTurn.ts"));

function load(file, mocks) {
  const loadedModule = { exports: {} };
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const compiled = ts.transpileModule(source, { fileName: file, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  new Function("require", "module", "exports", compiled)((name) => {
    if (Object.hasOwn(mocks, name)) return { __esModule: true, ...mocks[name] };
    if (!name.startsWith(".") && !name.startsWith("@/")) return require(name);
    throw new Error(`Unmocked dependency: ${name}`);
  }, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

function hydration({ visible = [2, 1], agent = null } = {}) {
  const queries = [], principals = [], preparations = [];
  const access = { permitted: "boards" };
  const agentVisibility = { permitted: "agents" };
  const api = load("src/lib/ai/chatStream/ticketGroups.ts", {
    "@/lib/prisma": { default: { task: { findMany: async (query) => {
      queries.push(query);
      return visible.filter((id) => query.where.id.in.includes(id)).map((id) => ({
        id, title: `Ticket ${id}`, ticketNumber: `HTPR-${id}`, uniqueIndex: id, projectId: 15,
        section: "Done", priority: { id: "p", priority_index: 1, Priority_Value: "High" },
        assignees: [{ id, user: { displayName: "Reader", photoURL: "/avatar.png" }, agent: null }],
      }));
    } } } },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: (...args) => { principals.push(args); return access; } },
    "@/lib/agents/visibility": { boardAgentVisibilityWhere: (id) => { assert.equal(id, 985); return agentVisibility; } },
    "@/lib/auth/agentScope": { withAgentScopeRequest: (_, run) => run(), prepareAgentScope: async (...args) => { preparations.push(args); } },
    "@/lib/ai/tools/helpers": { loadActingAgent: async () => agent },
  });
  return { ...api, queries, principals, preparations, access, agentVisibility };
}

function display(executions = []) {
  const h = hydration();
  const { createShowTicketRowsTool, TICKET_ROWS_PROMPT } = load("src/lib/ai/tools/showTicketRows.ts", {
    "ai": { tool: (options) => options }, "@/lib/ai/chatStream/ticketGroups": h,
  });
  let selected;
  const tool = createShowTicketRowsTool(executions, (groups) => { selected = groups; });
  return { tool, prompt: TICKET_ROWS_PROMPT, selected: () => selected, createShowTicketRowsTool };
}

const refs = { version: 1, groups: [{ label: "Done", taskIds: [1, 2, 9] }, { label: "New", taskIds: [3] }] };

test("flag is a client-safe Everyone feature with release risk", () => {
  const definition = jiti(path.join(root, `src/lib/flags/definitions/${flag}.ts`)).default;
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, "feature");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.ok(definition.releaseRisk.reason);
});

test("display rejects invented IDs, failed and unrelated results, and previous-turn IDs", async () => {
  for (const executions of [[], [{ name: "hypertask_get_tasks", result: { success: false, tasks: [{ id: 1 }] } }], [{ name: "hypertask_create_task", result: { success: true, tasks: [{ id: 1 }] } }]]) {
    const d = display(executions);
    assert.equal((await d.tool.execute({ groups: [{ taskIds: [1] }] })).success, false);
    assert.equal(d.selected(), undefined);
  }
  const first = display([{ name: "hypertask_search_tasks", result: { success: true, tasks: [{ task_id: 1 }] } }]);
  assert.equal((await first.tool.execute({ groups: [{ taskIds: [1] }] })).success, true);
  assert.equal((await display().tool.execute({ groups: [{ taskIds: [1] }] })).success, false);
  assert.equal((await first.tool.execute({ groups: [{ taskIds: [1, 999] }] })).success, false);
  assert.deepEqual(first.selected(), { version: 1, groups: [{ taskIds: [1] }] });
});

test("successful search/list/get IDs deduplicate globally while preserving groups and order", async () => {
  const d = display(["search", "list", "get"].map((name, index) => ({ name: `hypertask_${name}_tasks`, result: { success: true, tasks: [{ task_id: index + 1 }] } })));
  assert.equal((await d.tool.execute({ groups: [{ label: "Done", taskIds: [2, 1, 2] }, { label: "New", taskIds: [3, 1] }] })).displayed, 3);
  assert.deepEqual(d.selected(), { version: 1, groups: [{ label: "Done", taskIds: [2, 1] }, { label: "New", taskIds: [3] }] });
});

test("my tasks board groups and next tasks feed the display, an empty summary does not", async () => {
  const d = display([
    { name: "hypertask_my_tasks", result: { success: true, total: 2, boards: [{ project_id: 15, tasks: [{ task_id: 11 }] }, { project_id: 16, tasks: [{ task_id: 12 }] }] } },
    { name: "hypertask_next_tasks", result: { success: true, tasks: [{ id: 13 }] } },
  ]);
  assert.equal((await d.tool.execute({ groups: [{ taskIds: [11, 12, 13] }] })).displayed, 3);
  const summaryOnly = display([{ name: "hypertask_my_tasks", result: { success: true, total: 2, boards: [{ project_id: 15 }] } }]);
  assert.equal((await summaryOnly.tool.execute({ groups: [{ taskIds: [11] }] })).success, false);
});

test("schema and execution enforce four groups, fifty IDs total, short labels and positive IDs", async () => {
  const d = display([{ name: "hypertask_list_tasks", result: { success: true, tasks: Array.from({ length: 50 }, (_, i) => ({ id: i + 1 })) } }]);
  const allowed = { groups: [{ taskIds: Array.from({ length: 50 }, (_, i) => i + 1) }] };
  assert.equal(d.tool.inputSchema.safeParse(allowed).success, true);
  assert.equal((await d.tool.execute(allowed)).success, true);
  for (const input of [
    { groups: Array.from({ length: 5 }, () => ({ taskIds: [1] })) },
    { groups: [{ taskIds: allowed.groups[0].taskIds }, { taskIds: [1] }] },
    { groups: [{ label: "a".repeat(41), taskIds: [1] }] },
    { groups: [{ taskIds: [0] }] }, { groups: [] },
  ]) {
    assert.equal(d.tool.inputSchema.safeParse(input).success, false);
    assert.equal((await d.tool.execute(input)).success, false);
  }
});

test("hydration hides inaccessible/deleted tasks and still displays accessible tasks in requested order", async () => {
  const h = hydration({ visible: [2, 1, 3] });
  const groups = await h.hydrateTicketGroups(refs.groups, 985);
  assert.deepEqual(groups.map((g) => [g.label, g.tasks.map((t) => t.id)]), [["Done", [1, 2]], ["New", [3]]]);
  assert.equal(groups[0].tasks[0].url, "/detail/project-15/1");
  assert.equal(groups[0].tasks[0].assignees[0].user.photoURL, "/avatar.png");
  assert.equal(groups[0].tasks[0].priority.Priority_Value, "High");
  assert.deepEqual(h.queries[0].where.project, { is: h.access });
  assert.deepEqual(h.queries[0].where.status, { not: "Deleted" });
  assert.deepEqual(h.queries[0].select.assignees.where.OR, [{ agentId: null }, { agent: h.agentVisibility }]);
  assert.deepEqual(h.principals[0], [985, undefined, undefined]);
});

test("agent hydration prepares and intersects current agent/team visibility, including reload", async () => {
  const agent = { id: "agent", teamScope: { teamId: "team", accessBinding: "binding" } };
  const h = hydration({ agent });
  const session = await h.hydrateChatTicketMessages({ id: "session", messages: [{ ticketGroups: refs }] }, 985, true);
  assert.equal(session.messages[0].ticketGroups[0].tasks.length, 2);
  assert.deepEqual(h.preparations, [[985, "agent"]]);
  assert.deepEqual(h.principals, [[985, "agent", agent.teamScope]]);
});

test("persistence stores references atomically, duplicate equality includes groups, replay and reload rehydrate", async () => {
  let stored;
  const db = {
    chatSession: { findFirst: async () => ({ id: "s", agentId: null }), update: async () => ({}) },
    chatMessage: {
      createMany: async ({ data }) => { if (stored) return { count: 0 }; stored = data[0]; return { count: 1 }; },
      findFirst: async () => stored,
      findUnique: async () => ({ ...stored, session: { userId: 985 } }),
    },
  };
  const args = { db, messageId: "m", sessionId: "s", userId: 985, content: "Here are the tickets.", ticketGroups: refs, linkify: async (v) => v };
  assert.equal(await persistAssistantMessage(args), true);
  assert.deepEqual(stored.ticketGroups, refs);
  assert.equal(await persistAssistantMessage(args), true);
  assert.equal(await persistAssistantMessage({ ...args, ticketGroups: { version: 1, groups: [...refs.groups].reverse() } }), false);
  const replay = await findNativeAssistantReplay({ db, sessionId: "s", messageId: "m", userId: 985 });
  assert.equal(replay.status, "completed");
  assert.deepEqual(replay.ticketGroups, refs);
  const h = hydration({ visible: [2] });
  const reloaded = await h.hydrateChatTicketMessages({ id: "s", messages: [stored] }, 985, true);
  assert.deepEqual(reloaded.messages[0].ticketGroups.map((g) => [g.label, g.tasks.map((t) => t.id)]), [["Done", [2]]]);
  assert.equal(stored.ticketGroups.groups[0].taskIds.length, 3);
  const off = await h.hydrateChatTicketMessages({ id: "s", messages: [stored] }, 985, false);
  assert.equal(Object.hasOwn(off.messages[0], "ticketGroups"), false);
  assert.equal(h.queries.length, 1);
});

function modelTurn(enabled, { persisted = true, failed = false } = {}) {
  const events = [], captured = [];
  const h = hydration();
  const d = display([{ name: "hypertask_get_tasks", result: { success: true, tasks: [{ id: 1 }] } }]);
  const { runModelTurn } = load("src/lib/ai/chatStream/modelTurn.ts", {
    "@/lib/flags/definitions/htpr-7683-ai-chat-ticket-rows": flagModule,
    "./ticketGroups": { hydrateTicketGroups: async (...args) => { events.push("hydrate"); return h.hydrateTicketGroups(...args); } },
    "@/lib/ai/tools/showTicketRows": { TICKET_ROWS_PROMPT: d.prompt },
    "@/lib/ai/prompts/registry": { renderPrompt: () => "inline prompt" },
    "@/lib/flags/keys": { HTPR_7514_INLINE_AGENT_IMAGES_FLAG: "inline", HTPR_7363_CHAT_TASK_WRITER_FLAG: "writer" },
    "@/lib/prisma": { default: {} },
    "@/lib/flags": { isFeatureEnabled: async (key) => key === flag && enabled },
    "@/app/api/ai/_lib/currentTaskContext": { loadCurrentTaskContext: async () => [] },
    "@/app/api/ai/chat/stream/streamLease": {},
    "@/app/api/ai/_lib/heartbeatExecution": {},
    "@/app/api/ai/chat/stream/persistAssistantMessage": { persistAssistantMessage: async (args) => { events.push(["persist", args]); return persisted; } },
    "@/utils/controllers/comments/linkifyTicketRefs": { linkifyTicketRefs: async (v) => v },
    "@/lib/ai/chatStream/prompt": { AGENT_SYSTEM_PROMPT: "original prompt" },
    "@/lib/ai/chatStream/content": { createUserContent: () => "question" },
    "@/lib/ai/tools/metadata": { writeToolNames: new Set() },
    "@/lib/ai/chatStream/title": {},
    "@/lib/ai/tools": { buildTools: (...args) => {
      const options = args[11];
      return options ? { hypertask_show_ticket_rows: d.createShowTicketRowsTool([{ name: "hypertask_get_tasks", result: { success: true, tasks: [{ id: 1 }] } }], options.setGroups) } : {};
    } },
    "./modelReply": { generateModelReply: async (_, inputs) => {
      captured.push(inputs);
      if (inputs.tools.hypertask_show_ticket_rows) await inputs.tools.hypertask_show_ticket_rows.execute({ groups: [{ label: "Done", taskIds: [1] }] });
      return { chunks: ["Here are the tickets."], ticketRowsAllowed: !failed };
    } },
    "./chatNames": { nameChatFromFirstMessage: async () => null },
  });
  return { events, captured, run: () => runModelTurn({
    body: { session_id: "s", assistant_message_id: "m" }, dbUser: { id: 985 }, userMessagePersisted: true,
    gatewayTags: {}, streamLease: {}, providerAbort: new AbortController(), generationFinishedWithError: failed,
    finish: (status, payload) => { events.push(["done", status, payload]); }, send() {},
  }, {}, {}) };
}

test("flag Off keeps the original prompt, tool set, persistence and done payload", async () => {
  const h = modelTurn(false);
  await h.run();
  assert.equal(h.captured[0].instructions, "original prompt");
  assert.equal(Object.hasOwn(h.captured[0].tools, "hypertask_show_ticket_rows"), false);
  assert.equal(Object.hasOwn(h.events[0][1], "ticketGroups"), false);
  assert.deepEqual(h.events.at(-1), ["done", "complete", { user_message_persisted: true, assistant_persisted: true }]);
});

test("flag On changes prompt and delivers hydrated rows only after successful persistence", async () => {
  const h = modelTurn(true);
  await h.run();
  assert.match(h.captured[0].instructions, /one short sentence.*hypertask_show_ticket_rows/);
  assert.deepEqual(h.events.map((event) => Array.isArray(event) ? event[0] : event), ["persist", "hydrate", "done"]);
  assert.deepEqual(h.events[0][1].ticketGroups, { version: 1, groups: [{ label: "Done", taskIds: [1] }] });
  assert.equal(h.events.at(-1)[2].ticketGroups[0].tasks[0].id, 1);
  for (const options of [{ persisted: false }, { failed: true }]) {
    const failure = modelTurn(true, options);
    await failure.run();
    assert.equal(Object.hasOwn(failure.events.at(-1)[2], "ticketGroups"), false);
    assert.equal(failure.events.includes("hydrate"), false);
  }
});

function descendants(element) {
  if (!React.isValidElement(element)) return [];
  return [element, ...React.Children.toArray(element.props.children).flatMap(descendants)];
}

function rowUi(groups) {
  let expanded = new Set();
  const Ticket = () => null, Title = () => null, Status = () => null, Priority = () => null, Heading = () => null;
  const navigations = [];
  const { default: Rows } = load("src/components/AI_CHAT/AiChatTicketRows.tsx", {
    react: { ...React, useState: () => [expanded, (next) => { expanded = next(expanded); }] },
    "@/components/PageComponents/Kanban/TableView/TableTaskRow": { TableTicketCell: Ticket, TableTitleCell: Title, TableStatusCell: Status },
    "@/components/PageComponents/Kanban/TableView/tableViewShared": { renderAssigneeAvatars: (task) => React.createElement("img", { alt: task.title }), LABEL_CLASS: "existing-label" },
    "@/components/Modals/TaskPriority/PriorityLabelComponent": { default: Priority },
    "@/components/Common/TaskRowComponents/TaskListRow": { SplitTitle: Heading },
  });
  return { render: () => descendants(Rows({ groups, onNavigate: (url) => navigations.push(url) })), navigations, Ticket, Title, Status, Priority, Heading };
}

test("five-row boundary and +N more expand only that group and reuse table cells/headings", () => {
  for (const count of [0, 1, 5, 6, 50]) {
    const tasks = Array.from({ length: count }, (_, i) => ({ id: i + 1, title: `Task ${i}`, ticketNumber: `HTPR-${i}`, section: "Done", url: `/detail/project-15/${i}`, priority: { priority_index: 1 } }));
    const ui = rowUi([{ label: "Done", tasks }, { label: "New", tasks: tasks.slice(0, 1) }]);
    const tree = ui.render();
    assert.equal(tree.filter((e) => e.type === "a").length, Math.min(count, 5) + Math.min(count, 1));
    assert.equal(tree.filter((e) => e.type === ui.Title).length, Math.min(count, 5) + Math.min(count, 1));
    assert.equal(tree.find((e) => e.type === ui.Heading).props.tab.project, "Done");
    const button = tree.find((e) => e.type === "button");
    assert.equal(Boolean(button), count > 5);
    if (button) {
      assert.equal(button.props.children.join(""), `+${count - 5} more`);
      button.props.onClick();
      assert.equal(ui.render().filter((e) => e.type === "a").length, count + 1);
    }
    if (count) {
      const link = tree.find((e) => e.type === "a");
      let prevented = 0;
      link.props.onClick({ button: 0, preventDefault: () => { prevented++; }, stopPropagation() {} });
      assert.deepEqual(ui.navigations, [tasks[0].url]);
      assert.equal(prevented, 1);
      link.props.onClick({ button: 0, ctrlKey: true, stopPropagation() {}, preventDefault: () => { prevented++; } });
      assert.equal(prevented, 1);
      assert.match(link.props.className, /78px_minmax\(0,1fr\)_auto/);
    }
  }
});

test("actual tool registration includes display only when enabled and allows read-role agents", () => {
  const source = fs.readFileSync(path.join(root, "src/lib/ai/tools/index.ts"), "utf8");
  const mocks = {};
  const ast = ts.createSourceFile("index.ts", source, ts.ScriptTarget.Latest, true);
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier.text;
    const symbols = statement.importClause?.namedBindings?.elements ?? [];
    if (!specifier.startsWith(".")) continue;
    mocks[specifier] = Object.fromEntries(symbols.map((symbol) => [symbol.name.text, () => new Proxy({}, { get: () => ({}) })]));
  }
  mocks["./showTicketRows"] = { createShowTicketRowsTool: display().createShowTicketRowsTool };
  mocks["@/lib/ai/tools/execution"] = { trackToolSetExecutions: (tools) => tools };
  const { buildTools } = load("src/lib/ai/tools/index.ts", mocks);
  const off = buildTools({ id: 985 }, {}, () => {}, () => {});
  assert.equal(Object.hasOwn(off, "hypertask_show_ticket_rows"), false);
  const on = buildTools({ id: 985 }, {}, () => {}, () => {}, null, undefined, undefined, false, undefined, false, null, { executions: [], setGroups() {} });
  assert.equal(typeof on.hypertask_show_ticket_rows.execute, "function");
  assert.deepEqual(Object.keys(on).filter((name) => name !== "hypertask_show_ticket_rows"), Object.keys(off));
  const { isNativeReadOnlyCall } = load("src/lib/ai/tools/readAgentGate.ts", { "@/lib/mcp/agents/readRoleGuard": {} });
  assert.equal(isNativeReadOnlyCall("hypertask_show_ticket_rows", {}), true);
  assert.equal(isNativeReadOnlyCall("hypertask_create_task", {}), false);
});

test("legacy, paged and sidebar history routes hydrate rows, and flag Off strips stored references without hydration", async () => {
  for (const mode of ["legacy", "paged", "sidebar", "off"]) {
    const h = hydration();
    const session = { id: "11111111-1111-4111-8111-111111111111", messages: [{ id: "m", content: "Tickets.", role: "assistant", ticketGroups: refs }] };
    const { GET } = load("src/app/api/ai-chat/all-sessions/route.ts", {
      "@/lib/flags/definitions/htpr-7683-ai-chat-ticket-rows": flagModule,
      "@/lib/ai/chatStream/ticketGroups": h,
      "@/lib/agents/chatAccess": { sidebarChatProjectId: () => mode === "sidebar" ? 15 : undefined, loadSidebarChatRequest: async () => ({ ok: true }) },
      "@/lib/redis": {},
      "@/lib/flags": { HTPR_6924_REST_COMPAT_FLAG: "compat", isFeatureEnabled: async (key) => key === flag ? mode !== "off" : mode === "paged" },
      "@/lib/api/rateLimit": { checkRestRateLimit: async () => null },
      "@/lib/prisma": { default: { chatSession: { findFirst: async () => session, findMany: async () => [session] } } },
      "@/lib/auth/currentUser": { loadCurrentUser: async () => ({ userId: 985, user: { id: 985 } }) },
      "@/lib/api/response": {},
      "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    });
    const response = await GET(new Request(`https://app.hypertask.ai/api/ai-chat/all-sessions?sessionId=${session.id}${mode === "paged" ? "&compat=htpr-6924" : ""}`));
    assert.equal(response.status, 200);
    const body = await response.json();
    const message = (body.session ?? body.sessions[0]).messages[0];
    assert.equal(message.content, "Tickets.");
    if (mode === "off") {
      assert.equal(Object.hasOwn(message, "ticketGroups"), false);
      assert.equal(h.queries.length, 0);
    } else {
      assert.deepEqual(message.ticketGroups[0].tasks.map((task) => task.id), [1, 2]);
      assert.equal(h.queries.length, 1);
    }
  }
});

test("history batches references once per session and preserves separate message group order", async () => {
  const h = hydration({ visible: [3, 2, 1] });
  const input = { id: "s", messages: [
    { content: "First", ticketGroups: { version: 1, groups: [{ label: "Done", taskIds: [2, 1] }] } },
    { content: "Second", ticketGroups: { version: 1, groups: [{ label: "New", taskIds: [3, 2] }] } },
    { content: "Legacy" },
  ] };
  const session = await h.hydrateChatTicketMessages(input, 985, true);
  assert.deepEqual(session.messages.slice(0, 2).map((message) => message.ticketGroups[0].tasks.map((task) => task.id)), [[2, 1], [3, 2]]);
  assert.equal(h.queries.length, 1);
  assert.deepEqual(session.messages[2], { content: "Legacy" });
});

test("client caches ticket rows from durable done only, not failed or unpersisted completion", async () => {
  const { consumeAiChatStream } = load("src/hooks/MultiPages/AIChat/aiChatStream.ts", {
    "@/lib/realtime/taskCommentsRefresh": {}, "@/lib/realtime/shared": {},
    "@/hooks/Inbox/useGetNotifications": { INBOX_QUERY_KEY: ["inbox"] },
    "./aiChatShared": { parseAiStreamErrorContent: (v) => v },
  });
  for (const [persisted, status] of [[false, "complete"], [true, "complete"], [true, "error"]]) {
    const rows = [{ label: "Done", tasks: [{ id: 1 }] }];
    const payload = `event: content\ndata: ${JSON.stringify({ content: "Tickets." })}\n\nevent: done\ndata: ${JSON.stringify({ status, assistant_persisted: persisted, ticketGroups: rows })}\n\n`;
    const messages = [];
    const original = console.log;
    console.log = () => {};
    try {
      await consumeAiChatStream({
        response: new Response(payload), session: { id: "s" }, assistantMessageId: "m",
        addMessageToSessionQuery: (_, message) => messages.push(message), setAgentStatus() {}, setIsTyping() {},
        queryClient: { refetchQueries: async () => {} },
      });
    } finally { console.log = original; }
    assert.equal(messages.length, 2);
    assert.equal(messages.at(-1).content, status === "error" ? "Sorry, an error occurred while processing your request." : "Tickets.");
    assert.deepEqual(messages.at(-1).ticketGroups, persisted && status === "complete" ? rows : undefined);
    assert.equal(messages[0].ticketGroups, undefined);
  }
});

test("replay route sends reauthorized rows in done without starting inference; Off replays text only", async () => {
  for (const enabled of [true, false]) {
    const h = hydration({ visible: [2] });
    const { POST } = load("src/app/api/ai/chat/stream/route.ts", {
      "@/lib/flags/definitions/htpr-7683-ai-chat-ticket-rows": flagModule,
      "@/lib/ai/chatStream/ticketGroups": h,
      "@/lib/agents/chatAccess": { loadSidebarChatRequest: async () => ({ ok: true }) },
      "@/lib/ai/chatStream/turnModel": { loadTurnModel: () => { throw new Error("Replay must not start inference"); } },
      "@/lib/ai/chatStream/stream": {}, "next/server": {},
      "@/app/api/ai/_lib/requestUser": { getAiRequestUser: async () => ({ id: 985 }) },
      "@/app/api/ai/_lib/cronServiceAuth": {}, "@/lib/nativeAgent/heartbeatTurnEnvelope": {},
      "@/lib/prisma": { default: { user: { findUnique: async () => ({ id: 985 }) } } },
      "@/lib/flags": { isFeatureEnabled: async (key) => key === flag && enabled }, "@/lib/flags/keys": {},
      "@/app/api/ai/chat/stream/ensureNativeChatTurn": { findNativeAssistantReplay: async () => ({ status: "completed", content: "Saved answer", ticketGroups: refs }) },
      "@/app/api/ai/_lib/currentTaskContext": { resolveAiUsageTaskId: async () => null },
      "@/app/api/ai/chat/stream/streamLease": {}, "@/app/api/ai/_lib/heartbeatExecution": {},
      "@/lib/ai/chatStream/errors": { sseFrame: (name, value) => `event: ${name}\ndata: ${JSON.stringify(value)}\n\n` },
      "@/lib/ai/chatStream/request": { chatRequestSchema: { parse: (value) => value } },
      "@/lib/ai/tools/constants": { SSE_HEADERS: { "Content-Type": "text/event-stream" } },
    });
    const response = await POST(new Request("https://app.hypertask.ai/api/ai/chat/stream", { method: "POST", body: JSON.stringify({ message: "Retry", session_id: "s", assistant_message_id: "m" }) }));
    const events = (await response.text()).trim().split("\n\n").map((frame) => JSON.parse(frame.split("data: ")[1]));
    assert.equal(events[0].content, "Saved answer");
    assert.equal(events[1].replayed, true);
    assert.deepEqual(events[1].ticketGroups?.[0].tasks.map((task) => task.id), enabled ? [2] : undefined);
    assert.equal(h.queries.length, enabled ? 1 : 0);
  }
});

test("the next turn's history names the shown rows in order, and plain answers stay unchanged", () => {
  const { historyContent } = jiti(path.join(root, "src/lib/ai/ticketRowsHistory.ts"));
  const message = {
    content: "<p>Here are two overdue bugs.</p>",
    ticketGroups: [{ label: "Done", tasks: [{ id: 7, ticketNumber: "HTPR-1", uniqueIndex: 1, title: "First" }] }, { tasks: [{ id: 8, uniqueIndex: 2, title: "Second" }] }],
  };
  assert.equal(historyContent(message), "<p>Here are two overdue bugs.</p>\n\nTicket rows shown, in order:\n- [Done] HTPR-1 (task_id 7): First\n- #2 (task_id 8): Second");
  assert.equal(historyContent({ content: "<p>Hi</p>" }), "<p>Hi</p>");
  assert.equal(historyContent({ content: "<p>Hi</p>", ticketGroups: [] }), "<p>Hi</p>");
});
