const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const ai = require("ai");
const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false });
const catalog = load(path.join(root, "src/lib/aiModelOptions.ts"));
const providers = load(path.join(root, "src/lib/aiProviders.ts"));
const ladder = load(path.join(root, "src/lib/systemModelLadder.ts"));
const keys = load(path.join(root, "src/lib/flags/keys.ts"));
const policy = load(path.join(root, "src/lib/aiAllowancePolicy.ts"));
const fallback = load(path.join(root, "src/app/api/ai/chat/stream/modelFallback.ts"));
const userId = 1000;
const projectId = 7038;
const teamId = "fixture-team";
const sharedKey = "vck_fixture_shared";
const managedKey = "vck_fixture_managed";
const teamKey = "fixture-team-anthropic";
const agentKey = "fixture-agent-anthropic";
const output = "<p>Draft</p>";

function moduleWithStubs(file, stubs) {
  const filename = path.join(root, file);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(code, {
    module: loadedModule, exports: loadedModule.exports,
    require: (id) => stubs[id] ?? (id.startsWith("@/") || id.startsWith("./") ? {} : require(id)),
    process: { env: { AI_GATEWAY_API_KEY: sharedKey } },
    performance, setTimeout, clearTimeout, ReadableStream, Response, TextEncoder, Error,
    console: { log() {}, warn() {}, error() {} },
  }, { filename });
  return loadedModule.exports;
}

