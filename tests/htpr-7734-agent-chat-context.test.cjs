const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");
const root = path.resolve(__dirname, "..");
const flag = "htpr-7734-agent-chat-context";
const noop = () => {};
const hooks = { useCallback: (fn) => fn, useRef: (current) => ({ current }) };

function ui({ enabled = true, mobile = false, external = true, embedded = true, ticketScopeEnabled = true, scope: initialScope = null } = {}) {
  let scope = initialScope;
  const atoms = { currentProjectAtom: "board", currentUserAtom: "user", inViewObjectAtom: "ticket", recentChatBoardIdsAtom: "recent" };
  const source = loader({
    "next/navigation": { usePathname: () => "/detail/project-15/42" },
    "@/hooks/useFlag": { useFlag: (key) => key === flag ? enabled : key === "htpr-7316-chat-scope-ticket" && ticketScopeEnabled },
    "@/lib/ai/chipEvents": { signalAiChip: () => {} },
    "@/store": atoms,
    "@/lib/state": {
      useRecoilValue: (key) => key === "board" ? { id: 15, title: "Current board name" } : key === "user" ? { id: 7 } : { taskId: 42, taskTicketNumber: "HTPR-42", taskTitle: "Ticket title" },
      useRecoilState: (key) => key === "recent" ? [[], noop] : [null, noop],
    },
    "@/hooks/MultiPages/AIChat/useDockedChatScope": { useDockedChatScope: () => [scope, (next) => { scope = next; }] },
    "@/hooks/MultiPages/useGetAllTeamsMinimal": { useGetAllTeamsMinimal: () => ({ data: [{ id: 1, title: "Pinned boards", projects: [{ id: 22, title: "Pinned board" }] }] }) },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(mobile) },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context": { useAiChatContext: () => ({ queuedMessages: [], contextList: [], editor: null, fileItems: [] }) },
    "@/lib/configs/aiTaskWriter.config": { aiTaskWriterConfig: { shortcutsAndTooltips: { ai_chat: { attachment_button: () => ({}), send_button: {}, cancel_stream_button: {}, add_context_button: {} } } } },
    "@tiptap/react": { EditorContent: () => null, useEditorState: () => true },
    "@/lib/controlledComposerEditor": { ControlledComposerEditor: () => null },
    "../Common/Tooltip": { default: () => null },
    "@/components/Modals/OptionPicker": { default: ({ options, onSelect }) => React.createElement("div", { role: "dialog" }, options.map((option) => React.createElement("button", { key: option.id ?? "current", "aria-checked": option.checked, onClick: () => onSelect(option) }, option.label))) },
    "../Global/ModelSelectorDropdown": { default: () => null },
    "../RTE/Components/AudioButton": { default: () => null },
    "../Common/AttachmentsUpload/ImageGalleryView": { default: () => null },
    "./AttachmentButton": { AttachmentButton: () => null },
    "./SendMessageButton": { SendMessageButton: () => null },
    "@/components/Common/QueuedMessagesStrip": { QueuedMessagesStrip: () => null },
    "@/lib/configs/general.config": { MOBILE_TARGET: "" },
    "@/utils/undoActions/helperFuncs": { cn: (...values) => values.filter(Boolean).join(" ") },
    "@/components/Agents/AgentAvatar": { default: () => null },
    "@/components/AI_CHAT/TypingIndicator": { TypingIndicator: () => null },
    "@/components/RTE/Components/AudioButton": { AudioButton: () => null },
    "./AgentChatFeedItems": { chatStatusText: () => "Idle", emptyFeedText: () => "No messages" },
  });
  const { AI_Tiptap_Container } = source("src/components/AI_CHAT/AI_Tiptap_Container.tsx");
  const { AgentChatPane } = source("src/app/agents/chat/AgentChatPane.tsx");
  const view = mount();
  const render = () => view.render(React.createElement(external ? AgentChatPane : AI_Tiptap_Container, external ? {
    embedded, active: true, reuseAiComposer: true, isExternal: true,
    selectedAgent: { id: "agent", displayName: "Agent" }, messages: [], visibleFeed: [], queuedMessages: [],
    draft: "Which ticket?", setIsRecording: noop, setIsDictationProcessing: noop, handleSend: noop,
  } : {}));
  const click = (node) => { assert.ok(node); React.act(() => node.click()); render(); };
  render();
  return { ...view, render, scope: () => scope,
    trigger: () => view.container.querySelector("[data-ai-chat-scope] button"),
    rows: () => [...view.container.querySelectorAll('[role="dialog"] button')], click,
  };
}

