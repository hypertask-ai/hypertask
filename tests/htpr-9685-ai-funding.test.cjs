const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");
const ai = require("ai");
const { JSDOM } = require("jsdom");
const { loadModule, root } = require("./helpers/loadModule.cjs");

const catalog = loadModule("src/lib/aiModelOptions.ts");
const providers = loadModule("src/lib/aiProviders.ts");
const policy = loadModule("src/lib/aiAllowancePolicy.ts");
const fallback = loadModule("src/app/api/ai/chat/stream/modelFallback.ts");
const forcedTeamKey = loadModule("src/lib/ai/forcedTeamKey.ts");
const auto = loadModule("src/app/api/ai/_lib/autoModel.ts");

const SHARED_KEY = "vck_fixture_shared_gateway";
const MANAGED_KEY = "vck_fixture_managed_gateway";
const CUSTOMER_CLAUDE_KEY = "sk-ant-customer-fixture";
const CUSTOMER_OPENAI_KEY = "sk-openai-customer-fixture";
const FORCED_OPENAI_KEY = "sk-openai-forced-fixture";
const PLATFORM_ANTHROPIC_KEY = "sk-ant-platform-fixture";

const ENV_KEYS = [
  "NODE_ENV",
  "VERCEL_ENV",
  "AI_GATEWAY_API_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MONTHLY_CREDIT_USD",
  "ERROR_BOARD_PROJECT_ID",
];

