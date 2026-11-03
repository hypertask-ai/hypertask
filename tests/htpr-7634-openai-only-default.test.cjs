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
  stubs = { "@/app/api/ai/_lib/skillAccess": { AccountSkillAccessError: class extends Error {} }, "@/lib/flags/definitions/htpr-7634-openai-only-default": { HTPR_7634_OPENAI_ONLY_DEFAULT_FLAG: "htpr-7634-openai-only-default" }, ...stubs };
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
    console: { log() {}, info() {}, warn() {}, error() {} },
  }, { filename });
  return loadedModule.exports;
}

function harness({ enabled = true, plan = "Pro", saved = null, teamByok = false, managed = false, openai = false, openaiGateway = false, gateway = false, openrouter = false, agentProvider = null, agentCiphertext = null, agentId = null, settings = {}, flagError = false, background = false } = {}) {
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
    team: { findUnique: async () => ({ id: teamId, aiKeyOnly: false, aiProviderSettings: settings, googleAccount: { userId: 6 }, byokApiKeys: [], subscriptionPlan: [{ priceId: plan, subscriptionStatus: "active" }] }) },
    teamByokApiKey: { findUnique: async ({ where }) => {
      const provider = where.teamId_provider.provider;
      const credential = provider === "claude" && teamByok ? teamKey
        : provider === "managed_gateway" && managed ? managedKey
        : provider === "openai" && openai ? "fixture-direct-openai"
        : provider === "openai" && openaiGateway ? "vck_fixture_team_openai_slot"
        : provider === "gateway" && gateway ? "vck_fixture_customer"
        : provider === "openrouter" && openrouter ? "fixture-openrouter" : null;
      return credential ? { enabled: true, ciphertext: credential } : null;
    } },
    agentByokApiKey: { findUnique: async ({ where }) => {
      agentLookups.push(where.agentId_provider);
      return agentProvider && where.agentId_provider.provider === agentProvider ? { enabled: true, ciphertext: agentCiphertext ?? (agentProvider === "gateway" ? "vck_fixture_agent" : agentKey) } : null;
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
    "@/lib/ai/teamAiFunding": {
      isPlatformAiCredential: () => false,
      resolveTeamAiFunding: async () => ({ mode: "unrestricted" }),
      resolveSideCallFunding: async () => ({ mode: "unrestricted" }),
      TeamKeyOnlyRefusal: class TeamKeyOnlyRefusal extends Error {},
    },
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
    "@/lib/auth/desktopCliTokenUser": { getDesktopCliTokenUser: async () => null, logDesktopCliAuthorization() {} },
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
  const post = async (kind, mode = "write_with_ai") => {
    const body = kind === "mcp" ? { project_id: projectId, prompt: "Fixture", mode }
      : { projectId, PROMPT: "Fixture", aiMode: mode === "task_writer" ? "AiTaskWriter" : "WriteWithAI", modelOptionId: "claude-opus-5-5-thinking", modelSelected: "claude-opus-5.5" };
    const response = await routes[kind].POST({ json: async () => body });
    const content = await response.text();
    await Promise.all(observations);
    return { status: response.status, content };
  };
  return { post, editor, gate, byok, modelApi, checks, calls, reservations, agentLookups, usage, preferenceReads: () => preferenceReads };
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
        const h = harness({ enabled, openai: true, ...(scope === "personal" ? { saved } : { settings: { featureModels: { writeWithAi: saved } } }) });
        await assertMissingClaudeKey(h, kind);
      }
    });

    test(`${kind}: saved ${scope} Luna choice wins over a Claude-capable default`, async () => {
      const saved = "gpt-6-luna";
      const h = harness({ teamByok: true, openai: true, ...(scope === "personal" ? { saved } : { settings: { featureModels: { writeWithAi: saved } } }) });
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

  test(`${kind}: Free default is Haiku on the shared pool`, async () => {
    for (const enabled of [false, true]) {
      const h = harness({ enabled, plan: "Free", openai: true, teamByok: true });
      const result = await h.post(kind);
      assert.equal(result.status, 200, result.content);
      assert.equal(h.calls[0].modelId, "anthropic/claude-haiku-5.5");
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

test("the OpenAI-only default needs Luna to run on the team's stored direct key, so agent keys never qualify", async () => {
  const teamGatewaySlot = harness({ openaiGateway: true });
  const teamGatewayContext = await teamGatewaySlot.byok.getAiDefaultModelContext({ trustedTeamId: teamId, userId });
  assert.equal(teamGatewayContext.hasClaudeRoute, true, "a team gateway in the OpenAI slot is a Claude route");
  assert.equal(teamGatewayContext.hasDirectOpenAiKey, false);
  assert.equal(catalog.defaultModelKeyFor(teamGatewayContext), "claude-haiku-5-5");
  for (const agentProvider of ["claude", "openai", "gateway"]) {
    const h = harness({ openai: true, agentProvider, agentId: "fixture-agent" });
    const context = await h.byok.getAiDefaultModelContext({ trustedTeamId: teamId, userId, agentId: "fixture-agent" });
    assert.equal(catalog.isOpenAiOnlyPaidTeam(context), false, agentProvider);
  }
});

async function agentEditorOutcome(input) {
  const h = harness({ openai: true, agentId: "fixture-agent", ...input });
  const observed = () => h.calls.map(({ modelId, credential }) => ({ modelId, credential }));
  try {
    const selected = await h.editor.selectTaskWriterModel({ aiFeature: "writeWithAi", byokProviderFlags: [], teamContext: { teamId, settings: {} }, userId, agentId: "fixture-agent" });
    await selected.model.doGenerate({ prompt: [], providerOptions: selected.providerOptions ?? {} });
    return { calls: observed(), reservations: h.reservations.length };
  } catch (error) {
    return { refused: String(error?.message ?? error), calls: observed(), reservations: h.reservations.length };
  }
}

for (const [label, input] of [
  ["agent Claude key", { agentProvider: "claude" }],
  ["agent direct OpenAI key", { agentProvider: "openai" }],
  ["agent gateway key", { agentProvider: "gateway" }],
  ["agent OpenAI slot holding the shared gateway key", { agentProvider: "openai", agentCiphertext: sharedKey }],
  ["agent OpenAI slot holding the managed gateway key", { agentProvider: "openai", agentCiphertext: managedKey, managed: true }],
]) {
  test(`team OpenAI key plus ${label}: the final model and key match the flag-off behavior and never Luna`, async () => {
    const on = await agentEditorOutcome({ ...input, enabled: true });
    const off = await agentEditorOutcome({ ...input, enabled: false });
    assert.deepEqual(on, off);
    assert.ok(on.calls.every(({ modelId }) => modelId !== "gpt-6-luna"), JSON.stringify(on));
  });
}

test("team OpenAI key plus an agent Claude key still runs Haiku on the agent's Claude key", async () => {
  const outcome = await agentEditorOutcome({ agentProvider: "claude", enabled: true });
  assert.equal(outcome.refused, undefined, JSON.stringify(outcome));
  assert.deepEqual(outcome.calls, [{ modelId: "claude-haiku-5-5", credential: agentKey }]);
});

test("without an agent, the team OpenAI-only default runs Luna on the team's own direct key", async () => {
  const h = harness({ openai: true });
  const selected = await h.editor.selectTaskWriterModel({ aiFeature: "writeWithAi", byokProviderFlags: [], teamContext: { teamId, settings: {} }, userId });
  await selected.model.doGenerate({ prompt: [], providerOptions: selected.providerOptions ?? {} });
  assert.deepEqual(h.calls.map(({ modelId, credential }) => ({ modelId, credential })), [{ modelId: "gpt-6-luna", credential: "fixture-direct-openai" }]);
});

function chatTurnModule(h, actingAgentId, agentPin = null) {
  const selectors = moduleWithStubs("src/lib/ai/chatStream/models.ts", {
    "@/lib/aiModelOptions": catalog, "@/lib/systemModelLadder": ladder, "@/lib/aiProviders": providers,
    "@/app/api/ai/_lib/providerGate": { filterModelOptionForTeam: (entry) => entry },
    "@/app/api/ai/_lib/modelProvider": h.modelApi,
    "@/lib/ai/chatStream/prompt": { CLAUDE_TEMPERATURE_UNSUPPORTED_PREFIXES: ["claude-haiku-5"] },
    "@/lib/ai/tools/constants": load(path.join(root, "src/lib/ai/tools/constants.ts")),
  });
  return moduleWithStubs("src/lib/ai/chatStream/turnModel.ts", {
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/prisma": { __esModule: true, default: { chatSession: { findFirst: async () => ({ agent: actingAgentId ? { runtimeType: "NATIVE" } : null }) }, userSetting: { findUnique: async () => null } } },
    "@/lib/ai/htpr7038ModelReset": { ensureHtpr7038ModelReset: async () => "disabled" },
    "@/lib/aiModelOptions": catalog, "@/lib/systemModelLadder": ladder, "@/lib/aiProviders": providers,
    "@/lib/aiModelPreferences": load(path.join(root, "src/lib/aiModelPreferences.ts")),
    "@/app/api/ai/_lib/modelProvider": h.modelApi,
    "@/app/api/ai/_lib/planGate": { storePlanIdForProject: async () => "Pro", haiku55ModelEnabled: async () => true, assertModelAllowedForPlan: async () => {} },
    "@/app/api/ai/_lib/byokKeys": h.byok,
    "@/app/api/ai/_lib/chatTeamContext": {
      resolveChatTeamContext: async () => ({ teamId, projectId, aiProviderSettings: {} }),
      buildChatProviderContext: () => ({ planGateProjectId: projectId, keyLookupContext: { trustedTeamId: teamId, userId } }),
    },
    "@/lib/nativeAgent/modelPin": load(path.join(root, "src/lib/nativeAgent/modelPin.ts")),
    "@/app/api/ai/_lib/providerGate": { filterModelOptionForTeam: (entry) => entry },
    "@/lib/ai/chatStream/errors": { reportHandledChatError: async () => {}, errorMessage: (error) => error.message, createSseErrorResponse: (message) => ({ refused: message }) },
    "@/lib/ai/tools/helpers": { loadActingAgent: async () => actingAgentId ? { id: actingAgentId, modelOptionId: agentPin } : null },
    "@/lib/ai/chatStream/models": selectors,
  });
}

const lunaOption = catalog.getAiModelOptionById("gpt-6-luna", true);
const haikuOption = catalog.getAiModelOptionById("claude-haiku-5-5", true);
const browserLunaDefault = { aiFeature: "aiChat", session_id: "fixture-session", modelOptionId: lunaOption.id, model: lunaOption.model, provider: lunaOption.source, modelFromDefault: true };

async function chatTurnOutcome({ registerManaged, agentPin, ...input }, body, actingAgentId = "fixture-agent") {
  const h = harness({ openai: true, agentId: actingAgentId, ...input });
  if (registerManaged) h.modelApi.registerManagedGatewayKey(managedKey);
  const turn = await chatTurnModule(h, actingAgentId, agentPin).loadTurnModel(body, { id: userId });
  return turn.refused ? { refused: turn.refused } : { modelId: turn.selected.modelId, credential: turn.streamCredential };
}

test("chat payload: an agent session leaves the default to the server, a team session sends the OpenAI-only default", () => {
  const fields = { currentOption: lunaOption, agentSessionOption: haikuOption, usesPlanDefault: true };
  assert.deepEqual({ ...catalog.chatModelRequestFields(fields, "fixture-agent") }, { modelFromDefault: true });
  assert.deepEqual(catalog.chatModelRequestFields(fields, null), { modelOptionId: lunaOption.id, model: lunaOption.model, provider: lunaOption.source, modelFromDefault: true });
  const saved = { currentOption: lunaOption, agentSessionOption: null, usesPlanDefault: false };
  assert.deepEqual(catalog.chatModelRequestFields(saved, "fixture-agent"), { modelOptionId: lunaOption.id, model: lunaOption.model, provider: lunaOption.source, modelFromDefault: false });
});

for (const [label, input] of [
  ["agent Claude key", { agentProvider: "claude" }],
  ["agent direct OpenAI key", { agentProvider: "openai" }],
  ["agent OpenAI slot holding the shared gateway key", { agentProvider: "openai", agentCiphertext: sharedKey }],
  ["agent OpenAI slot holding a registered managed gateway key", { agentProvider: "openai", agentCiphertext: managedKey, registerManaged: true }],
]) {
  test(`agent chat with ${label}: a browser Luna default never runs Luna and matches the flag-off server default`, async () => {
    const guarded = await chatTurnOutcome(input, browserLunaDefault);
    const flagOffDefault = await chatTurnOutcome({ ...input, enabled: false }, { aiFeature: "aiChat", session_id: "fixture-session", modelFromDefault: true });
    assert.notEqual(guarded.modelId, "gpt-6-luna", JSON.stringify(guarded));
    assert.deepEqual(guarded, flagOffDefault);
  });
}

test("agent chat without its own key on an OpenAI-only team runs Luna on the team's direct key when the browser leaves the default to the server", async () => {
  const outcome = await chatTurnOutcome({}, { aiFeature: "aiChat", session_id: "fixture-session", modelFromDefault: true });
  assert.deepEqual(outcome, { modelId: "gpt-6-luna", credential: "fixture-direct-openai" });
});

const serverDefaultTurn = { aiFeature: "aiChat", session_id: "fixture-session", modelFromDefault: true };
for (const [label, input] of [
  ["a shared gateway key in its OpenAI slot", { agentProvider: "openai", agentCiphertext: sharedKey }],
  ["a registered managed key in its OpenAI slot", { agentProvider: "openai", agentCiphertext: managedKey, registerManaged: true }],
  ["its own direct OpenAI key", { agentProvider: "openai" }],
  ["its own Claude key", { agentProvider: "claude" }],
]) {
  for (const body of [serverDefaultTurn, browserLunaDefault]) {
    test(`agent pinned to Luna with ${label}: a default turn (${body.model ? "browser Luna" : "server chosen"}) ignores the pin and never runs Luna`, async () => {
      const pinned = await chatTurnOutcome({ ...input, agentPin: lunaOption.id }, body);
      const unpinned = await chatTurnOutcome(input, body);
      assert.notEqual(pinned.modelId, "gpt-6-luna", JSON.stringify(pinned));
      assert.deepEqual(pinned, unpinned);
    });
  }
}

test("still allowed: an agent pin applies to a turn that names no default", async () => {
  const pinned = await chatTurnOutcome({ agentProvider: "openai", agentPin: lunaOption.id }, { aiFeature: "aiChat", session_id: "fixture-session" });
  assert.equal(pinned.modelId, "gpt-6-luna", JSON.stringify(pinned));
});

test("agent chat with an agent Claude key runs Haiku on the agent's key even when the browser sent the Luna default", async () => {
  const outcome = await chatTurnOutcome({ agentProvider: "claude" }, browserLunaDefault);
  assert.equal(catalog.isHaiku55Model(outcome.modelId), true, JSON.stringify(outcome));
  assert.equal(outcome.credential, agentKey);
});

test("agent chat keeps a hand-picked Luna, and a team chat keeps the OpenAI-only default on the team key", async () => {
  const picked = await chatTurnOutcome({ agentProvider: "claude" }, { ...browserLunaDefault, modelFromDefault: false });
  assert.equal(picked.modelId, "gpt-6-luna");
  const teamChat = await chatTurnOutcome({}, browserLunaDefault, null);
  assert.deepEqual(teamChat, { modelId: "gpt-6-luna", credential: "fixture-direct-openai" });
});

for (const [label, server] of [["flag off", { enabled: false }], ["flag read failing", { flagError: true }]]) {
  for (const [keyLabel, key, registerManaged] of [["shared gateway key", sharedKey, false], ["registered managed key", managedKey, true]]) {
    test(`team chat with the server ${label} and a supplied ${keyLabel}: a browser Luna default matches the flag-off server default`, async () => {
      const body = { ...browserLunaDefault, byokProviderFlags: [{ provider: "openai", enabled: true, ciphertext: key }] };
      const guarded = await chatTurnOutcome({ ...server, registerManaged }, body, null);
      const flagOffDefault = await chatTurnOutcome({ enabled: false, registerManaged }, { ...body, modelOptionId: undefined, model: undefined, provider: undefined }, null);
      assert.notEqual(guarded.modelId, "gpt-6-luna", JSON.stringify(guarded));
      assert.deepEqual(guarded, flagOffDefault);
    });
  }
}

test("still allowed: a hand-picked Luna with the server flag off keeps Luna", async () => {
  const picked = await chatTurnOutcome({ enabled: false }, { ...browserLunaDefault, modelFromDefault: false }, null);
  assert.equal(picked.modelId, "gpt-6-luna");
});

test("a request-supplied shared or managed key is refused the Luna default", async () => {
  const suppliedFlags = [{ provider: "openai", enabled: true, ciphertext: sharedKey }];
  const h = harness({ openai: true });
  const supplied = await h.byok.getAiDefaultModelContext({ trustedTeamId: teamId, userId }, true, "Pro", suppliedFlags);
  assert.equal(catalog.isOpenAiOnlyPaidTeam(supplied), false);
  const sameKey = await h.byok.getAiDefaultModelContext({ trustedTeamId: teamId, userId }, true, "Pro", [{ provider: "openai", enabled: true, ciphertext: "fixture-direct-openai" }]);
  assert.equal(catalog.isOpenAiOnlyPaidTeam(sameKey), true, "supplying the team's own stored key changes nothing");
  const disabledFlag = await h.byok.getAiDefaultModelContext({ trustedTeamId: teamId, userId }, true, "Pro", [{ provider: "openai", enabled: false, ciphertext: sharedKey }]);
  assert.equal(catalog.isOpenAiOnlyPaidTeam(disabledFlag), true, "a disabled supplied key changes nothing");
  for (const register of [false, true]) {
    const outcome = async (enabled) => {
      const run = harness({ openai: true, enabled });
      if (register) run.modelApi.registerManagedGatewayKey(managedKey);
      const flags = [{ provider: "openai", enabled: true, ciphertext: register ? managedKey : sharedKey }];
      try {
        const selected = await run.editor.selectTaskWriterModel({ aiFeature: "writeWithAi", byokProviderFlags: flags, teamContext: { teamId, settings: {} }, userId });
        await selected.model.doGenerate({ prompt: [], providerOptions: selected.providerOptions ?? {} });
      } catch (error) {
        return { refused: String(error?.message ?? error), calls: run.calls.map(({ modelId, credential }) => ({ modelId, credential })), reservations: run.reservations.length };
      }
      return { calls: run.calls.map(({ modelId, credential }) => ({ modelId, credential })), reservations: run.reservations.length };
    };
    const on = await outcome(true);
    assert.deepEqual(on, await outcome(false));
    assert.ok(on.calls.every(({ modelId }) => modelId !== "gpt-6-luna"), JSON.stringify(on));
  }
});

test("conversation titles never apply the OpenAI-only default, so a supplied gateway key never runs Luna", async () => {
  const resolved = [];
  const title = moduleWithStubs("src/lib/ai/chatStream/title.ts", {
    "@/lib/aiModelOptions": catalog,
    "@/app/api/ai/_lib/byokKeys": {
      getAiDefaultModelContext: async () => ({ haiku55Enabled: true, plan: "Pro", hasByok: false, byok: undefined, openaiOnlyDefaultEnabled: true, hasDirectOpenAiKey: true, hasClaudeRoute: false }),
      getByokOrTeamGatewayApiKeyForProvider: async () => undefined,
      resolveAiFallbackCredential: async (loadCredential) => loadCredential(),
      resolveAutomaticAiModel: (provider, model, input) => { resolved.push({ provider, model, input }); return { provider, model }; },
      keyOnlySideCallModel: async () => null,
    },
    "@/lib/ai/teamAiFunding": { TeamKeyOnlyRefusal: class TeamKeyOnlyRefusal extends Error {} },
    "@/app/api/ai/_lib/modelProvider": { resolveAiModel: () => ({}), aiUsageProviderForCredential: () => "fixture", configureAiModelUsage: () => {}, isAiGatewayEnabled: () => true, providerOptionsForAiModel: () => ({}) },
    "@/lib/ai/prompts/registry": { renderPrompt: () => "fixture" },
    ai: { generateText: async () => ({ text: "Fixture title" }) },
  });
  await title.generateConversationTitle("Plan the launch", "Plan the launch", "vck_fixture_agent_gateway", { teamId, userId }, { userId });
  assert.ok(resolved.length > 0);
  assert.ok(resolved.every(({ model }) => model !== "gpt-6-luna"), JSON.stringify(resolved));
  assert.ok(resolved.every(({ input }) => input !== "vck_fixture_agent_gateway"), JSON.stringify(resolved));
});

test("provider settings stays available with the flag off or a failing key read", async () => {
  for (const context of [async () => ({ openaiOnlyDefaultEnabled: false, hasDirectOpenAiKey: false, hasClaudeRoute: false }), async () => { throw new Error("Fixture corrupt stored key"); }]) {
    const route = moduleWithStubs("src/pages/api/teams/aiProviderSettings.ts", {
      "@/lib/aiProviders": providers,
      "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId }) },
      "@/lib/prisma": { __esModule: true, default: { user: { findUnique: async () => ({ id: userId }) } } },
      "@/utils/controllers/teams/getTeamAiSettingsForViewer": { getTeamAiSettingsForViewer: async () => ({ ok: true, settings: {} }) },
      "@/app/api/ai/_lib/byokKeys": { getOpenAiOnlyDefaultContext: context },
      "@/lib/flags": { isFeatureEnabled: async () => false },
      "@/lib/flags/definitions/htpr-7844-team-ai-key-only": { HTPR_7844_TEAM_AI_KEY_ONLY_FLAG: "htpr-7844-team-ai-key-only" },
      "@/lib/ai/teamAiFunding": { applyKeyOnlyProviderVisibility: (rows) => rows, aiProvidersForSavedByokKeys: () => [] },
    });
    let status, body;
    const res = { status(value) { status = value; return res; }, json(value) { body = value; return res; } };
    await route.default({ method: "GET", headers: {}, query: { teamId } }, res);
    assert.equal(status, 200);
    assert.deepEqual({ ...body.defaultModelContext }, { openaiOnlyDefaultEnabled: false, hasDirectOpenAiKey: false, hasClaudeRoute: false });
  }
});

test("picker hook consumes only the scoped server classification and obeys the client flag", () => {
  let enabled = true;
  const scopes = [];
  const context = { openaiOnlyDefaultEnabled: true, hasClaudeRoute: false, hasDirectOpenAiKey: true };
  const hook = moduleWithStubs("src/hooks/useAiDefaultModelContext.ts", {
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
    "@/app/api/ai/_lib/byokKeys": { getOpenAiOnlyDefaultContext: async (lookup) => {
      assert.equal(lookup.trustedTeamId, teamId);
      assert.equal(lookup.userId, userId);
      return { openaiOnlyDefaultEnabled: true, hasDirectOpenAiKey: true, hasClaudeRoute: false, byok: { credential: "fixture-secret-not-for-client" } };
    } },
    "@/lib/flags": { isFeatureEnabled: async () => false },
    "@/lib/flags/definitions/htpr-7844-team-ai-key-only": { HTPR_7844_TEAM_AI_KEY_ONLY_FLAG: "htpr-7844-team-ai-key-only" },
    "@/lib/ai/teamAiFunding": { applyKeyOnlyProviderVisibility: (rows) => rows, aiProvidersForSavedByokKeys: () => [] },
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