for (const mobile of [false, true]) for (const enabled of [false, true]) {
  test(`external ${mobile ? "mobile" : "desktop"} composer reuses the existing dropdown only with flag ${enabled}`, () => {
    const h = ui({ mobile, enabled });
    try {
      if (!enabled) { assert.equal(h.trigger(), null); return; }
      h.click(h.trigger());
      assert.deepEqual(h.rows().map((row) => row.textContent), ["Current ticket", "Current board", "All boards", "Pinned board"]);
      h.click(h.rows()[0]);
      assert.equal(h.scope(), "ticket");
      assert.match(h.trigger().textContent, /HTPR-42/);
      assert.equal(h.trigger().title, "Ticket title");
      assert.equal(h.container.querySelectorAll("[data-ai-chat-scope]").length, 1);
    } finally { h.close(); }
  });
}

test("native composer keeps the same picker and standalone external chat gets no new picker", () => {
  for (const enabled of [false, true]) for (const external of [false, true]) {
    const h = ui({ enabled, external, embedded: false });
    try { assert.equal(!!h.trigger(), !external); } finally { h.close(); }
  }
});

function externalSender({ enabled = true, embedded = true, scope = "ticket", ticketScopeEnabled = true, taskId = 42, taskProjectId = 15, pathname = "/detail/project-15/42" } = {}) {
  const props = {
    embedded: embedded ? { projectId: 15 } : undefined,
    session: { id: "session" }, sessionIdRef: { current: "session" }, selectedIdRef: { current: "agent" },
    sendingRef: { current: false }, blockedQueueIdRef: { current: null }, messageQueueRef: { current: [] }, awaitingRef: { current: false },
    composerEditorRef: { current: null }, composerRef: { current: null }, draft: "Which ticket?", roster: [],
    setDeliveryNotice: noop, setAwaiting: noop, setReplyTimedOut: noop, setAwaitingSince: noop,
    setMessages: noop, setSending: noop, setAgents: noop, setQueuedMessages: noop, setDraft: noop,
    dismissMention: noop, focusComposer: noop,
  };
  const { useAgentChatSend } = load("src/app/agents/chat/useAgentChatSend.ts", {
    react: hooks, "react-hot-toast": { default: { error: assert.fail } },
    "@/hooks/useFlag": { useFlag: (key) => key === flag ? enabled : key === "htpr-7316-chat-scope-ticket" && ticketScopeEnabled },
    "@/lib/ai/chipEvents": { signalAiChip: () => {} },
    "@/hooks/MultiPages/AIChat/useDockedChatScope": { useDockedChatScope: () => [scope, noop] },
    "@/lib/state": { useRecoilValue: (key) => key === "board" ? { id: 15 } : { taskId, taskProjectId } },
    "@/store": { currentProjectAtom: "board", inViewObjectAtom: "ticket" },
    "next/navigation": { usePathname: () => pathname },
  });
  return { props, render: () => useAgentChatSend(props), visit(next) { scope = next.scope; taskId = next.taskId; pathname = next.pathname; }, disable() { enabled = false; } };
}

for (const [scope, project, ticket] of [["ticket", 15, 42], [null, 15, undefined], [22, 22, undefined], ["all", undefined, undefined]]) {
  test(`external ${scope} scope reaches the message and flag off still allows the original send`, async () => {
    const originalFetch = global.fetch;
    const requests = [];
    global.fetch = async (url, options) => { requests.push({ url, ...options, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ success: true, message: { id: "sent", content: "Which ticket?" } }) }; };
    try {
      for (const enabled of [true, false]) for (const embedded of [true, false]) {
        const h = externalSender({ enabled, embedded, scope });
        await h.render().handleSend();
        const request = requests.at(-1);
        assert.equal(request.url, "/api/agent-chat/session/messages");
        assert.equal(request.headers["x-hypertask-sidebar-project"], embedded ? "15" : undefined);
        if (!enabled || !embedded) { assert.deepEqual(request.body, { text: "Which ticket?" }); continue; }
        assert.equal(request.body.default_context.project_id, project);
        assert.equal(request.body.default_context.task_id, ticket);
        assert.equal(request.body.default_context.scope, ticket ? "ticket" : undefined);
        assert.equal(request.body.default_context.surface_path, "/detail/project-15/42");
      }
    } finally { global.fetch = originalFetch; }
  });
}