function saveEnv() {
  const snapshot = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  return () => {
    for (const [key, value] of Object.entries(snapshot)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function createFakeRedis() {
  const store = new Map();
  return {
    store,
    get: async (key) => (store.has(key) ? store.get(key) : null),
    set: async (key, value, ...args) => {
      if (args.includes("NX") && store.has(key)) return null;
      store.set(key, String(value));
      return "OK";
    },
    incr: async (key) => {
      const next = Number(store.get(key) ?? 0) + 1;
      store.set(key, String(next));
      return next;
    },
    incrby: async (key, amount) => {
      const next = Number(store.get(key) ?? 0) + Number(amount);
      store.set(key, String(next));
      return next;
    },
    expire: async () => 1,
  };
}

function createHarness({
  plan = "Pro",
  comped = false,
  creditFirstEnabled = true,
  anthropicApiKey = PLATFORM_ANTHROPIC_KEY,
  anthropicSpentUsd = 0,
  anthropicLimitUsd = 200,
  byokRows = {},
  forcedRow = null,
  anthropicError = null,
  anthropicStreamChunks = null,
  gatewayError = null,
  redis = createFakeRedis(),
} = {}) {
  const restoreEnv = saveEnv();
  process.env.NODE_ENV = "production";
  process.env.VERCEL_ENV = "production";
  process.env.AI_GATEWAY_API_KEY = SHARED_KEY;
  process.env.ANTHROPIC_MONTHLY_CREDIT_USD = String(anthropicLimitUsd);
  if (anthropicApiKey) process.env.ANTHROPIC_API_KEY = anthropicApiKey;
  else delete process.env.ANTHROPIC_API_KEY;

  const providerCalls = [];
  const reportedErrors = [];
  const usageRows = [];
  const pending = [];

  const prisma = {
    team: {
      findUnique: async () => ({
        id: "team-1",
        aiProviderSettings: {},
        compedUntil: comped ? new Date("2099-01-01T00:00:00Z") : null,
        compedPlan: comped ? "Pro" : null,
      }),
    },
    teamByokApiKey: {
      findFirst: async ({ where }) => (where?.alwaysUse ? forcedRow : null),
      findUnique: async ({ where }) => {
        const provider = where.teamId_provider.provider;
        const row = byokRows[provider];
        if (!row) return null;
        return typeof row === "string"
          ? { id: `row-${provider}`, updatedAt: new Date("2026-11-01T00:00:00Z"), enabled: true, ciphertext: row }
          : row;
      },
    },
    aiUsage: {
      aggregate: async () => ({ _sum: { costUsd: anthropicSpentUsd } }),
      create: async ({ data }) => {
        usageRows.push(data);
        return data;
      },
    },
  };

  const makeModel = (providerName, apiKey) => (modelId) => ({
    specificationVersion: "v4",
    provider: providerName,
    modelId,
    supportedUrls: {},
    doGenerate: async (params) => {
      providerCalls.push({ provider: providerName, apiKey, modelId, mode: "generate", params });
      if (providerName === "anthropic" && anthropicError) throw anthropicError;
      if (providerName === "gateway" && gatewayError) throw gatewayError;
      return {
        content: [{ type: "text", text: `ok:${providerName}:${modelId}` }],
        usage: { inputTokens: { total: 1000 }, outputTokens: { total: 200 } },
        finishReason: { unified: "stop" },
      };
    },
    doStream: async (params) => {
      providerCalls.push({ provider: providerName, apiKey, modelId, mode: "stream", params });
      if (providerName === "anthropic" && anthropicStreamChunks) {
        return {
          stream: new ReadableStream({
            start(controller) {
              for (const chunk of anthropicStreamChunks) controller.enqueue(chunk);
              controller.close();
            },
          }),
        };
      }
      if (providerName === "anthropic" && anthropicError) throw anthropicError;
      if (providerName === "gateway" && gatewayError) throw gatewayError;
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "text-delta", id: "1", delta: `ok:${providerName}:${modelId}` });
            controller.enqueue({
              type: "finish",
              usage: { inputTokens: { total: 1000 }, outputTokens: { total: 200 } },
              finishReason: { unified: "stop" },
            });
            controller.close();
          },
        }),
      };
    },
  });

  const makeClient = (providerName) => ({ apiKey }) =>
    Object.assign(makeModel(providerName, apiKey), {
      chat: makeModel(providerName, apiKey),
      imageModel: makeModel(`${providerName}-image`, apiKey),
      tools: { webSearch_20250305: () => ({}), webSearch: () => ({}) },
    });

  const flagsStub = {
    isFeatureEnabled: async (key) => {
      if (key === "htpr-9685-anthropic-credit-first") return creditFirstEnabled;
      if (key === "htpr-8049-always-use-this-key") return Boolean(forcedRow);
      return false;
    },
  };

  const aiFunding = loadModule("src/app/api/ai/_lib/aiFunding.ts", {
    "@ai-sdk/anthropic": { createAnthropic: makeClient("anthropic") },
    "@ai-sdk/openai": { createOpenAI: makeClient("openai") },
    "@openrouter/ai-sdk-provider": { createOpenRouter: makeClient("openrouter") },
    ai: { ...ai, createGateway: makeClient("gateway") },
    "@/lib/prisma": { default: prisma },
    "@/lib/redis": { getRedis: async () => redis },
    "@/lib/errors/reportError": {
      reportError: async (report) => {
        reportedErrors.push(report);
      },
    },
    "@/lib/flags": flagsStub,
    "@/lib/aiProviders": providers,
  });

  const planGate = loadModule("src/app/api/ai/_lib/planGate.ts", {
    "@/lib/prisma": { default: prisma },
    "@/lib/planFromStripePriceId": loadModule("src/lib/planFromStripePriceId.ts"),
    "@/lib/internalCompTeams": { isInternalCompTeam: () => false },
    "@/lib/teamComp": { applyTeamComp: (_team, base) => base },
    "@/lib/subscriptionAccess": { pickEntitlingSubscriptionRow: () => null, subscriptionStatusGrantsAccess: () => false },
    "@/lib/aiModelOptions": catalog,
    "@/app/api/ai/_lib/aiFunding": aiFunding,
  });
  planGate.storePlanIdForProject = async () => plan;

  const modelProvider = loadModule("src/app/api/ai/_lib/modelProvider.ts", {
    "@/lib/net/fetchWithoutBrotli": { fetchWithoutBrotli: async () => { throw new Error("no network"); } },
    "@vercel/functions": { waitUntil: (promise) => pending.push(promise) },
    "./aiUsage": { logAiUsage: async (row) => usageRows.push(row) },
    "@/lib/ai/prompts/registry": { identifyPrompt: () => ({ promptId: "fixture", promptVersion: "1" }) },
    "@/lib/telemetry/aiChatObservability": { recordAiChatTurn: async () => {} },
    "@/lib/errors/reportError": { reportError: async (report) => reportedErrors.push(report) },
    ai,
    "@/app/api/ai/_lib/aiFunding": aiFunding,
    "@/app/api/ai/_lib/sharedAllowance": {
      createImageAllowanceMiddleware: () => ({ specificationVersion: "v4" }),
      createSharedAllowanceMiddleware: () => ({ specificationVersion: "v4" }),
      gatewayCatalogModelSlug: (slug) => slug,
      modelPricing: async () => ({ inputUsdPerToken: 0.000001, outputUsdPerToken: 0.000005 }),
      modelCostUsd: (p, i, o) => i * p.inputUsdPerToken + o * p.outputUsdPerToken,
      sharedAiAllowanceErrorMessage: () => null,
      teamAllowanceSnapshot: async () => null,
    },
    "@/lib/aiModelOptions": catalog,
    "@/lib/aiProviders": providers,
    "@/lib/aiAllowancePolicy": policy,
    "@/lib/aiUsageClassification": loadModule("src/lib/aiUsageClassification.ts"),
    "@/lib/ai/customEndpoint": loadModule("src/lib/ai/customEndpoint.ts"),
    "@/app/api/ai/_lib/planGate": planGate,
  });

  const byokKeys = loadModule("src/app/api/ai/_lib/byokKeys.ts", {
    ai,
    "@/lib/prisma": { default: prisma },
    "@/lib/flags": flagsStub,
    "@/lib/ai/forcedTeamKey": forcedTeamKey,
    "@/lib/ai/modelFundingGuard": { fallbackRunsOnOurOwnGatewayKey: () => false },
    "@/lib/crypto/byokCipher": { decryptByokSecret: (value) => value },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
    "@/app/api/ai/_lib/modelProvider": modelProvider,
    "@/lib/aiModelOptions": catalog,
    "@/lib/aiProviders": providers,
    "@/lib/ai/customEndpoint": loadModule("src/lib/ai/customEndpoint.ts"),
    "@/app/api/ai/_lib/autoModel": auto,
    "@/app/api/ai/_lib/aiFunding": aiFunding,
    "@/app/api/ai/_lib/managedGatewayKeys": { MANAGED_TEAM_GATEWAY_PROVIDER: "managed_gateway" },
    "@/app/api/ai/_lib/planGate": planGate,
    "@/app/api/ai/chat/stream/modelFallback": fallback,
  });

  return {
    aiFunding,
    planGate,
    modelProvider,
    byokKeys,
    providerCalls,
    reportedErrors,
    usageRows,
    redis,
    restore: restoreEnv,
    flush: async () => {
      await Promise.all(pending.splice(0));
      await new Promise((resolve) => setTimeout(resolve, 10));
    },
  };
}

