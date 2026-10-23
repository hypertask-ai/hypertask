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
const composer = load(path.join(root, "src/app/api/android/ai/composer/config.ts"));
const keys = load(path.join(root, "src/lib/flags/keys.ts"));
const policy = load(path.join(root, "src/lib/aiAllowancePolicy.ts"));
const fallback = load(path.join(root, "src/app/api/ai/chat/stream/modelFallback.ts"));
const flag = load(path.join(root, "src/lib/flags/definitions/htpr-7634-openai-only-default.ts"));
const userId = 1000;
const projectId = 7634;
const teamId = "fixture-team";
const sharedKey = "vck_fixture_shared";
const managedKey = "vck_fixture_managed";
const teamKey = "fixture-team-anthropic";
const agentKey = "fixture-agent-anthropic";
const output = "<p>Draft</p>";

function moduleWithStubs(file, stubs) {
  stubs = { "@/lib/flags/definitions/htpr-7634-openai-only-default": { HTPR_7634_OPENAI_ONLY_DEFAULT_FLAG: "htpr-7634-openai-only-default" }, ...stubs };
  const filename = path.join(root, file);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(code, {
    module: loadedModule, exports: loadedModule.exports,
    require: (id) => stubs[id] ?? (id.startsWith("@/") || id.startsWith("./") ? {} : require(id)),
    process: { env: { AI_GATEWAY_API_KEY: sharedKey } },
    performance, setTimeout, clearTimeout, ReadableStream, Response, Headers, TextEncoder, Error,
    console: { log() {}, warn() {}, error() {} },
  }, { filename });
  return loadedModule.exports;
}