for (const ticketScopeEnabled of [false, true]) {
  for (const scope of [null, "ticket", 22, "all"]) {
    test(`external dropdown label matches sent context with ticket picker ${ticketScopeEnabled} and scope ${scope}`, async () => {
      const h = ui({ ticketScopeEnabled, scope });
      const originalFetch = global.fetch;
      let payload;
      global.fetch = async (_url, options) => { payload = JSON.parse(options.body); return { ok: true, json: async () => ({ success: true, message: { id: "sent" } }) }; };
      try {
        const ticket = scope === "ticket" || (scope === null && !ticketScopeEnabled);
        assert.equal(h.trigger().textContent, ticket ? "HTPR-42" : scope === 22 ? "Pinned board" : scope === "all" ? "All boards" : "Current board name");
        await externalSender({ ticketScopeEnabled, scope }).render().handleSend();
        assert.deepEqual(payload.default_context, ticket
          ? { project_id: 15, task_id: 42, scope: "ticket", surface_path: "/detail/project-15/42" }
          : scope === "all" ? { surface_path: "/detail/project-15/42" }
            : { project_id: scope === 22 ? 22 : 15, surface_path: "/detail/project-15/42" });
      } finally { global.fetch = originalFetch; h.close(); }
    });
  }
}

test("current ticket uses its own board and drops a stale ticket after leaving the detail page", async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (_url, options) => { requests.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ success: true, message: { id: "sent" } }) }; };
  try {
    await externalSender({ taskProjectId: 22 }).render().handleSend();
    assert.deepEqual(requests.at(-1).default_context, { project_id: 22, task_id: 42, scope: "ticket", surface_path: "/detail/project-15/42" });
    await externalSender({ pathname: "/project", taskId: null }).render().handleSend();
    assert.deepEqual(requests.at(-1).default_context, { project_id: 15, surface_path: "/project" });
  } finally { global.fetch = originalFetch; }
});

test("queued messages keep their picked ticket after navigation and flag off strips queued context", async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (_url, options) => { requests.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ success: true, message: { id: "sent" } }) }; };
  try {
    for (const disable of [false, true]) {
      const h = externalSender();
      h.props.composerLocked = true;
      await h.render().handleSend();
      assert.equal(h.props.messageQueueRef.current[0].context.task_id, 42);
      h.visit({ scope: 22, taskId: 43, pathname: "/detail/project-22/43" });
      if (disable) h.disable();
      h.render().drainQueuedMessageRef.current();
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(requests.at(-1).default_context, disable ? undefined : { project_id: 15, task_id: 42, scope: "ticket", surface_path: "/detail/project-15/42" });
    }
  } finally { global.fetch = originalFetch; }
});