test("htpr-9685-anthropic-credit-first flag defaults to Everyone and off keeps legacy gateway routing", async () => {
  const def = loadModule("src/lib/flags/definitions/htpr-9685-anthropic-credit-first.ts").default;
  assert.equal(def.key, "htpr-9685-anthropic-credit-first");
  assert.equal(def.kind, "improvement");
  assert.equal(def.defaultMode, "EVERYONE");

  const h = createHarness({
    plan: "Pro",
    creditFirstEnabled: false,
    byokRows: { managed_gateway: MANAGED_KEY },
    anthropicSpentUsd: 0,
  });
  try {
    const pick = auto.pickAutoModelOption({ feature: "taskWriter", settings: {}, plan: "Pro" });
    const cred = await h.byokKeys.getByokOrTeamGatewayApiKeyForModelOption(pick, [], {
      trustedTeamId: "team-1",
      userId: 985,
    });
    assert.equal(cred, MANAGED_KEY);
    assert.equal(h.reportedErrors.length, 0);
  } finally {
    h.restore();
  }
});

test("Hypertask-paid Auto picks the cheapest Claude model for the job and never hits gateway while Anthropic credit remains", async () => {
  for (const plan of ["Free", "Pro", "AI"]) {
    const taskWriterPick = auto.pickAutoModelOption({ feature: "taskWriter", settings: {}, plan });
    assert.equal(taskWriterPick.modelKey, "claude-haiku-5-5", `${plan} taskWriter`);
    const hyperPick = auto.pickAutoModelOption({ feature: "hyperAi", settings: {}, plan });
    assert.equal(hyperPick.modelKey, plan === "Free" ? "claude-haiku-5-5" : "claude-sonnet-5-5", `${plan} hyperAi`);
    const boardPick = auto.pickAutoModelOption({ feature: "boardGeneration", settings: {}, plan });
    assert.equal(boardPick.modelKey, plan === "Free" ? "claude-haiku-5-5" : "claude-opus-5-5", `${plan} boardGeneration`);
  }

  for (const [label, config] of [
    ["Free", { plan: "Free", byokRows: {} }],
    ["Pro", { plan: "Pro", byokRows: { managed_gateway: MANAGED_KEY } }],
    ["AI", { plan: "AI", byokRows: { managed_gateway: MANAGED_KEY } }],
    ["Comped Pro", { plan: "Pro", comped: true, byokRows: {} }],
    ["BYOK included allowance (no own key)", { plan: "BYOK", byokRows: {} }],
  ]) {
    const h = createHarness({ ...config, anthropicSpentUsd: 45, anthropicLimitUsd: 200 });
    try {
      const autoPick = auto.pickAutoModelOption({ feature: "taskWriter", settings: {}, plan: config.plan });
      if (config.plan !== "BYOK") assert.ok(autoPick, `${label}: Auto must pick a model`);
      const pick = autoPick ?? catalog.getAiModelOptionById("claude-haiku-5-5", true);
      assert.equal(pick.modelKey, "claude-haiku-5-5", label);

      const credential = await h.byokKeys.getByokOrTeamGatewayApiKeyForModelOption(pick, [], {
        trustedTeamId: "team-1",
        userId: 985,
      });
      assert.equal(h.aiFunding.isPlatformAnthropicCredential(credential), true, `${label}: must use platform Anthropic credential`);
      assert.equal(credential.apiKey, PLATFORM_ANTHROPIC_KEY);

      const model = h.modelProvider.resolveAiModel(pick.source, pick.model, credential, pick);
      const result = await model.doGenerate({ prompt: [] });
      await h.flush();

      assert.equal(h.providerCalls.length, 1, label);
      assert.equal(h.providerCalls[0].provider, "anthropic", `${label}: Hypertask-paid Auto call MUST NOT go to gateway while Anthropic credit remains`);
      assert.equal(h.providerCalls[0].apiKey, PLATFORM_ANTHROPIC_KEY, label);
      assert.equal(h.providerCalls[0].modelId, "claude-haiku-5-5", label);
      assert.match(result.content[0].text, /^ok:anthropic:/);
      assert.equal(h.usageRows[0].provider, "platform:anthropic", label);
      assert.equal(h.reportedErrors.length, 0, `${label}: no incident when direct Anthropic succeeds`);
    } finally {
      h.restore();
    }
  }
});