function harness({ enabled = false, plan = "Free", saved = null, teamByok = false, agentByok = false, agentId = null, unavailable = false, settings = {}, flagError = false, haiku = false } = {}) {
  const checks = [], calls = [], reservations = [], agentLookups = [], usage = [], observations = [];
  let preferenceReads = 0;
  const flags = { isFeatureEnabled: async (key, id) => {
    checks.push([key, id]);
    if (key === keys.HTPR_7038_TASK_WRITER_SONNET_FLAG) {
      if (flagError) throw new Error("Fixture flag read failed");
      return enabled;
    }
    return haiku && key === keys.HTPR_7038_HAIKU_DEFAULT_FLAG;
  } };
  const prisma = { __esModule: true, default: {
    project: {
      findFirst: async () => ({ id: projectId, teamId, team: { aiProviderSettings: settings } }),
      findUnique: async () => ({ team: { id: teamId, subscriptionPlan: [{ priceId: plan, subscriptionStatus: "active" }] } }),
    },
    team: { findUnique: async () => ({ id: teamId, subscriptionPlan: [{ priceId: plan, subscriptionStatus: "active" }] }) },
    teamByokApiKey: { findUnique: async ({ where }) => {
      const provider = where.teamId_provider.provider;
      const credential = provider === "claude" && teamByok ? teamKey
        : provider === "managed_gateway" && ["Pro", "AI"].includes(plan) ? managedKey : null;
      return credential ? { enabled: true, ciphertext: credential } : null;
    } },
    agentByokApiKey: { findUnique: async ({ where }) => {
      agentLookups.push(where.agentId_provider);
      return agentByok && where.agentId_provider.provider === "claude" ? { enabled: true, ciphertext: agentKey } : null;
    } },
    userSetting: { findUnique: async () => {
      preferenceReads += 1;
      return { aiModelPreferences: saved ? { taskWriter: saved, writeWithAi: saved, improveWriting: saved } : null };
    } },
    taskTemplate: { findMany: async () => [] },
  } };
  const planGate = moduleWithStubs("src/app/api/ai/_lib/planGate.ts", {
    "@/lib/prisma": prisma, "@/lib/flags": flags, "@/lib/flags/keys": keys,
    "@/lib/aiModelOptions": catalog,
    "@/lib/internalCompTeams": { isInternalCompTeam: () => false },
    "@/lib/teamComp": { applyTeamComp: (_team, value) => value },
    "@/lib/subscriptionAccess": { pickEntitlingSubscriptionRow: (rows) => rows[0], subscriptionStatusGrantsAccess: () => true },
    "@/lib/planFromStripePriceId": { planKindFromStripePriceId: (priceId) => ({ storePlanId: priceId }) },
  });
  const gate = { ...planGate, storePlanIdForProject: async () => plan };
  const factory = (provider, credential) => {
    const modelFactory = (modelId) => {
      const observe = (params) => {
        calls.push({ provider, credential, modelId, params });
        if (unavailable && /sonnet-5[.-]5/.test(modelId)) throw Object.assign(new Error("Fixture model unavailable"), { status: 404 });
      };
      return {
        specificationVersion: "v4", provider, modelId, supportedUrls: {},
        doGenerate: async (params) => {
          observe(params);
          return { content: [{ type: "text", text: output }], usage: { inputTokens: { total: 10 }, outputTokens: { total: 2 } }, finishReason: { unified: "stop" } };
        },
        doStream: async (params) => {
          observe(params);
          return { stream: new ReadableStream({ start(controller) {
            controller.enqueue({ type: "text-delta", id: "fixture", delta: output });
            controller.close();
          } }) };
        },
      };
    };
    return Object.assign(modelFactory, { chat: modelFactory, tools: { webSearch: () => ({}), webSearch_20250305: () => ({}) } });
  };
  const providerStubs = {
    "@ai-sdk/anthropic": { createAnthropic: ({ apiKey }) => factory("anthropic", apiKey) },
    "@ai-sdk/openai": { createOpenAI: ({ apiKey }) => factory("openai", apiKey) },
    "@openrouter/ai-sdk-provider": { createOpenRouter: ({ apiKey }) => factory("openrouter", apiKey) },
  };
  const modelApi = moduleWithStubs("src/app/api/ai/_lib/modelProvider.ts", {
    ...providerStubs,
    ai: { ...ai, createGateway: ({ apiKey }) => factory("gateway", apiKey) },
    "@/lib/aiModelOptions": catalog, "@/lib/aiProviders": providers,
    "@/app/api/ai/_lib/planGate": gate,
    "@vercel/functions": { waitUntil: (promise) => observations.push(promise) },
    "./aiUsage": { logAiUsage: async (record) => { usage.push(record); } },
    "@/lib/ai/prompts/registry": { identifyPrompt: () => ({ promptId: "fixture", promptVersion: "1" }) },
    "@/lib/telemetry/aiChatObservability": { recordAiChatTurn: async () => {} },
    "@/lib/errors/reportError": { reportError: async () => {} },
    "@/lib/aiAllowancePolicy": policy,
    "@/lib/aiUsageClassification": load(path.join(root, "src/lib/aiUsageClassification.ts")),
    "@/lib/ai/customEndpoint": load(path.join(root, "src/lib/ai/customEndpoint.ts")),
    "@/app/api/ai/_lib/sharedAllowance": {
      gatewayCatalogModelSlug: (id) => id,
      sharedAiAllowanceErrorMessage: () => null,
      createSharedAllowanceMiddleware: ({ allowanceUsd, modelSlug }) => {
        reservations.push({ allowanceUsd, modelSlug });
        return { specificationVersion: "v4" };
      },
    },
  });
  const byok = moduleWithStubs("src/app/api/ai/_lib/byokKeys.ts", {
    "@/lib/prisma": prisma, "@/lib/aiModelOptions": catalog, "@/lib/aiProviders": providers,
    "@/lib/crypto/byokCipher": { decryptByokSecret: (value) => value },
    "@/app/api/ai/_lib/modelProvider": modelApi,
    "@/app/api/ai/_lib/planGate": gate,
    "@/app/api/ai/_lib/managedGatewayKeys": { MANAGED_TEAM_GATEWAY_PROVIDER: "managed_gateway" },
    "@/app/api/ai/chat/stream/modelFallback": fallback,
  });
  const providerGate = moduleWithStubs("src/app/api/ai/_lib/providerGate.ts", {
    "@/lib/prisma": prisma, "@/lib/aiModelOptions": catalog, "@/lib/aiProviders": providers,
    "@/utils/controllers/projects/getAllIncludes": { taskWriteAccessWhere: () => ({}) },
  });
  const editor = moduleWithStubs("src/app/api/ai/_lib/editorAi.ts", {
    ...providerStubs,
    "@/lib/ai/htpr7038ModelReset": { ensureHtpr7038ModelReset: async () => "disabled" },
    "@/lib/prisma": prisma, "@/lib/flags": flags, "@/lib/flags/keys": keys,
    "@/lib/aiModelOptions": catalog, "@/lib/aiProviders": providers, "@/lib/systemModelLadder": ladder,
    "@/lib/aiModelPreferences": load(path.join(root, "src/lib/aiModelPreferences.ts")),
    "@/app/api/ai/_lib/modelProvider": modelApi,
    "@/app/api/ai/_lib/planGate": gate, "@/app/api/ai/_lib/byokKeys": byok,
    "@/app/api/ai/_lib/providerGate": providerGate,
    "@/app/api/ai/chat/stream/modelFallback": fallback,
    "@/app/api/ai/_lib/sharedAllowance": { sharedAiAllowanceErrorMessage: () => null },
  });
  const run = moduleWithStubs("src/app/api/ai/_lib/taskWriterRun.ts", {
    "@/lib/prisma": prisma, "@/lib/flags": flags,
    "@/lib/systemModelLadder": ladder,
    "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere: () => ({}) },
    "@/app/api/ai/_lib/editorAi": {
      ...editor,
      retrieveTaskWriterContext: async () => "",
      createTaskWriterPromptParts: () => ({ instructions: "Fixture", input: "Fixture" }),
      createTaskWriterUserContent: () => "Fixture",
    },
    "@/app/api/ai/_lib/providerGate": providerGate,
    "@/app/api/ai/_lib/skills": { resolveSkills: async (text) => ({ cleanedText: text, skills: [] }) },
    "@/app/api/ai/_lib/currentTaskContext": { loadCurrentTaskContext: async () => "", resolveAiUsageTaskId: async () => null },
    "@/app/api/ai/_lib/taskWriterPrompt": { formatTaskWriterRetrievedContext: () => "" },
    "@/app/api/ai/_lib/boardTemplateContext": { BOARD_TEMPLATE_LIMIT: 10 },
  });
  const inference = {
    generateText: async (args) => {
      const result = await args.model.doGenerate({ prompt: [], providerOptions: args.providerOptions, maxOutputTokens: args.maxOutputTokens });
      return { text: result.content[0].text };
    },
    streamText: (args) => ({ textStream: (async function* () {
      const result = await args.model.doStream({ prompt: [], providerOptions: args.providerOptions, maxOutputTokens: args.maxOutputTokens });
      const reader = result.stream.getReader();
      for (let item = await reader.read(); !item.done; item = await reader.read()) yield item.value.delta;
    })() }),
  };
  const routeStubs = {
    ai: inference, "next/server": { NextResponse: { json: Response.json } },
    "@/app/api/ai/_lib/editorAi": editor,
    "@/app/api/ai/_lib/modelProvider": modelApi,
    "@/app/api/ai/_lib/taskWriterRun": run,
    "@/app/api/ai/_lib/requestUser": { getAiRequestUser: async () => ({ id: userId }) },
    "@/lib/mcp/routeWrapper": {
      wrapMcpRoute: (handler) => handler,
      validateMcpRouteAuth: async () => ({ user: { id: userId }, agentId }),
      checkMcpRouteRateLimit: async () => null,
    },
    "@/app/api/ai/_lib/taskWriterProperties": { extractTaskWriterProperties: (description) => ({ title: "Fixture", description }) },
    "@/lib/ai/taskWriterDuplicateGuard": { taskTitleFromBrief: () => "Fixture" },
    "@/lib/errors/reportError": { reportError: async () => {} },
  };
  const routes = {
    app: moduleWithStubs("src/app/api/ai/task-writer/route.ts", routeStubs),
    mcp: moduleWithStubs("src/app/api/mcp/ai/task-writer/route.ts", routeStubs),
  };
  const post = async (kind, mode = "task_writer") => {
    const body = kind === "mcp" ? { project_id: projectId, prompt: "Fixture", mode }
      : { projectId, PROMPT: "Fixture", aiMode: mode === "task_writer" ? "AiTaskWriter" : "WriteWithAI", modelOptionId: "claude-opus-5-5-thinking", modelSelected: "claude-opus-5.5" };
    const response = await routes[kind].POST({ json: async () => body });
    const content = await response.text();
    await Promise.all(observations);
    return { status: response.status, content };
  };
  return { post, editor, gate, checks, calls, reservations, agentLookups, usage, preferenceReads: () => preferenceReads };
}