function server({ enabled = true, readable = true, agentReadable: initialAgentReadable = true, validBinding = true, sidebar = true, webhook = false } = {}) {
  let agentReadable = initialAgentReadable;
  const rows = [], webhooks = [], queries = [], accessChecks = [];
  const session = { id: "11111111-1111-4111-8111-111111111111", userId: 7, agentId: "agent", user: { displayName: "Sender" }, createdAt: new Date(), updatedAt: new Date() };
  const access = { OR: [{ ownerId: 7 }, { members: { some: { userId: 7 } } }] };
  const recipientAccess = { members: { some: { agentId: "agent", status: "Accepted", agent: { userId: 9, revokedAt: null } } }, teamId: "agent-team" };
  const contextAccess = { AND: [access, recipientAccess] };
  const canRead = (where) => {
    if (where.AND) return where.AND.every(canRead);
    return where.OR ? readable : where.members ? agentReadable : true;
  };
  const prisma = {
    user: { findUnique: async () => ({ displayName: "Sender" }) },
    task: {
      findFirst: async (query) => { queries.push(query); return (!query.where.project || canRead(query.where.project)) && query.where.id === 42 && query.where.projectId === 15 ? { id: 42, projectId: 15, ticketNumber: "HTPR-42", title: "Ticket title" } : null; },
      findMany: async ({ where }) => where.id.in.includes(42) && canRead(where.project) ? [{ id: 42, projectId: 15 }] : [],
    },
    project: { findMany: async ({ where }) => where.id ? canRead(where) ? where.id.in.map((id) => ({ id })) : [] : [{ id: 15 }], findFirst: async (query) => { queries.push(query); return canRead(query.where) ? { id: query.where.id, title: "Board title" } : null; } },
    chatSession: { update: async () => ({}), findMany: async () => [], findFirst: async () => session },
    chatSessionParticipant: { updateMany: async () => ({ count: 1 }) },
    chatMessage: { create: async ({ data }) => { const row = { id: "message", createdAt: new Date(), attachments: [], ...data }; rows.push(row); return row; }, update: async () => ({}), findMany: async () => [...rows].reverse(), count: async () => rows.length },
    agentWebhookSubscription: { findUnique: async () => null },
    $transaction: async (fn) => fn(prisma),
    $queryRaw: async (strings) => strings.join("").includes("WITH pending AS") ? rows.map((row) => ({ id: row.id, sessionId: row.sessionId, text: row.content, context: row.context, userName: "Sender" })) : [{ id: "agent", userId: 7, heartbeatAt: new Date() }],
  };
  const mocks = {
    "@/lib/prisma": { default: prisma },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 7 }) },
    "@/lib/auth/agentTeamScope": { resolveAgentTeamScope: async (userId, agent) => {
      assert.equal(userId, 9);
      assert.equal(agent.credentialTeamId, "agent-team");
      assert.equal(agent.credentialTeamAccessBinding, "binding");
      if (!validBinding) throw new Error("Agent credential team grant is no longer valid");
      return { teamId: "agent-team", accessBinding: "binding" };
    } },
    "@/lib/agents/chatAccess": {
      sidebarChatProjectId: (headers) => headers.has("x-hypertask-sidebar-project") ? 15 : undefined,
      ensureChatParticipant: async () => null,
      loadUserAgentChatSession: async () => ({ ok: true, agentId: "agent", session: { ...session, agent: { runtimeType: "EXTERNAL", userId: 9, credentialTeamId: "agent-team", credentialTeamAccessBinding: "binding" } } }),
      loadAgentTokenChatSession: async () => ({ ok: true, session }),
    },
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => { assert.equal(userId, 7); return key === flag && enabled; } },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => access, projectContentAccessWhere: (userId, agentId, teamScope) => {
      accessChecks.push({ userId, agentId, teamScope });
      if (!agentId) { assert.equal(userId, 7); return access; }
      assert.equal(agentId, "agent");
      if (userId === 9) assert.deepEqual(teamScope, { teamId: "agent-team", accessBinding: "binding" });
      else assert.equal(userId, 7);
      return recipientAccess;
    } },
    "@/lib/agents/chatBrief": {}, "@/lib/agents/chatBroadcast": { broadcastChatSession: async () => {} },
    "@/lib/agentWebhooks/outbox": { persistAgentRunTriggerWebhooks: async (_tx, data) => { webhooks.push(data); return webhook ? ["delivery"] : []; }, publishAgentWebhookDeliveries: async () => {} },
    "@/lib/mcp/routeWrapper": { wrapMcpRoute: (fn) => fn, checkMcpRouteRateLimit: async () => null, validateMcpRouteAuth: async () => ({ user: { id: 7 }, agentId: "agent" }) },
    "@/lib/mcp/auth": { checkMcpRateLimit: async () => null, validateMcpAuth: async () => ({ user: { id: 7 }, agentId: "agent" }) },
    "@/lib/storage/uploadTaskAttachmentToS3": {},
    "@/lib/agents/chatContentScope": { chatContentScopeWhere: async () => ({}) }, "@/lib/mcp/tasks/agentMutationFence": { TaskTeamScopeError: class extends Error {} },
    "@/lib/agentRuns/model": { AGENT_CHAT_SYSTEM_MESSAGES: [], isAgentChatSystemMessage: () => false },
    "@/lib/agentRuns/service": { readAgentChatTurn: async () => null }, "@/lib/agents/agentChatActivity": {},
    "@/lib/agents/chatActivityFeed": { asksForAgentActivity: () => false }, "@/lib/mcp/agents/scopes": { requireRole: async () => null },
    "@/lib/mcp/tasks/services": {}, "@/lib/agents/chatTicketProposal": { serializeChatTicketProposal: () => null },
  };
  const { POST } = load("src/app/api/agent-chat/[sessionId]/messages/route.ts", mocks);
  return { rows, webhooks, queries, accessChecks, access, contextAccess, disable() { enabled = false; }, setAgentReadable(value) { agentReadable = value; },
    send: (context) => POST(new Request("https://app.hypertask.ai/api/agent-chat/session/messages", {
      method: "POST", headers: sidebar ? { "x-hypertask-sidebar-project": "15" } : {},
      body: JSON.stringify({ text: "Which ticket?", ...(context !== undefined ? { default_context: context } : {}) }),
    }), { params: Promise.resolve({ sessionId: "session" }) }),
    pending: () => load("src/app/api/mcp/chat/pending/route.ts", mocks).GET(new Request("https://app.hypertask.ai/api/mcp/chat/pending")),
    agentTranscript: () => load("src/app/api/mcp/chat/sessions/[sessionId]/messages/route.ts", mocks).GET(new Request("https://app.hypertask.ai/api/mcp/chat/sessions/session/messages"), { params: Promise.resolve({ sessionId: "session" }) }),
    humanTranscript: () => load("src/app/api/agent-chat/[sessionId]/route.ts", mocks).GET(new Request("https://app.hypertask.ai/api/agent-chat/session"), { params: Promise.resolve({ sessionId: "session" }) }),
    history: (agent = true) => load("src/app/api/mcp/ai/sessions/_dependencies.ts", mocks).aiSessionDependencies.messages({ user: { id: 7 }, agentId: agent ? "agent" : null }, session.id, 50, 0),
    historyApi: () => load("src/app/api/mcp/ai/sessions/route.ts", mocks).GET({ nextUrl: new URL(`https://app.hypertask.ai/api/mcp/ai/sessions?session_id=${session.id}`) }),
  };
}