test("BYOK teams with own Claude key, own OpenAI key, or forced key always use their own keys directly", async () => {
  const byokClaude = createHarness({
    plan: "BYOK",
    byokRows: { claude: CUSTOMER_CLAUDE_KEY },
  });
  try {
    const claudePick = auto.pickAutoModelOption({
      feature: "taskWriter",
      settings: {},
      plan: "BYOK",
      byokProviderFlags: [{ provider: "claude", enabled: true }],
    });
    assert.equal(claudePick.modelKey, "claude-haiku-5-5");
    const claudeCred = await byokClaude.byokKeys.getByokOrTeamGatewayApiKeyForModelOption(
      claudePick,
      [{ provider: "claude", enabled: true }],
      { trustedTeamId: "team-1", userId: 985 },
    );
    assert.equal(claudeCred, CUSTOMER_CLAUDE_KEY);
    const claudeModel = byokClaude.modelProvider.resolveAiModel("claude", claudePick.directModel, claudeCred, claudePick);
    await claudeModel.doGenerate({ prompt: [] });
    await byokClaude.flush();
    assert.equal(byokClaude.providerCalls[0].provider, "anthropic");
    assert.equal(byokClaude.providerCalls[0].apiKey, CUSTOMER_CLAUDE_KEY);
    assert.equal(byokClaude.usageRows[0].provider, "byok:claude");
  } finally {
    byokClaude.restore();
  }

  const byokOpenAi = createHarness({
    plan: "BYOK",
    byokRows: { openai: CUSTOMER_OPENAI_KEY },
  });
  try {
    const openaiPick = auto.pickAutoModelOption({
      feature: "aiChat",
      settings: {},
      plan: "BYOK",
      byokProviderFlags: [{ provider: "openai", enabled: true }],
    });
    assert.equal(openaiPick.source, "openai");
    const openaiCred = await byokOpenAi.byokKeys.getByokOrTeamGatewayApiKeyForModelOption(
      openaiPick,
      [{ provider: "openai", enabled: true }],
      { trustedTeamId: "team-1", userId: 985 },
    );
    assert.equal(openaiCred, CUSTOMER_OPENAI_KEY);
    const openaiModel = byokOpenAi.modelProvider.resolveAiModel("openai", openaiPick.model, openaiCred, openaiPick);
    await openaiModel.doGenerate({ prompt: [] });
    await byokOpenAi.flush();
    assert.equal(byokOpenAi.providerCalls[0].provider, "openai");
    assert.equal(byokOpenAi.providerCalls[0].apiKey, CUSTOMER_OPENAI_KEY);
    assert.equal(byokOpenAi.usageRows[0].provider, "byok:openai");
  } finally {
    byokOpenAi.restore();
  }

  const forced = createHarness({
    plan: "Pro",
    forcedRow: { provider: "openai" },
    byokRows: { openai: FORCED_OPENAI_KEY, managed_gateway: MANAGED_KEY },
  });
  try {
    const forcedPick = auto.pickAutoModelOption({
      feature: "aiChat",
      settings: {},
      plan: "Pro",
      forcedProvider: "openai",
    });
    assert.equal(forcedPick.source, "openai");
    const forcedCred = await forced.byokKeys.getByokOrTeamGatewayApiKeyForModelOption(
      forcedPick,
      [],
      { trustedTeamId: "team-1", userId: 985 },
    );
    assert.equal(forcedCred, FORCED_OPENAI_KEY);
    const forcedModel = forced.modelProvider.resolveAiModel("openai", forcedPick.model, forcedCred, forcedPick);
    await forcedModel.doGenerate({ prompt: [] });
    await forced.flush();
    assert.equal(forced.providerCalls[0].provider, "openai");
    assert.equal(forced.providerCalls[0].apiKey, FORCED_OPENAI_KEY);
  } finally {
    forced.restore();
  }
});

