const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

const flag = "htpr-7856-summary-context";
const access = { ownerId: 985 };
const task = {
  id: 42,
  title: "Long ticket",
  ticketNumber: "HTPR-42",
  description_: { content: "<h2>Original requirement</h2><p>Keep full HTML for edits.</p>" },
  Task_Summary: [{ content: `## Current state\nEarlier decision: preserve exports.\n\n[hypertask-summary-fingerprint]: # (${"a".repeat(64)})` }],
  comments: Array.from({ length: 200 }, (_, index) => ({
    text: `<p>Comment ${200 - index}</p>`,
    activity: null,
    createdAt: new Date(2026, 0, 1, 0, 200 - index),
    agentDisplayName: null,
    agent: null,
    creator: { displayName: "Reader", email: null },
  })),
};

function contextLoader({ summary = task.Task_Summary, readable = true } = {}) {
  const queries = [];
  const context = load("src/app/api/ai/_lib/currentTaskContext.ts", {
    "@/lib/prisma": { default: { task: { findMany: async (query) => {
      queries.push(query);
      return readable ? [{ ...task, Task_Summary: summary, comments: task.comments.slice(0, query.select.comments.take) }] : [];
    } } } },
    "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere: () => access },
    "@/lib/mcp/webhooks/ssrfGuard": {},
  });
  return { ...context, queries };
}

function assertCompact(context) {
  assert.match(context, /THIS TICKET \(HTPR-42: Long ticket\)/);
  assert.match(context, /Ticket summary .*Earlier decision: preserve exports\./s);
  assert.doesNotMatch(context, /Original requirement|hypertask-summary-fingerprint/);
  assert.equal((context.match(/- Reader: Comment /g) || []).length, 20);
  assert.match(context, /Comment 181\n- Reader: Comment 182/);
  assert.match(context, /Comment 200(?:\n|$)/);
  assert.doesNotMatch(context, /Comment 180(?:\n|$)/);
}

async function modelTurn(enabled, context) {
  const replies = [];
  const { runModelTurn } = load("src/lib/ai/chatStream/modelTurn.ts", {
    "@/lib/prisma": {},
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => {
      assert.equal(userId, 985);
      return key === flag && enabled;
    } },
    "@/app/api/ai/_lib/currentTaskContext": context,
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
  const body = { message: "Summarize this ticket", default_context: { project_id: 15, task_id: 42, scope: "ticket" } };
  await runModelTurn({ body, dbUser: { id: 985 }, contextTaskId: 42, selected: { model: "test" }, providerAbort: new AbortController(), send() {} }, body, {});
  return replies[0].messages[0].content;
}

test("chat model-turn boundary sends stored summary and precisely the latest 20 of 200 comments", async () => {
  const h = contextLoader();
  const prompt = await modelTurn(true, h);
  assertCompact(prompt);
  assert.equal(h.queries[0].select.comments.take, 20);
  assert.deepEqual(h.queries[0].select.Task_Summary, { take: 1, select: { content: true } });
  assert.deepEqual(h.queries[0].where, { id: { in: [42] }, project: { ...access, id: 15 } });
});

test("flag off preserves full description HTML and 200-comment chat history", async () => {
  const h = contextLoader();
  const prompt = await modelTurn(false, h);
  assert.match(prompt, /Description HTML .*<h2>Original requirement<\/h2>/);
  assert.equal((prompt.match(/- Reader: Comment /g) || []).length, 200);
  assert.match(prompt, /Comment 1\n- Reader: Comment 2/);
  assert.doesNotMatch(prompt, /Earlier decision/);
  assert.equal(h.queries[0].select.comments.take, 200);
  assert.equal(h.queries[0].select.Task_Summary, undefined);
});

test("Task Writer default keeps full context even when a stored summary exists", async () => {
  const h = contextLoader();
  const context = await h.loadCurrentTaskContext([42], 985, undefined, { role: "primary", projectId: 15 });
  assert.match(context, /<h2>Original requirement<\/h2>/);
  assert.equal((context.match(/- Reader: Comment /g) || []).length, 200);
  assert.doesNotMatch(context, /Earlier decision/);
});

for (const summary of [[], [{ content: "  " }], [{ content: null }]]) {
  test(`missing summary preserves description text and recent comments: ${JSON.stringify(summary)}`, async () => {
    const h = contextLoader({ summary });
    const context = await h.loadCurrentTaskContext([42], 985, undefined, { compact: true });
    assert.match(context, /Ticket description .*Original requirement Keep full HTML for edits\./);
    assert.doesNotMatch(context, /<h2>/);
    assert.equal((context.match(/- Reader: Comment /g) || []).length, 20);
  });
}

test("compact loader preserves denied access and skips absent ticket context", async () => {
  const h = contextLoader({ readable: false });
  assert.equal(await h.loadCurrentTaskContext([42], 985, undefined, { compact: true, projectId: 15 }), "");
  assert.deepEqual(h.queries[0].where.project, { ...access, id: 15 });
  assert.equal(await h.loadCurrentTaskContext([], 985, undefined, { compact: true }), "");
  assert.equal(h.queries.length, 1);
});

test("compact formatting bounds raw fixtures and keeps empty tickets readable", () => {
  const { formatTaskContext } = contextLoader();
  assertCompact(formatTaskContext(task, "primary", true));
  const context = formatTaskContext({ ...task, Task_Summary: [], description_: null, comments: [] }, "related", true);
  assert.match(context, /RELATED TICKET/);
  assert.match(context, /Ticket description .*\(empty\)/);
  assert.match(context, /\(no comments\)/);
});

test("summary context flag is reversible and live for Everyone by default", () => {
  const definition = load("src/lib/flags/definitions/htpr-7856-summary-context.ts", {}).default;
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.defaultMode, "EVERYONE");
});