for (const webhook of [false, true]) {
  test(`plain stored content and human transcript; canonical agent context via ${webhook ? "push" : "poll"} and history`, async () => {
    const h = server({ webhook });
    const response = await h.send({ project_id: 15, task_id: 42, scope: "ticket", surface_path: "/detail/project-15/42", title: "Forged title" });
    assert.equal(response.status, 200);
    const context = { scope: "ticket", task_id: 42, project_id: 15, ticket_number: "HTPR-42", title: "Ticket title", surface_path: "/detail/project-15/42" };
    const text = 'Context: HTPR-42 "Ticket title" on board 15\n\nWhich ticket?';
    assert.equal(h.rows[0].content, "Which ticket?");
    assert.deepEqual(h.rows[0].context, context);
    assert.deepEqual(h.queries[0].where, { id: 42, projectId: 15, project: h.contextAccess });
    assert.equal(h.webhooks[0].chat.text, text);
    assert.deepEqual(h.webhooks[0].chat.context, context);
    const sent = await response.json();
    assert.equal(sent.delivered, true);
    assert.equal(sent.message.content, "Which ticket?");
    assert.equal(Object.hasOwn(sent.message, "context"), false);
    if (!webhook) {
      const pending = (await (await h.pending()).json()).messages[0];
      assert.equal(pending.text, text);
      assert.deepEqual(pending.context, context);
    }
    const agent = (await (await h.agentTranscript()).json()).messages[0];
    assert.equal(agent.content, text);
    assert.deepEqual(agent.context, context);
    const history = await h.history();
    assert.equal(history.session.messages[0].content, text);
    assert.deepEqual(history.session.messages[0].context, context);
    const api = await h.historyApi();
    assert.equal(api.status, 200);
    assert.equal((await api.json()).session.messages[0].content, text);
    const human = await h.humanTranscript();
    assert.equal(human.status, 200);
    const humanMessages = (await human.json()).messages;
    assert.deepEqual(humanMessages.map(({ content }) => content), ["Which ticket?"]);
    assert.deepEqual(humanMessages[0].context, { scope: "ticket", project_id: 15, task_id: 42 });
    for (const key of ["title", "ticket_number", "surface_path"]) assert.equal(Object.hasOwn(humanMessages[0].context, key), false);
    const humanHistory = (await h.history(false)).session.messages[0];
    assert.equal(humanHistory.content, "Which ticket?");
    assert.equal(Object.hasOwn(humanHistory, "context"), false);
  });
}