test("a specific model picked by the user is respected even when Auto prefers Claude", async () => {
  const h = createHarness({
    plan: "Pro",
    byokRows: { managed_gateway: MANAGED_KEY },
    anthropicSpentUsd: 10,
  });
  try {
    const pickedOpenAi = catalog.getAiModelOptionById("gpt-6-luna");
    const cred = await h.byokKeys.getByokOrTeamGatewayApiKeyForModelOption(pickedOpenAi, [], {
      trustedTeamId: "team-1",
      userId: 985,
    });
    assert.equal(cred, MANAGED_KEY);
    const model = h.modelProvider.resolveAiModel(pickedOpenAi.source, pickedOpenAi.model, cred, pickedOpenAi);
    await model.doGenerate({ prompt: [] });
    await h.flush();
    assert.equal(h.providerCalls[0].provider, "gateway");
    assert.equal(h.providerCalls[0].modelId, "openai/gpt-6-luna");
    assert.equal(h.providerCalls[0].apiKey, MANAGED_KEY);
    assert.equal(h.reportedErrors.length, 0);
  } finally {
    h.restore();
  }
});

test("when monthly Anthropic credit is used up, Hypertask-paid calls fall back to gateway, succeed, and file exactly one urgent report per cause per day", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-25T10:00:00Z") });
  const h = createHarness({
    plan: "Pro",
    byokRows: { managed_gateway: MANAGED_KEY },
    anthropicSpentUsd: 200,
    anthropicLimitUsd: 200,
  });
  try {
    const pick = auto.pickAutoModelOption({ feature: "taskWriter", settings: {}, plan: "Pro" });

    for (let i = 0; i < 3; i += 1) {
      const cred = await h.byokKeys.getByokOrTeamGatewayApiKeyForModelOption(pick, [], {
        trustedTeamId: "team-1",
        userId: 985,
      });
      assert.equal(cred, MANAGED_KEY);
      const model = h.modelProvider.resolveAiModel(pick.source, pick.model, cred, pick);
      const result = await model.doGenerate({ prompt: [] });
      assert.match(result.content[0].text, /^ok:gateway:/);
    }
    await h.flush();

    assert.equal(h.providerCalls.length, 3);
    assert.ok(h.providerCalls.every((call) => call.provider === "gateway"));
    assert.equal(h.reportedErrors.length, 1, "exactly one report per cause per day");
    assert.equal(h.reportedErrors[0].urgent, true);
    assert.equal(h.reportedErrors[0].dedupeSeconds, 86400);
    assert.equal(h.reportedErrors[0].extra.cause, "anthropic_credit_exhausted");
    assert.equal(h.reportedErrors[0].extra.anthropicSpentUsd, 200);
    assert.match(h.reportedErrors[0].message, /\$200\.00/);

    t.mock.timers.setTime(new Date("2026-11-26T01:00:00Z").getTime());
    const nextDayCred = await h.byokKeys.getByokOrTeamGatewayApiKeyForModelOption(pick, [], {
      trustedTeamId: "team-1",
      userId: 985,
    });
    assert.equal(nextDayCred, MANAGED_KEY);
    await h.flush();
    assert.equal(h.reportedErrors.length, 2, "next UTC day produces one fresh report");
  } finally {
    h.restore();
  }
});

test("direct Anthropic runtime error falls back automatically to Vercel Gateway, keeps Anthropic spend untouched, and files one urgent report per day", async () => {
  const h = createHarness({
    plan: "Pro",
    byokRows: { managed_gateway: MANAGED_KEY },
    anthropicSpentUsd: 12.5,
    anthropicError: Object.assign(new Error("Anthropic 529 overloaded"), { statusCode: 529 }),
  });
  try {
    const pick = auto.pickAutoModelOption({ feature: "taskWriter", settings: {}, plan: "Pro" });

    for (let i = 0; i < 2; i += 1) {
      const cred = await h.byokKeys.getByokOrTeamGatewayApiKeyForModelOption(pick, [], {
        trustedTeamId: "team-1",
        userId: 985,
      });
      assert.equal(h.aiFunding.isPlatformAnthropicCredential(cred), true);
      const model = h.modelProvider.resolveAiModel(pick.source, pick.model, cred, pick);
      const result = await model.doGenerate({ prompt: [] });
      assert.match(result.content[0].text, /^ok:gateway:anthropic\/claude-haiku-5\.5$/);
    }
    await h.flush();

    assert.equal(h.providerCalls.filter((c) => c.provider === "anthropic").length, 2);
    assert.equal(h.providerCalls.filter((c) => c.provider === "gateway").length, 2);
    assert.ok(h.usageRows.every((row) => row.provider === "gateway"), "fallback usage must log as gateway, never platform:anthropic");
    assert.equal(await h.aiFunding.getAnthropicMonthlySpendUsd(), 12.5, "gateway fallback must not consume Anthropic monthly credit");
    const fundingReports = h.reportedErrors.filter((r) => r.extra?.cause === "anthropic_error");
    assert.equal(fundingReports.length, 1);
    assert.equal(fundingReports[0].urgent, true);
    assert.equal(fundingReports[0].extra.anthropicSpentUsd, 12.5);
    assert.match(fundingReports[0].message, /HTTP 529 overloaded/);
  } finally {
    h.restore();
  }
});

