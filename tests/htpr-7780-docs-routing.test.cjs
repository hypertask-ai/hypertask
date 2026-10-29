const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { load: loadSource } = require("./task-route-loader.cjs");
const { load } = require("./helpers/flag-files.cjs");

const root = path.resolve(__dirname, "..");
const toolLoad = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false });
const sessionId = "00000000-0000-4000-8000-000000000001";
const cardId = "00000000-0000-4000-8000-000000000002";
const themeScope = { section: "appearance", project_id: undefined };

function settingsTurn({ docsRouting }) {
  const seenToolNames = [];
  const mocks = {
    "@/lib/ai/prompts/registry": { renderPrompt: () => "" },
    "@/lib/flags": { isFeatureEnabled: async (key) => key === "htpr-7622-ai-settings" || (docsRouting && key === "htpr-7780-docs-routing") },
    "@/lib/flags/keys": {},
    "@/lib/prisma": { default: {} },
    "@/app/api/ai/_lib/currentTaskContext": { loadCurrentTaskContext: async () => "" },
    "@/app/api/ai/chat/stream/streamLease": {
      acquireAiChatCompletionFence: async () => "fence",
      keepAiChatCompletionFenceAlive: () => async () => {},
      finishAiChatCompletionFence: async () => {},
    },
    "@/app/api/ai/_lib/heartbeatExecution": {},
    "@/app/api/ai/chat/stream/persistAssistantMessage": { persistAssistantMessage: async () => true },
    "@/utils/controllers/comments/linkifyTicketRefs": { linkifyTicketRefs: async (html) => html },
    "@/lib/ai/chatStream/prompt": { AGENT_SYSTEM_PROMPT: "", PRODUCT_ANSWERS_FROM_DOCS_PROMPT: "Docs rules" },
    "@/app/api/ai/_lib/modelProvider": { configureAiModelUsage() {}, aiPromptCachingEnabled: async () => false },
    "@/lib/ai/chatStream/content": { createUserContent: () => "request" },
    "@/lib/ai/chatStream/title": {},
    "@/lib/ai/tools": { buildTools: () => ({
      hypertask_settings: { execute: async () => ({ success: true }) },
      search_help_docs: { execute: async () => ({ success: true }) },
      hypertask_update_profile: { execute: async () => ({ success: true }) },
    }) },
    "./modelReply": { generateModelReply: async (_state, { tools }) => { seenToolNames.push(...Object.keys(tools)); return { chunks: ["<p>Done</p>"] }; } },
    "./chatNames": { nameChatFromFirstMessage: async () => undefined },
  };
  const { runModelTurn } = loadSource("src/lib/ai/chatStream/modelTurn.ts", mocks);
  const body = { message: "Go dark", session_id: sessionId, assistant_message_id: cardId, settings_context: themeScope };
  const state = {
    body, dbUser: { id: 6 }, firstTurn: false, requestMessage: body.message,
    selected: { model: {} }, streamId: "stream", streamLease: { redis: {} },
    providerAbort: new AbortController(), send: () => {}, finish: () => {},
  };
  return runModelTurn(state, body, { systemPromptAddition: "", cleanedText: body.message }).then(() => seenToolNames);
}

test("Docs routing improvement defaults to Everyone with a small reversible risk", () => {
  const definition = load("src/lib/flags/definitions/htpr-7780-docs-routing.ts");
  assert.equal(definition.key, "htpr-7780-docs-routing");
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason);
});

test("the help-docs guidance exists only while the flag is on", () => {
  const { createSearchHelpDocsTool } = toolLoad(path.join(root, "src/lib/ai/tools/searchHelpDocs.ts"));
  const context = (docsRoutingEnabled) => ({ docsRoutingEnabled, sendStatus: () => {} });
  const on = createSearchHelpDocsTool(context(true)).search_help_docs.description;
  const off = createSearchHelpDocsTool(context(false)).search_help_docs.description;
  assert.match(on, /Call before answering product, plan, price, limit, shortcut or setup questions/);
  assert.equal(on.replace(/ Call before answering[\s\S]*$/, ""), off);
  assert.doesNotMatch(off, /Call before answering/);
});

test("a Settings turn keeps the help-docs lookup only while the flag is on", async () => {
  assert.deepEqual((await settingsTurn({ docsRouting: true })).sort(), ["hypertask_settings", "search_help_docs"]);
  assert.deepEqual(await settingsTurn({ docsRouting: false }), ["hypertask_settings"]);
});