for (const delivery of ["revoked after send", "still allowed"]) {
  test(`queued context is re-checked at delivery: ${delivery}`, async () => {
    const h = server();
    assert.equal((await h.send({ project_id: 15, task_id: 42, scope: "ticket" })).status, 200);
    assert.deepEqual(h.accessChecks.filter(({ agentId }) => agentId), [
      { userId: 9, agentId: "agent", teamScope: { teamId: "agent-team", accessBinding: "binding" } },
    ]);
    const context = { scope: "ticket", project_id: 15, task_id: 42, ticket_number: "HTPR-42", title: "Ticket title" };
    assert.deepEqual(h.rows[0].context, context);
    if (delivery === "revoked after send") h.setAgentReadable(false);
    for (const read of [
      async () => { const response = await h.pending(); assert.equal(response.status, 200); return response.json(); },
      async () => { const response = await h.agentTranscript(); assert.equal(response.status, 200); return response.json(); },
      () => h.history(),
    ]) {
      const start = h.accessChecks.length;
      const response = await read();
      assert.deepEqual(h.accessChecks.slice(start), [{ userId: 7, agentId: "agent", teamScope: undefined }]);
      const message = (response.messages ?? response.session.messages)[0];
      assert.equal(message.text ?? message.content, delivery === "revoked after send"
        ? "Which ticket?"
        : 'Context: HTPR-42 "Ticket title" on board 15\n\nWhich ticket?');
      if (delivery === "revoked after send") {
        assert.equal(Object.hasOwn(message, "context"), false);
        assert.doesNotMatch(JSON.stringify(response), /Ticket title|HTPR-42/);
      } else {
        assert.deepEqual(message.context, context);
      }
    }
  });
}

for (const context of [{ project_id: 15 }, { project_id: 22 }, {}]) {
  test(`external board/all context stays separate and reaches every agent reader: ${JSON.stringify(context)}`, async () => {
    const h = server();
    assert.equal((await h.send(context)).status, 200);
    const selected = h.rows[0].context;
    assert.equal(h.rows[0].content, "Which ticket?");
    assert.equal(selected.scope, context.project_id ? "board" : "all");
    assert.equal(selected.project_id, context.project_id);
    if (context.project_id) assert.deepEqual(h.queries[0].where, { id: context.project_id, ...h.contextAccess });
    const text = context.project_id ? `Context: board ${context.project_id} "Board title"\n\nWhich ticket?` : "Context: all boards\n\nWhich ticket?";
    assert.equal(h.webhooks[0].chat.text, text);
    assert.deepEqual(h.webhooks[0].chat.context, selected);
    const pending = (await (await h.pending()).json()).messages[0];
    assert.equal(pending.text, text);
    assert.deepEqual(pending.context, selected);
    const transcript = (await (await h.agentTranscript()).json()).messages[0];
    assert.equal(transcript.content, text);
    assert.deepEqual(transcript.context, selected);
    const history = (await h.history()).session.messages[0];
    assert.equal(history.content, text);
    assert.deepEqual(history.context, selected);
  });
}

test("unreadable and mismatched context is refused before message persistence or delivery; readable context is still allowed", async () => {
  for (const context of [{ project_id: 15, task_id: 42, scope: "ticket" }, { project_id: 22 }]) {
    const h = server({ readable: false });
    assert.equal((await h.send(context)).status, 404);
    assert.deepEqual(h.queries[0].where, context.scope === "ticket" ? { id: 42, projectId: 15, project: h.contextAccess } : { id: 22, ...h.contextAccess });
    assert.deepEqual(h.rows, []); assert.deepEqual(h.webhooks, []);
  }
  const mismatch = server();
  assert.equal((await mismatch.send({ project_id: 22, task_id: 42, scope: "ticket" })).status, 404);
  for (const context of [null, { scope: "ticket" }, { project_id: -1 }, { surface_path: "x".repeat(501) }]) {
    const h = server();
    assert.equal((await h.send(context)).status, 400);
    assert.deepEqual(h.rows, []);
  }
  const allowed = server();
  assert.equal((await allowed.send({ project_id: 15, task_id: 42, scope: "ticket" })).status, 200);
  assert.equal(allowed.rows.length, 1);
  assert.deepEqual(allowed.queries[0].where.project, allowed.contextAccess);
  assert.equal(allowed.rows[0].context.ticket_number, "HTPR-42");
});