test("direct Anthropic stream error after initial metadata chunk falls back seamlessly to Vercel Gateway and reports urgently", async () => {
  const h = createHarness({
    plan: "Pro",
    byokRows: { managed_gateway: MANAGED_KEY },
    anthropicSpentUsd: 5,
    anthropicStreamChunks: [
      { type: "stream-start", warnings: [] },
      { type: "response-metadata", id: "msg_1" },
      { type: "error", error: Object.assign(new Error("overloaded_error"), { statusCode: 529 }) },
    ],
  });
  try {
    const pick = auto.pickAutoModelOption({ feature: "taskWriter", settings: {}, plan: "Pro" });
    const cred = await h.byokKeys.getByokOrTeamGatewayApiKeyForModelOption(pick, [], {
      trustedTeamId: "team-1",
      userId: 985,
    });
    const model = h.modelProvider.resolveAiModel(pick.source, pick.model, cred, pick);
    const streamed = await model.doStream({ prompt: [] });
    const reader = streamed.stream.getReader();
    const chunks = [];
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(next.value);
    }
    await h.flush();

    assert.equal(h.providerCalls.filter((c) => c.provider === "anthropic").length, 1);
    assert.equal(h.providerCalls.filter((c) => c.provider === "gateway").length, 1);
    assert.ok(chunks.some((c) => c.type === "text-delta" && c.delta.startsWith("ok:gateway:")));
    assert.equal(h.usageRows[0].provider, "gateway");
    assert.equal(await h.aiFunding.getAnthropicMonthlySpendUsd(), 5);
    const reports = h.reportedErrors.filter((r) => r.extra?.cause === "anthropic_error");
    assert.equal(reports.length, 1);
    assert.equal(reports[0].urgent, true);
  } finally {
    h.restore();
  }
});

test("missing ANTHROPIC_API_KEY falls back to gateway, succeeds, and reports once per day; gateway failure also reports urgently once per cause per day", async () => {
  const missing = createHarness({
    plan: "Free",
    anthropicApiKey: "",
    byokRows: {},
  });
  try {
    const pick = auto.pickAutoModelOption({ feature: "taskWriter", settings: {}, plan: "Free" });
    for (let i = 0; i < 2; i += 1) {
      const cred = await missing.byokKeys.getByokOrTeamGatewayApiKeyForModelOption(pick, [], {
        trustedTeamId: "team-1",
        userId: 985,
      });
      assert.equal(cred, SHARED_KEY);
      const model = missing.modelProvider.resolveAiModel(pick.source, pick.model, cred, pick);
      const res = await model.doGenerate({ prompt: [] });
      assert.match(res.content[0].text, /^ok:gateway:/);
    }
    await missing.flush();
    const missingReports = missing.reportedErrors.filter((r) => r.extra?.cause === "anthropic_key_missing");
    assert.equal(missingReports.length, 1);
    assert.equal(missingReports[0].urgent, true);
  } finally {
    missing.restore();
  }

  const gatewayDown = createHarness({
    plan: "Pro",
    anthropicApiKey: "",
    byokRows: { managed_gateway: MANAGED_KEY },
    gatewayError: Object.assign(new Error("Gateway credit balance depleted"), { statusCode: 402 }),
  });
  try {
    const pick = auto.pickAutoModelOption({ feature: "taskWriter", settings: {}, plan: "Pro" });
    for (let i = 0; i < 2; i += 1) {
      const cred = await gatewayDown.byokKeys.getByokOrTeamGatewayApiKeyForModelOption(pick, [], {
        trustedTeamId: "team-1",
        userId: 985,
      });
      const model = gatewayDown.modelProvider.resolveAiModel(pick.source, pick.model, cred, pick);
      await assert.rejects(model.doGenerate({ prompt: [] }), /depleted/);
    }
    await gatewayDown.flush();
    const creditReports = gatewayDown.reportedErrors.filter((r) => r.extra?.cause === "gateway_credit_exhausted");
    assert.equal(creditReports.length, 1);
    assert.equal(creditReports[0].urgent, true);
    const keyMissingReports = gatewayDown.reportedErrors.filter((r) => r.extra?.cause === "anthropic_key_missing");
    assert.equal(keyMissingReports.length, 1, "separate cause reports independently on the same day");
  } finally {
    gatewayDown.restore();
  }
});

