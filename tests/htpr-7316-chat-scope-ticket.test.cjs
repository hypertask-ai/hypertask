const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const flag = "htpr-7316-chat-scope-ticket";
const user = { id: 7, email: "reader@example.test" };
const ticket = {
  id: 42, title: "Scoped ticket", ticketNumber: "HTPR-42",
  description_: { content: "<p>Scoped description</p>" },
  comments: [{ text: "<p>Scoped comment</p>", activity: null, createdAt: new Date(), agentDisplayName: null, agent: null, creator: { displayName: "Reader" } }],
};

function server({ enabled = true, readable = true } = {}) {
  const started = [], queries = [], writes = [], flags = [];
  const access = { OR: [{ creatorId: user.id }, { members: { some: { userId: user.id } } }] };
  const currentTask = load("src/app/api/ai/_lib/currentTaskContext.ts", {
    "@/lib/flags": { isFeatureEnabled: async () => false },
    "@/lib/prisma": { default: { task: {
      findFirst: async (query) => { queries.push(query); return readable && query.where.id === ticket.id && query.where.projectId === 15 ? { id: ticket.id } : null; },
      findMany: async (query) => { queries.push(query); return readable && query.where.id.in.includes(ticket.id) ? [ticket] : []; },
    } } },
    "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere: (userId) => { assert.equal(userId, user.id); return access; } },
    "@/lib/mcp/webhooks/ssrfGuard": {},
  });
  const { POST } = load("src/app/api/ai/chat/stream/route.ts", {
    "@/lib/ai/chatStream/turnModel": { loadTurnModel: async () => ({}) },
    "@/lib/ai/chatStream/stream": { createChatStream: (options) => { started.push(options); return new Response("started"); } },
    "next/server": {},
    "@/app/api/ai/_lib/requestUser": { getAiRequestUser: async () => user, getCliBearerChatUser: async () => null },
    "@/app/api/ai/_lib/cronServiceAuth": { getCronServiceRequestUser: async () => null },
    "@/lib/nativeAgent/heartbeatTurnEnvelope": {},
    "@/lib/prisma": { default: { user: { findUnique: async () => user }, chatSession: { updateMany: async (query) => { writes.push(query); return { count: 1 }; } } } },
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => { flags.push([key, userId]); return key === flag && enabled; } },
    "@/app/api/ai/chat/stream/ensureNativeChatTurn": {},
    "@/app/api/ai/_lib/currentTaskContext": currentTask,
    "@/app/api/ai/chat/stream/streamLease": { acquireAiChatStreamLease: async () => ({}) },
    "@/app/api/ai/_lib/heartbeatExecution": {},
    "@/lib/ai/chatStream/errors": { createSseErrorResponse: (message, status = 400) => new Response(message, { status }), reportHandledChatError: async () => {}, errorMessage: String },
    "@/lib/ai/tools/constants": { SSE_HEADERS: {} },
  });
  const send = (default_context = { project_id: 15, task_id: 42, scope: "ticket" }) => POST({
    headers: new Headers(),
    json: async () => ({ message: "Summarize this", default_context, context_list: [{ type: "task", id: 999 }], user_context: { id: 999 } }),
  });
  return { send, started, queries, writes, flags, access, currentTask };
}

test("unreadable ticket scope is refused before a stream or session write", async () => {
  const h = server({ readable: false });
  const response = await h.send();
  assert.equal(response.status, 403);
  assert.match(await response.text(), /access denied/);
  assert.equal(h.started.length, 0);
  assert.equal(h.writes.length, 0);
  assert.deepEqual(h.queries[0].where, { id: 42, projectId: 15, project: h.access });
  assert.deepEqual(h.flags, [[flag, user.id]]);
});

test("readable ticket scope is still allowed through the same access boundary", async () => {
  const h = server();
  const response = await h.send({ project_id: 15, task_id: 42, scope: "ticket", view_id: "board-view", view_name: "Board view" });
  assert.equal(response.status, 200);
  assert.equal(h.started.length, 1);
  assert.equal(h.started[0].contextTaskId, 42);
  assert.deepEqual(h.started[0].body.default_context, { project_id: 15, task_id: 42, scope: "ticket" });
  assert.deepEqual(h.started[0].body.context_list, []);
  assert.deepEqual(h.queries[0].where, { id: 42, projectId: 15, project: h.access });
});