for (const context of [{ project_id: 15, task_id: 42, scope: "ticket" }, { project_id: 22 }]) {
  test(`destination agent's inaccessible context is now refused and accessible context is still allowed: ${JSON.stringify(context)}`, async () => {
    for (const options of [{ agentReadable: false }, { validBinding: false }]) {
      const refused = server(options);
      const response = await refused.send(context);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { success: false, error: context.scope === "ticket" ? "Ticket not found" : "Board not found" });
      assert.deepEqual(refused.rows, []);
      assert.deepEqual(refused.webhooks, []);
    }
    const allowed = server();
    const response = await allowed.send(context);
    assert.equal(response.status, 200);
    assert.equal(allowed.rows[0].content, "Which ticket?");
    assert.deepEqual(allowed.rows[0].context, context.scope === "ticket"
      ? { scope: "ticket", project_id: 15, task_id: 42, ticket_number: "HTPR-42", title: "Ticket title" }
      : { scope: "board", project_id: 22, title: "Board title" });
    assert.deepEqual(allowed.webhooks[0].chat.context, allowed.rows[0].context);
  });
}

test("flag off, standalone sends, and old clients still send and store today's plain message", async () => {
  for (const options of [{ enabled: false }, { sidebar: false }, {}]) {
    const h = server(options);
    assert.equal((await h.send(Object.keys(options).length ? { project_id: -1, scope: "ticket" } : undefined)).status, 200);
    assert.equal(h.rows[0].content, "Which ticket?");
    assert.equal(h.webhooks[0].chat.text, "Which ticket?");
    assert.equal(Object.hasOwn(h.rows[0], "context"), false);
    assert.equal(Object.hasOwn(h.webhooks[0].chat, "context"), false);
    const pending = (await (await h.pending()).json()).messages[0];
    assert.equal(pending.text, "Which ticket?");
    assert.equal(Object.hasOwn(pending, "context"), false);
    assert.deepEqual(h.queries, []);
  }
});

test("switching the flag off hides already-stored context from every agent and human read path", async () => {
  const h = server();
  assert.equal((await h.send({ project_id: 15, task_id: 42, scope: "ticket" })).status, 200);
  assert.ok(h.rows[0].context);
  h.disable();
  const pending = (await (await h.pending()).json()).messages[0];
  const transcript = (await (await h.agentTranscript()).json()).messages[0];
  const history = (await h.history()).session.messages[0];
  assert.equal(pending.text, "Which ticket?");
  assert.equal(transcript.content, "Which ticket?");
  assert.equal(history.content, "Which ticket?");
  const humanResponse = await h.humanTranscript();
  assert.equal(humanResponse.status, 200);
  const human = (await humanResponse.json()).messages[0];
  assert.equal(human.content, "Which ticket?");
  for (const message of [pending, transcript, history, human]) assert.equal(Object.hasOwn(message, "context"), false);
});

test("agent replies are never rendered with human context and old contextless human messages stay plain", async () => {
  const h = server();
  await h.send({ project_id: 15 });
  h.rows.push({ ...h.rows[0], id: "reply", role: "assistant", content: "Reply" });
  h.rows.push({ ...h.rows[0], id: "old", content: "Old message", context: null });
  for (const messages of [(await (await h.agentTranscript()).json()).messages, (await h.history()).session.messages]) {
    const reply = messages.find(({ id }) => id === "reply");
    const old = messages.find(({ id }) => id === "old");
    assert.equal(reply.content, "Reply");
    assert.equal(Object.hasOwn(reply, "context"), false);
    assert.equal(old.content, "Old message");
    assert.equal(Object.hasOwn(old, "context"), false);
  }
});