test("reportError marks urgent tickets with priorityIndex 1 (Urgent) and dedupes daily even when PostHog captures", async () => {
  const restoreEnv = saveEnv();
  process.env.NODE_ENV = "production";
  process.env.VERCEL_ENV = "production";
  process.env.ERROR_BOARD_PROJECT_ID = "15";
  const created = [];
  const redis = createFakeRedis();
  try {
    const mod = loadModule("src/lib/errors/reportError.ts", {
      "@/lib/prisma": {
        default: {
          section: { findMany: async () => [{ id: 4389, section_title: "Bugs" }] },
          label: { findFirst: async () => ({ id: 3 }) },
        },
      },
      "@/lib/aiAllowancePolicy": policy,
      "@/lib/flags": { isFeatureEnabled: async () => false },
      "@/lib/redis": { getRedis: async () => redis },
      "@/lib/mcp/tasks/services": {
        validateProjectAccess: async () => ({ project: { uniqueIdentifier: "HTPR", teamId: 1 } }),
        createTask: async (task) => {
          created.push(task);
        },
      },
      "./symbolicateStack": { symbolicateStack: async (stack) => ({ stack, resolvedFrames: 0 }) },
      "@/lib/telemetry/posthogErrorTracking": { capturePostHogException: async () => true },
    });

    const payload = {
      title: "[URGENT] AI fell back to Vercel Gateway: monthly Anthropic credit used up",
      message: "Month 2026-11 Anthropic spend: $200.00 / $200.00",
      source: "server",
      urgent: true,
      dedupeSeconds: 86400,
      fingerprintKey: "ai-funding:anthropic_credit_exhausted:2026-11-25",
    };
    await mod.reportError(payload);
    await mod.reportError(payload);

    assert.equal(created.length, 1);
    assert.equal(created[0].priorityIndex, 1);
    assert.equal(created[0].title, payload.title);
  } finally {
    restoreEnv();
  }
});

test("composeTask sends Auto instead of openai when no saved model exists on the board or writer", async () => {
  const dom = new JSDOM("");
  const saved = ["DOMParser", "fetch"].map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]);
  const writes = [];
  global.DOMParser = dom.window.DOMParser;
  global.fetch = async (url, options) => {
    writes.push({ url, body: JSON.parse(options.body) });
    return {
      ok: true,
      text: async () => '<h1 id="ai-generated-task-title">Task title</h1><p>Task body.</p>',
    };
  };
  try {
    const { createComposedTask } = loadModule("src/lib/ai/composeTask.ts", {
      axios: { default: { get: async () => ({ data: { sectionId: 12, section: "Todo", ranking: "a" } }) } },
      "@/lib/deriveCurrentBoardBilling": { deriveCurrentBoardBilling: () => ({ byokProviderFlags: [] }) },
      "@/utils/helperFunctions/Views/ViewsHelperFunctions": { getActiveFiltersFromProject: () => undefined },
      "@/utils/helperFunctions/Views/NewTaskViewDefaults": { getNewTaskViewDefaults: () => ({}) },
      "@/lib/createTaskAttachmentUploads": {
        startCreateTaskUpload: () => ({ id: "1", promise: Promise.resolve({ url: "https://files.hypertask.app/a" }) }),
        createTaskUploadById() {},
        retryCreateTaskUpload() {},
        bindCreateTaskUploads() {},
      },
      "@/utils/api/global/apiHelpers/createTaskGloballycontroller": {
        default: async (body) => ({
          resposne: { newTask: { id: 91, uniqueIndex: 44, projectId: body.projectId, sectionId: body.sectionId, ticketNumber: "HTPR-44" } },
        }),
      },
    });
    await createComposedTask({
      text: "Write release notes",
      files: [],
      project: { id: 7, uniqueIdentifier: "HTPR", teamId: "team-a", ai_custom_instructions: [] },
      userId: 985,
    });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].body.modelOptionId, "auto");
    assert.equal(writes[0].body.sourceSelected, undefined);
    assert.equal(writes[0].body.modelSelected, undefined);
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
    dom.window.close();
  }
});