async function main() {
  assert.equal(catalog.isPremiumAiModelDefinition(catalog.getAiModelDefinition("claude-sonnet-5-5")), true);
  for (const kind of ["app", "mcp"]) {
    for (const plan of ["Free", "BYOK", "Pro", "AI"]) {
      for (const saved of [null, "claude-opus-5-5-thinking", "gpt-6.1-sol-high", "custom-endpoint"]) {
        const h = harness({ enabled: true, plan, saved });
        assert.equal((await h.post(kind)).status, 200);
        const call = h.calls.at(-1);
        assert.equal(call.modelId, "anthropic/claude-sonnet-5.5");
        assert.equal(call.params.providerOptions.anthropic.thinking.type, "adaptive");
        assert.equal(call.params.providerOptions.anthropic.effort, "medium");
        assert.equal(h.preferenceReads(), 0);
        assert.ok(h.usage.length > 0);
        assert.equal(h.usage.at(-1).userId, userId);
        assert.equal(h.usage.at(-1).feature, "task-writer");
        if (kind === "mcp") assert.equal(h.usage.at(-1).totalTokens, 12);
        assert.deepEqual(h.checks.find(([key]) => key === keys.HTPR_7038_TASK_WRITER_SONNET_FLAG), [keys.HTPR_7038_TASK_WRITER_SONNET_FLAG, userId]);
        assert.equal(h.reservations.at(-1).allowanceUsd, ["Free", "BYOK"].includes(plan) ? policy.FREE_TEAM_AI_ALLOWANCE_USD : policy.PAID_TEAM_AI_ALLOWANCE_USD);
      }
    }
    for (const enabled of [false, true]) {
      const h = harness({ enabled, plan: "Pro", saved: "claude-opus-5-5-thinking", teamByok: true });
      assert.equal((await h.post(kind)).status, 200);
      assert.equal(h.calls.at(-1).modelId, enabled ? "claude-sonnet-5-5" : "claude-opus-5-5");
      assert.equal(h.calls.at(-1).params.providerOptions.anthropic.effort, enabled ? "medium" : "high");
      if (enabled) {
        assert.equal(h.calls.at(-1).credential, teamKey);
        assert.equal(h.reservations.length, 0);
      }
    }
    for (const plan of ["Free", "Pro", "BYOK"]) {
      const h = harness({ plan });
      assert.equal((await h.post(kind)).status, 200);
      assert.equal(h.calls.at(-1).modelId, plan === "Pro" ? "openai/gpt-6-luna" : "google/gemini-3.5-flash-lite");
      assert.equal(h.calls.at(-1).params.providerOptions?.anthropic, undefined);
    }
    const offPremium = harness({ plan: "Free", saved: "claude-sonnet-5-5-thinking" });
    assert.equal((await offPremium.post(kind)).status, 403);
    assert.equal(offPremium.calls.length, 0);
    const flagFailure = harness({ enabled: true, plan: "Pro", flagError: true });
    assert.equal((await flagFailure.post(kind)).status, 200);
    assert.equal(flagFailure.calls.at(-1).modelId, "openai/gpt-6-luna");
    const oldDefault = harness({ enabled: false, haiku: true });
    assert.equal((await oldDefault.post(kind)).status, 200);
    assert.equal(oldDefault.calls.at(-1).modelId, "anthropic/claude-haiku-5.5");
    const newDefault = harness({ enabled: true, haiku: true });
    assert.equal((await newDefault.post(kind)).status, 200);
    assert.equal(newDefault.calls.at(-1).modelId, "anthropic/claude-sonnet-5.5");
    for (const teamByok of [false, true]) {
      const h = harness({ enabled: true, plan: "Pro", teamByok, unavailable: true });
      const result = await h.post(kind);
      assert.equal(result.status, 200);
      assert.ok(result.content.includes(output));
      assert.equal(h.calls.length, 2);
      assert.equal(h.calls[1].modelId, teamByok ? "claude-sonnet-5" : "anthropic/claude-sonnet-5");
      assert.equal(h.calls[1].credential, teamByok ? teamKey : managedKey);
      assert.equal(h.calls[1].params.providerOptions.anthropic.effort, "medium");
    }
    const disabledProvider = harness({ enabled: true, settings: { providers: { anthropic: false } } });
    assert.equal((await disabledProvider.post(kind)).status, 200);
    assert.ok(!disabledProvider.calls.at(-1).modelId.includes("sonnet"));
    const comment = harness({ enabled: true, plan: "Pro", saved: "claude-opus-5-5-thinking" });
    assert.equal((await comment.post(kind, "write_with_ai")).status, 200);
    assert.equal(comment.calls.at(-1).modelId, "anthropic/claude-opus-5.5");
    assert.ok(!comment.checks.some(([key]) => key === keys.HTPR_7038_TASK_WRITER_SONNET_FLAG));
    const disabledFeature = harness({ enabled: true, settings: { featureToggles: { taskWriter: false } } });
    assert.equal((await disabledFeature.post(kind)).status, 403);
    assert.equal(disabledFeature.calls.length, 0);
  }
  for (const enabled of [false, true]) {
    const h = harness({ enabled, plan: "Pro", teamByok: true, agentByok: true, agentId: "fixture-agent" });
    assert.equal((await h.post("mcp")).status, 200);
    if (enabled) {
      assert.equal(h.calls.at(-1).credential, agentKey);
      assert.ok(h.agentLookups.some((lookup) => lookup.agentId === "fixture-agent" && lookup.provider === "claude"));
      assert.equal(h.reservations.length, 0);
    } else {
      assert.equal(h.agentLookups.length, 0);
      assert.equal(h.calls.at(-1).modelId, "openai/gpt-6-luna");
    }
    assert.deepEqual(h.checks.find(([key]) => key === keys.HTPR_7038_TASK_WRITER_SONNET_FLAG), [keys.HTPR_7038_TASK_WRITER_SONNET_FLAG, userId]);
  }
  const agentWithoutKey = harness({ enabled: true, plan: "Pro", teamByok: true, agentId: "fixture-agent" });
  assert.equal((await agentWithoutKey.post("mcp")).status, 200);
  assert.equal(agentWithoutKey.calls.at(-1).credential, teamKey);
  const agentFallback = harness({ enabled: true, plan: "Pro", agentByok: true, agentId: "fixture-agent", unavailable: true });
  assert.equal((await agentFallback.post("mcp")).status, 200);
  assert.equal(agentFallback.calls[1].modelId, "claude-sonnet-5");
  assert.equal(agentFallback.calls[1].credential, agentKey);
  assert.ok(agentFallback.usage.length > 0);
  assert.ok(agentFallback.usage.every((row) => row.userId === userId && row.agentId === "fixture-agent"));
  for (const feature of ["improveWriting", "boardGeneration", "askAi", "aiChat"]) {
    const h = harness({ enabled: true, plan: "Pro" });
    await h.editor.selectTaskWriterModel({ userId, projectId, aiFeature: feature, teamContext: { teamId, settings: {} } });
    assert.ok(!h.checks.some(([key]) => key === keys.HTPR_7038_TASK_WRITER_SONNET_FLAG));
  }
  // The installed SDK must encode medium as output_config.effort, not a token budget.
  const { createAnthropic } = require("@ai-sdk/anthropic");
  const model = createAnthropic({ apiKey: "fixture-sdk", fetch: async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.model, "claude-sonnet-5-5");
    assert.equal(body.thinking.type, "adaptive");
    assert.equal(body.output_config.effort, "medium");
    return Response.json({ id: "fixture", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [{ type: "text", text: output }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });
  } })("claude-sonnet-5-5");
  const built = harness({ enabled: true, plan: "Pro", teamByok: true });
  await built.post("mcp");
  await model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "Fixture" }] }], maxOutputTokens: 16000, providerOptions: built.calls[0].params.providerOptions });
  console.log("HTPR-7038 task writer verification passed");
}
main().catch((error) => {
  console.error(`HTPR-7038 task writer verification failed (${error.name})`);
  if (typeof error.actual === "number" && typeof error.expected === "number") console.error(`Expected ${error.expected}, received ${error.actual}`);
  console.error(String(error.stack).split("\n").filter((line) => /^\s+at /.test(line)).join("\n"));
  process.exitCode = 1;
});