function harness({ enabled = true, plan = "Pro", saved = null, teamByok = false, managed = false, openai = false, gateway = false, openrouter = false, agentProvider = null, agentId = null, settings = {}, flagError = false, background = false } = {}) {
  const checks = [], calls = [], reservations = [], agentLookups = [], usage = [], observations = [];
  let preferenceReads = 0;
  const flags = { isFeatureEnabled: async (key, id) => {
    checks.push([key, id]);
    if (key === flag.HTPR_7634_OPENAI_ONLY_DEFAULT_FLAG) {
      if (flagError) throw new Error("Fixture flag read failed");
      return enabled;
    }
    if (key === keys.HTPR_7075_BACKGROUND_CLAUDE_FLAG) return background;
    return false;
  } };
  const prisma = { __esModule: true, default: {
    project: {
      findFirst: async () => ({ id: projectId, teamId, team: { aiProviderSettings: settings } }),
      findUnique: async () => ({ team: { id: teamId, subscriptionPlan: [{ priceId: plan, subscriptionStatus: "active" }] } }),
    },
    team: { findUnique: async () => ({ id: teamId, aiProviderSettings: settings, subscriptionPlan: [{ priceId: plan, subscriptionStatus: "active" }] }) },
    teamByokApiKey: { findUnique: async ({ where }) => {
      const provider = where.teamId_provider.provider;
      const credential = provider === "claude" && teamByok ? teamKey
        : provider === "managed_gateway" && managed ? managedKey
        : provider === "openai" && openai ? "fixture-direct-openai"
        : provider === "gateway" && gateway ? "vck_fixture_customer"
        : provider === "openrouter" && openrouter ? "fixture-openrouter" : null;
      return credential ? { enabled: true, ciphertext: credential } : null;
    } },
    agentByokApiKey: { findUnique: async ({ where }) => {
      agentLookups.push(where.agentId_provider);
      return agentProvider && where.agentId_provider.provider === agentProvider ? { enabled: true, ciphertext: agentProvider === "gateway" ? "vck_fixture_agent" : agentKey } : null;
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
      teamAllowanceSnapshot: async () => null,
      createSharedAllowanceMiddleware: ({ allowanceUsd, modelSlug }) => {
        reservations.push({ allowanceUsd, modelSlug });
        return { specificationVersion: "v4" };
      },
    },
  });
  const byok = moduleWithStubs("src/app/api/ai/_lib/byokKeys.ts", {
    "@/lib/prisma": prisma, "@/lib/flags": flags, "@/lib/aiModelOptions": catalog, "@/lib/aiProviders": providers,
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
    "@/app/api/ai/_lib/promptCache": { cachedInstructionsForUser: async (_userId, args) => `${args.fixed}${args.suffix ?? ""}` },
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
    "@/app/api/ai/_lib/promptCache": { cachedInstructionsForUser: async (_userId, args) => `${args.fixed}${args.suffix ?? ""}` },
    "@/app/api/ai/_lib/skills": { resolveSkills: async (text) => ({ cleanedText: text, skills: [] }) },
    "@/app/api/ai/_lib/currentTaskContext": { loadCurrentTaskContext: async () => "", resolveAiUsageTaskId: async () => null },
    "@/app/api/ai/_lib/taskWriterPrompt": { formatTaskWriterRetrievedContext: () => "", createTaskWriterSystemPromptTemplate: () => "Fixture" },
    "@/app/api/ai/_lib/taskWriterBoardResearch": { buildTaskWriterRetrievalQuery: ({ prompt }) => prompt, formatRelatedTicketCandidates: () => "", formatStyleExamples: () => "", formatBoardVocabulary: () => "", TASK_WRITER_BOARD_RESEARCH_RULES: "", TASK_WRITER_RELATED_CANDIDATE_LIMIT: 8, TASK_WRITER_STYLE_EXAMPLE_LIMIT: 3 },
    "@/utils/controllers/turbopuffer/turbopufferHelper": { searchTasks: async () => [] },
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
  routeStubs["@/app/api/ai/_lib/taskWriterDraft"] = moduleWithStubs("src/app/api/ai/_lib/taskWriterDraft.ts", {
    ...routeStubs,
    "./modelProvider": modelApi,
    "./editorAi": editor,
    "./taskWriterRun": run,
    "./taskWriterProperties": routeStubs["@/app/api/ai/_lib/taskWriterProperties"],
  });
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
  return { post, editor, gate, byok, checks, calls, reservations, agentLookups, usage, preferenceReads: () => preferenceReads };
}

const test = require("node:test");
const missingClaudeKey = "A dedicated team AI Gateway key or direct BYOK key is required for claude text inference.";

async function assertMissingClaudeKey(h, kind) {
  const result = await h.post(kind);
  assert.equal(result.status, 403);
  assert.ok(result.content.includes(missingClaudeKey), result.content);
  assert.equal(h.calls.length, 0);
  assert.equal(h.reservations.length, 0);
}

function assertCall(h, model, credential) {
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].modelId, model);
  assert.equal(h.calls[0].credential, credential);
  assert.notEqual(h.calls[0].credential, sharedKey);
}

test("ticket bugfix flag starts Owner + QA as a money-risk flag", () => {
  assert.equal(flag.HTPR_7634_OPENAI_ONLY_DEFAULT_FLAG, "htpr-7634-openai-only-default");
  assert.equal(flag.default.key, flag.HTPR_7634_OPENAI_ONLY_DEFAULT_FLAG);
  assert.equal(flag.default.kind, "bugfix");
  assert.equal(flag.default.defaultMode, "OWNER_AND_QA");
  assert.equal(flag.default.releaseRisk.highRisk, "money");
  assert.equal(flag.default.shippedOn, "2026-10-23");
  assert.ok(flag.default.releaseRisk.reason);
});

for (const kind of ["app", "mcp"]) {
  for (const plan of ["Pro", "AI"]) {
    test(`${kind} ${plan}: OpenAI-only default uses Luna on the direct key, including background Claude`, async () => {
      for (const background of [false, true]) {
        const h = harness({ plan, openai: true, background });
        const result = await h.post(kind);
        assert.equal(result.status, 200, result.content);
        assertCall(h, "gpt-6-luna", "fixture-direct-openai");
        assert.equal(h.reservations.length, 0);
        assert.ok(h.checks.some(([key, id]) => key === flag.HTPR_7634_OPENAI_ONLY_DEFAULT_FLAG && id === userId));
      }
    });

    for (const [route, credential, model] of [
      ["teamByok", teamKey, "claude-haiku-5-5"],
      ["managed", managedKey, "anthropic/claude-haiku-5.5"],
      ["gateway", "vck_fixture_customer", "anthropic/claude-haiku-5.5"],
      ["openrouter", "fixture-openrouter", "anthropic/claude-haiku-5.5"],
    ]) {
      test(`${kind} ${plan}: ${route} keeps Haiku, even with an OpenAI key`, async () => {
        const h = harness({ plan, openai: true, [route]: true, settings: { providers: { openrouter: true } } });
        const result = await h.post(kind);
        assert.equal(result.status, 200, result.content);
        assertCall(h, model, credential);
      });
    }

    test(`${kind} ${plan}: disabled OpenRouter does not displace the direct OpenAI default`, async () => {
      const h = harness({ plan, openai: true, openrouter: true, settings: { providers: { openrouter: false } } });
      const result = await h.post(kind);
      assert.equal(result.status, 200, result.content);
      assertCall(h, "gpt-6-luna", "fixture-direct-openai");
    });

    test(`${kind} ${plan}: a keyless paid team is refused before inference`, async () => {
      await assertMissingClaudeKey(harness({ plan }), kind);
    });
  }

  for (const scope of ["personal", "team"]) {
    test(`${kind}: saved ${scope} Claude choice is not replaced by Luna`, async () => {
      const saved = "claude-haiku-5-5";
      for (const enabled of [false, true]) {
        const h = harness({ enabled, openai: true, ...(scope === "personal" ? { saved } : { settings: { featureModels: { taskWriter: saved } } }) });
        await assertMissingClaudeKey(h, kind);
      }
    });

    test(`${kind}: saved ${scope} Luna choice wins over a Claude-capable default`, async () => {
      const saved = "gpt-6-luna";
      const h = harness({ teamByok: true, openai: true, ...(scope === "personal" ? { saved } : { settings: { featureModels: { taskWriter: saved } } }) });
      const result = await h.post(kind);
      assert.equal(result.status, 200, result.content);
      assertCall(h, "gpt-6-luna", "fixture-direct-openai");
    });
  }

  test(`${kind}: a saved Luna choice on a Claude-only team stays on the OpenAI key path`, async () => {
    const h = harness({ teamByok: true, saved: "gpt-6-luna" });
    const result = await h.post(kind);
    assert.equal(result.status, 403);
    assert.ok(result.content.includes("A dedicated team AI Gateway key or direct BYOK key is required for openai text inference."), result.content);
    assert.equal(h.calls.length, 0);
  });

  test(`${kind}: flag off or a failed flag read preserves the Pro/AI Claude-key error`, async () => {
    for (const plan of ["Pro", "AI"]) {
      for (const flagError of [false, true]) {
        await assertMissingClaudeKey(harness({ enabled: false, flagError, plan, openai: true }), kind);
      }
    }
  });

  test(`${kind}: BYOK OpenAI-only team keeps Haiku on the shared allowance, flag on or off`, async () => {
    for (const enabled of [false, true]) {
      const h = harness({ enabled, plan: "BYOK", openai: true });
      const result = await h.post(kind);
      assert.equal(result.status, 200, result.content);
      assert.equal(h.calls[0].modelId, "anthropic/claude-haiku-5.5");
      assert.equal(h.calls[0].credential, sharedKey);
    }
  });

  test(`${kind}: Free default remains Luna on the shared pool`, async () => {
    for (const enabled of [false, true]) {
      const h = harness({ enabled, plan: "Free", openai: true, teamByok: true });
      const result = await h.post(kind);
      assert.equal(result.status, 200, result.content);
      assert.equal(h.calls[0].modelId, "openai/gpt-6-luna");
      assert.equal(h.calls[0].credential, sharedKey);
    }
  });
}

test("pure defaults agree for OpenAI-only, Claude-capable, keyless and Free contexts", () => {
  const haiku = "claude-haiku-5-5";
  const luna = "gpt-6-luna";
  for (const plan of ["Pro", "AI"]) {
    for (const [hasDirectOpenAiKey, hasClaudeRoute, expected] of [
      [true, false, luna], [true, true, haiku], [false, true, haiku], [false, false, haiku],
    ]) {
      const context = { haiku55Enabled: true, haikuDefaultEnabled: true, backgroundClaudeEnabled: true, openaiOnlyDefaultEnabled: true, plan, hasDirectOpenAiKey, hasClaudeRoute };
      assert.equal(catalog.defaultModelKeyFor(context), expected);
      const option = catalog.getDefaultAiModelOptionForPlan(plan, hasClaudeRoute, true, true, context);
      assert.equal(option.id, expected);
      assert.equal(catalog.pickAutoAiModelOption(catalog.aiModelOptions, true, context).id, expected);
      assert.equal(composer.buildComposerConfig({ settings: {}, customEndpointConfigured: false, storePlanId: plan, providersWithByok: new Set(["openai", "anthropic"]), haiku55Enabled: true, haikuDefaultEnabled: true, defaultContext: context }).selectedModelId, expected);
      assert.equal(catalog.defaultModelKeyFor({ ...context, openaiOnlyDefaultEnabled: false }), haiku);
      assert.equal(catalog.resolveAiModelOption([luna], option, true).id, luna);
      assert.equal(catalog.resolveAiModelOption([haiku], option, true).id, haiku);
    }
  }
  const byokContext = { haiku55Enabled: true, openaiOnlyDefaultEnabled: true, plan: "BYOK", hasDirectOpenAiKey: true, hasClaudeRoute: false };
  assert.equal(catalog.defaultModelKeyFor(byokContext), haiku);
  for (const enabled of [false, true]) {
    const context = { haiku55Enabled: true, plan: "Free", openaiOnlyDefaultEnabled: enabled, hasDirectOpenAiKey: true, hasClaudeRoute: false };
    assert.equal(catalog.defaultModelKeyFor(context), luna);
    assert.equal(catalog.getDefaultAiModelOptionForPlan("Free", false, true, false, context).id, luna);
  }
});

test("server context includes managed funding, not the shared key", async () => {
  for (const input of [{ openai: true }, { openai: true, managed: true }, {}]) {
    const h = harness(input);
    const context = await h.byok.getAiDefaultModelContext({ trustedTeamId: teamId, userId, agentId: input.agentId });
    assert.equal(context.hasDirectOpenAiKey, Boolean(input.openai));
    assert.equal(context.hasClaudeRoute, Boolean(input.managed));
    if (context.byok) assert.notEqual(context.byok.credential, sharedKey);
  }
});

test("picker hook consumes only the scoped server classification and obeys the client flag", () => {
  let enabled = true;
  const scopes = [];
  const context = { openaiOnlyDefaultEnabled: true, hasClaudeRoute: false, hasDirectOpenAiKey: true };
  const hook = moduleWithStubs("src/hooks/useHaikuDefaultFlag.ts", {
    "@/hooks/useFlag": { useFlag: (key) => enabled && key === flag.HTPR_7634_OPENAI_ONLY_DEFAULT_FLAG },
    "@/hooks/useTeamAiProviders": { useTeamAiProviders: (id) => { scopes.push(id); return { defaultModelContext: context }; } },
  });
  const current = hook.useAiDefaultModelContext(teamId);
  assert.equal(current, context);
  assert.equal(scopes.at(-1), teamId);
  assert.equal(catalog.getDefaultAiModelOptionForPlan("Pro", false, true, true, current).id, "gpt-6-luna");
  enabled = false;
  assert.equal(hook.useAiDefaultModelContext(teamId), undefined);
  assert.equal(scopes.at(-1), null);
});

test("provider settings exposes route booleans but never sends credentials to the picker", async () => {
  const route = moduleWithStubs("src/pages/api/teams/aiProviderSettings.ts", {
    "@/lib/aiProviders": providers,
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId }) },
    "@/lib/prisma": { __esModule: true, default: { user: { findUnique: async () => ({ id: userId }) } } },
    "@/utils/controllers/teams/getTeamAiSettingsForViewer": { getTeamAiSettingsForViewer: async () => ({ ok: true, settings: {} }) },
    "@/app/api/ai/_lib/byokKeys": { getAiDefaultModelContext: async (lookup) => {
      assert.equal(lookup.trustedTeamId, teamId);
      assert.equal(lookup.userId, userId);
      return { openaiOnlyDefaultEnabled: true, hasDirectOpenAiKey: true, hasClaudeRoute: false, byok: { credential: "fixture-secret-not-for-client" } };
    } },
  });
  let status, body;
  const res = { status(value) { status = value; return res; }, json(value) { body = value; return res; } };
  await route.default({ method: "GET", headers: {}, query: { teamId } }, res);
  assert.equal(status, 200);
  assert.equal(body.defaultModelContext.openaiOnlyDefaultEnabled, true);
  assert.equal(body.defaultModelContext.hasDirectOpenAiKey, true);
  assert.equal(body.defaultModelContext.hasClaudeRoute, false);
  assert.equal(JSON.stringify(body).includes("fixture-secret-not-for-client"), false);
  assert.equal(Object.keys(body.defaultModelContext).length, 3);
});