test("one-time migration resets saved non-auto picks to auto while keeping imageGeneration and thinking", (t) => {
  const migrationFile = path.join(
    root,
    "src/prisma/migrations/20261125120000_htpr_9685_reset_saved_models_to_auto/migration.sql",
  );
  assert.equal(fs.existsSync(migrationFile), true);
  const docker = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
    encoding: "utf8",
    timeout: 15_000,
  });
  if (!docker.stdout?.trim()) {
    if (process.env.HT_REQUIRE_PG_TESTS === "1") assert.fail("Docker is required");
    t.skip("Docker is unavailable");
    return;
  }

  const container = `htpr-9685-auto-reset-${process.pid}-${Date.now()}`;
  const image =
    process.env.HTPR_PG_IMAGE ||
    "ghcr.io/hypertask-ai/ci-postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea";
  const sql = fs.readFileSync(migrationFile, "utf8");
  const runSql = (input) =>
    spawnSync(
      "docker",
      ["exec", "-i", container, "psql", "-h", "/tmp", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At"],
      { input, encoding: "utf8", timeout: 30_000 },
    );

  try {
    const started = spawnSync(
      "docker",
      [
        "run", "-d", "--rm", "--name", container, "--network", "none", "--user", "postgres",
        "--tmpfs", "/tmp:rw,mode=1777",
        image,
        "sh", "-c",
        "initdb -D /tmp/db -A trust >/dev/null 2>&1 && pg_ctl -D /tmp/db -l /tmp/pg.log -o \"-c listen_addresses='' -k /tmp\" -w start >/dev/null && exec tail -f /dev/null",
      ],
      { encoding: "utf8", timeout: 30_000 },
    );
    assert.equal(started.status, 0, started.stderr);

    for (let i = 0; i < 40; i += 1) {
      const ready = spawnSync("docker", ["exec", container, "pg_isready", "-h", "/tmp", "-U", "postgres"], {
        timeout: 5_000,
      });
      if (ready.status === 0) break;
      spawnSync("sleep", ["0.25"]);
    }

    const setup = runSql(`
      CREATE TABLE "UserSetting" ("userId" INTEGER PRIMARY KEY, "aiModelPreferences" JSONB);
      CREATE TABLE "AI_Custom_Instructions" ("id" SERIAL PRIMARY KEY, "model_selected" TEXT, "source_selected" TEXT);
      CREATE TABLE htpr_7038_model_choice_reset_done (user_id INTEGER PRIMARY KEY);
      INSERT INTO "UserSetting" ("userId", "aiModelPreferences") VALUES
        (1, '{"aiChat":"claude-haiku-5-5","taskWriter":"gpt-6-luna","imageGeneration":"nano-banana","thinking":{"enabled":true,"effort":"low"},"teams":{"t1":{"aiChat":"gpt-6.1-sol","writeWithAi":"auto","imageGeneration":"gpt-image"}}}'),
        (2, '{"aiChat":"auto"}'),
        (3, NULL);
      INSERT INTO "AI_Custom_Instructions" ("model_selected", "source_selected") VALUES
        ('gpt-6-luna', 'openai'),
        ('auto', NULL),
        (NULL, NULL);
    `);
    assert.equal(setup.status, 0, setup.stderr);

    const migrated = runSql(sql);
    assert.equal(migrated.status, 0, migrated.stderr);

    const checkUser1 = JSON.parse(runSql('SELECT "aiModelPreferences"::text FROM "UserSetting" WHERE "userId" = 1;').stdout.trim());
    assert.equal(checkUser1.aiChat, "auto");
    assert.equal(checkUser1.taskWriter, "auto");
    assert.equal(checkUser1.imageGeneration, "nano-banana");
    assert.deepEqual(checkUser1.thinking, { enabled: true, effort: "low" });
    assert.equal(checkUser1.teams.t1.aiChat, "auto");
    assert.equal(checkUser1.teams.t1.writeWithAi, "auto");
    assert.equal(checkUser1.teams.t1.imageGeneration, "gpt-image");

    const instructions = runSql('SELECT COALESCE("model_selected", \'<null>\') || \'|\' || COALESCE("source_selected", \'<null>\') FROM "AI_Custom_Instructions" ORDER BY id;').stdout.trim().split("\n");
    assert.deepEqual(instructions, ["auto|<null>", "auto|<null>", "<null>|<null>"]);

    const markers = runSql("SELECT count(*) FROM htpr_7038_model_choice_reset_done;").stdout.trim();
    assert.equal(markers, "3");

    const repeat = runSql(sql);
    assert.equal(repeat.status, 0, repeat.stderr);
  } finally {
    spawnSync("docker", ["rm", "-f", container], { stdio: "ignore", timeout: 15_000 });
  }
});