for (const default_context of [{ scope: "ticket", project_id: 15 }, { scope: "ticket", task_id: 42 }, { scope: "ticket", task_id: 42, project_id: 99 }]) {
  test(`ticket scope refuses missing or mismatched identifiers: ${JSON.stringify(default_context)}`, async () => {
    const h = server();
    assert.equal((await h.send(default_context)).status, 403);
    assert.equal(h.started.length, 0);
  });
}

test("flag off ignores ticket scope and preserves today's context even for an unreadable id", async () => {
  const h = server({ enabled: false, readable: false });
  assert.equal((await h.send({ project_id: 15, task_id: 42, scope: "ticket", view_name: "Board view" })).status, 200);
  assert.equal(h.started[0].contextTaskId, null);
  assert.deepEqual(h.started[0].body.default_context, { project_id: 15, task_id: 42, view_name: "Board view" });
  assert.deepEqual(h.started[0].body.context_list, [{ type: "task", id: 999 }]);
});

for (const default_context of [{ project_id: 15, task_id: 42 }, { project_id: 22 }, {}]) {
  test(`current board, pinned board and All boards keep their existing server context: ${JSON.stringify(default_context)}`, async () => {
    const h = server();
    assert.equal((await h.send(default_context)).status, 200);
    assert.deepEqual(h.started[0].body.default_context, default_context);
    assert.deepEqual(h.started[0].body.context_list, [{ type: "task", id: 999 }]);
    assert.deepEqual(h.flags, [["htpr-7765-parallel-chats", user.id]]);
  });
}

test("model turn uses the existing authorized builder for only the chosen ticket title, description and comments", async () => {
  const h = server();
  await h.send();
  const replies = [];
  const { runModelTurn } = load("src/lib/ai/chatStream/modelTurn.ts", {
    "@/lib/prisma": {},
    "@/lib/flags": { isFeatureEnabled: async () => false },
    "@/app/api/ai/_lib/currentTaskContext": h.currentTask,
    "@/app/api/ai/chat/stream/streamLease": {},
    "@/app/api/ai/_lib/heartbeatExecution": {},
    "@/app/api/ai/chat/stream/persistAssistantMessage": {},
    "@/utils/controllers/comments/linkifyTicketRefs": {},
    "@/app/api/ai/_lib/chatSkillResolution": {},
    "@/lib/ai/chatStream/prompt": { AGENT_SYSTEM_PROMPT: "Chat prompt" },
    "@/app/api/ai/_lib/modelProvider": { configureAiModelUsage() {}, aiPromptCachingEnabled: async () => false },
    "@/lib/ai/tools/metadata": {},
    "@/lib/ai/chatStream/title": {},
    "@/lib/ai/tools": { buildTools: () => ({}) },
    "./modelReply": { generateModelReply: async (_, options) => { replies.push(options); return null; } },
    "./chatNames": { nameChatFromFirstMessage: async () => null },
  });
  const options = h.started[0];
  await runModelTurn({ ...options, selected: options.selected ?? { model: "test-model" }, providerAbort: new AbortController(), send() {} }, options.body, {});
  const prompt = replies[0].messages[0].content;
  assert.match(prompt, /Title: Scoped ticket/);
  assert.match(prompt, /Scoped description/);
  assert.match(prompt, /Reader: Scoped comment/);
  assert.match(prompt, /SCOPE: Current ticket only/);
  assert.doesNotMatch(prompt, /"id": 999/);
  const query = h.queries.at(-1);
  assert.deepEqual(query.where, { id: { in: [42] }, project: { ...h.access, id: 15 } });
  assert.equal(query.select.title, true);
  assert.equal(query.select.description_.select.content, true);
  assert.equal(query.select.comments.take, 200);
});

test("ticket scope feature definition is registered with the Everyone default and release risk", () => {
  const definitions = load("src/lib/flags/definitions.ts", {});
  const definition = definitions.FEATURE_FLAG_DEFINITIONS.find((entry) => entry.key === flag);
  assert.ok(definition);
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "new");
});