for (const enabled of [true, false]) {
  test(`HyperAI POST assembles the real authorized ticket context; compact=${enabled}`, async () => {
    const h = contextLoader();
    const requests = [];
    const user = { id: 985, email: "qa@example.test", displayName: "QA" };
    const { POST } = load("src/app/api/ai/hyper-mentioned/route.ts", {
      "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
      "@/lib/auth/agentScope": { withAgentScopeRequest: (_, run) => run() },
      "@/lib/flags": { isFeatureEnabled: async (key, userId) => { assert.equal(userId, 985); return key === flag && enabled; } },
      "@/lib/net/downloadWithoutBrotli": {},
      "@/app/api/ai/_lib/planGate": { haiku55ModelEnabled: async () => false },
      "@/lib/errors/reportError": { reportError: async (report) => { throw new Error(report.message); } },
      "@/app/api/ai/_lib/modelProvider": { configureAiModelUsage() {} },
      "@/lib/ai/prompts/registry": { renderPrompt: () => "Mention rules" },
      ai: { generateText: async (request) => { requests.push(request); return { text: "<p>Reply</p>", steps: [] }; }, stepCountIs: () => () => false },
      "@/lib/prisma": { default: { user: { findUnique: async () => user }, task: { findFirst: async () => ({ id: 42, userId: 985 }) }, project: { findMany: async () => [{ id: 15 }] } } },
      "@/lib/ai/hyperAiConfirmation": {},
      "@/app/api/ai/_lib/editorAi": { getCurrentUserFromCookies: async () => user, selectTaskWriterModel: async () => ({ model: "test", modelId: "test" }), retrieveTaskWriterContext: async () => "", createTaskWriterUserContent: (text) => text },
      "@/utils/controllers/comments/createCommentService": { createCommentService: async () => ({}) },
      "@/utils/controllers/comments/linkifyTicketRefs": { linkifyTicketRefs: async (text) => text },
      "@/utils/controllers/comments/ticketRefLinker": { markAiDetailAnchors: (text) => text },
      "@/app/api/ai/_lib/currentTaskContext": { ...h, resolveAiUsageTaskId: async () => 42, loadCurrentTaskImages: async () => [] },
      "@/utils/helperFunctions/sanitizeRichHtml": { sanitizeRichHtml: (text) => text },
      "@/app/api/ai/_lib/skills": { resolveSkills: async (text) => ({ cleanedText: text }) },
      "@/lib/aiModelOptions": { resolveAiModelMention: () => null, aiModelOptions: [] },
      "@/app/api/ai/_lib/providerGate": { getProjectTeamProviderContext: async () => ({ projectId: 15, settings: {} }) },
      "@/lib/systemModelLadder": { isAiFeatureEnabled: () => true },
      "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => access, taskWriteAccessWhere: () => access },
      "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 985 }) },
      "@/lib/auth/cookieIdentity": { verifyCookieIdentity: async () => ({ status: "verified", id: 985 }) },
      "@/lib/auth/session": { SESSION_COOKIE: "session" },
      "@/lib/mcp/auth": {},
      "@/app/api/ai/_lib/hyperAiTools": { createHyperAiTools: () => ({}), HYPER_AI_TOOL_COUNT: 0 },
      "@/app/api/ai/_lib/allowanceRefusal": {},
    });
    const response = await POST({ headers: new Headers(), cookies: { get: () => undefined }, signal: new AbortController().signal, json: async () => ({ projectId: 15, taskId: 42, text: "Summarize this" }) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
    const context = requests[0].messages[0].content;
    if (enabled) assertCompact(context);
    else {
      assert.match(context, /<h2>Original requirement<\/h2>/);
      assert.equal((context.match(/- Reader: Comment /g) || []).length, 200);
    }
  });
}