test("context schema is nullable JSON and migration adds only its JSONB column", () => {
  const schema = fs.readFileSync(path.join(root, "src/prisma/schema.prisma"), "utf8");
  const chatMessage = schema.match(/model ChatMessage \{([\s\S]*?)\n\}/)[1];
  assert.match(chatMessage, /\n\s+context Json\?/);
  assert.equal(fs.readFileSync(path.join(root, "src/prisma/migrations/20261024120000_htpr_7734_chat_message_context/migration.sql"), "utf8"), 'ALTER TABLE "ChatMessage" ADD COLUMN "context" JSONB;\n');
  const contracts = JSON.parse(fs.readFileSync(path.join(root, "tests/htpr-6509-query-contracts.json"), "utf8"));
  assert.equal(contracts.sessions.json.sessions[0].messages[0].context, null);
});

for (const [scope, projectId, taskId] of [["ticket", 15, 42], [null, 15, undefined], [22, 22, undefined], ["all", undefined, undefined]]) {
  test(`native agent keeps regular stream scope ${scope} and its sidebar access header`, async () => {
    const originalFetch = global.fetch, originalLog = console.log;
    let payload, headers;
    global.fetch = async (_url, options) => { payload = JSON.parse(options.body); headers = options.headers; return new Response("reply"); };
    console.log = noop;
    try {
      const { createAiChatSend } = load("src/hooks/MultiPages/AIChat/aiChatSend.ts", {
        "./aiChatStream": { consumeAiChatStream: async () => {} },
        "react-hot-toast": { default: { error: assert.fail } },
        "@/lib/mcp/bearerAuth": { mcpAuthorizationHeaders: () => ({}) },
        "@/lib/demo/guestBoardBuild": { isGuestBoardBuild: () => false },
        "@/lib/agents/chatViewerState": { sidebarChatHeaders: (id) => { assert.equal(id, "native-session"); return { "x-hypertask-sidebar-project": "15" }; } },
      });
      const result = await createAiChatSend({
        editor: { getHTML: () => "Which ticket?", getText: () => "Which ticket?", commands: { clearContent: noop } },
        fileUpload: { fileItems: [], clearFiles: noop }, sendInFlightRef: { current: false },
        surface: taskId ? "task_detail" : "board", inViewObject: taskId ? { taskId } : {},
        waitForChatSession: async () => ({ id: "native-session", agentId: "agent", messages: [] }),
        currentProject: { id: 15 }, scopedProjectId: projectId, boardScopeIsExplicit: typeof scope === "number", ticketScopeSelected: scope === "ticket",
        processAttachments: async () => [], addMessageToSessionQuery: noop, setIsTyping: noop,
        streamingSessionRef: { current: null }, streamingAssistantMessageRef: { current: null }, streamingRequestRef: { current: null }, setCurrentStreamingSession: noop,
        drainQueuedMessage: noop, handleSendMessageRef: { current: null }, setAgentStatus: noop,
        appendMessageToSessionCache: assert.fail, billing: {}, currentAiOption: { id: "model" }, chatRoute: "/api/ai/chat/stream",
      }).handleSendMessage();
      assert.equal(result, true);
      assert.equal(headers["x-hypertask-sidebar-project"], "15");
      assert.equal(payload.default_context.project_id, projectId);
      assert.equal(payload.default_context.task_id, taskId);
      assert.equal(payload.default_context.scope, scope === "ticket" ? "ticket" : undefined);
    } finally { global.fetch = originalFetch; console.log = originalLog; }
  });
}

test("flag is registered as an Owner + QA feature dated 2026-10-24 with smoke coverage", () => {
  const definition = load(`src/lib/flags/definitions/${flag}.ts`, {}).default;
  assert.equal(definition.key, flag); assert.equal(definition.kind, "feature");
  assert.equal(definition.defaultMode, "OWNER_AND_QA"); assert.equal(definition.shippedOn, "2026-10-24");
  assert.ok(definition.releaseRisk.reason);
  const modes = JSON.parse(fs.readFileSync(path.join(root, "e2e/smoke/production-flag-modes.json"), "utf8"));
  assert.equal(modes.modes[flag], "OWNER_AND_QA");
  assert.equal(load("src/lib/flags/definitions.ts", {}).FEATURE_FLAG_DEFINITIONS.filter((entry) => entry.key === flag).length, 1);
});
