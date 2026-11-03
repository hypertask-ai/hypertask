const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const optionId = "deepseek-v4.1-flash-fast";
const gatewaySlug = "deepseek/deepseek-v4.1-flash-1017-fast";
const flagKey = "htpr-7730-deepseek-flash-fast";
const originalCache = new Map(Object.entries(require.cache));
let jitiEntryId = 0;

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/jiti-deepseek-flash-fast-${++jitiEntryId}.cjs`),
    { interopDefault: true, fsCache: false, alias: { "@": path.join(root, "src") } },
  );
  return jiti(path.join(root, relativePath));
}

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

test.afterEach(() => {
  for (const filename of Object.keys(require.cache)) {
    if (!originalCache.has(filename)) delete require.cache[filename];
  }
  for (const [filename, cached] of originalCache) require.cache[filename] = cached;
});

test("Flash Fast is a distinct gateway option immediately after snapshot-pinned Flash", () => {
  const catalog = loadTs("src/lib/aiModelOptions.ts");
  const option = catalog.getAiModelOptionById(optionId);
  assert.deepEqual(option, {
    id: optionId,
    source: "gateway",
    title: "DeepSeek V4.1 Flash Fast",
    model: gatewaySlug,
    desc: "Fast cheap general model",
    reasoning: "instant",
    modelKey: optionId,
  });
  assert.deepEqual(catalog.getAiModelDefinition(optionId), {
    key: optionId,
    modelClass: "deepseek-flash-fast",
    label: "DeepSeek V4.1 Flash Fast",
    provider: "deepseek",
    priceTier: 2,
  });
  assert.equal(catalog.aiModelDefinitions.filter((model) => model.modelClass === "deepseek-flash-fast").length, 1);
  assert.equal(catalog.aiModelDefinitions[catalog.aiModelDefinitions.findIndex((model) => model.key === optionId) - 1].key, "deepseek-v4.1-flash");
  assert.equal(catalog.aiModelOptions[catalog.aiModelOptions.indexOf(option) - 1].id, "deepseek-v4.1-flash");
  assert.deepEqual(catalog.getAiModelOptionById("deepseek-v4.1-flash"), {
    id: "deepseek-v4.1-flash",
    source: "gateway",
    title: "DeepSeek V4.1 Flash",
    model: "deepseek/deepseek-v4.1-flash-1017",
    directModel: "deepseek-flash",
    desc: "Cheapest general model",
    reasoning: "instant",
    modelKey: "deepseek-v4.1-flash",
  });
  for (const legacyId of ["deepseek-v4-flash", "deepseek/deepseek-v4-flash", "deepseek/deepseek-v4.1-flash"]) {
    assert.equal(catalog.getAiModelOptionById(legacyId).id, "deepseek-v4.1-flash");
  }
});

test("the ticket feature flag is client-safe and live for Everyone by default", () => {
  const flag = loadTs("src/lib/flags/definitions/htpr-7730-deepseek-flash-fast.ts");
  const definition = flag.default ?? flag;
  assert.equal(flag.HTPR_7730_DEEPSEEK_FLASH_FAST_FLAG, flagKey);
  assert.equal(definition.key, flagKey);
  assert.equal(definition.kind, "feature");
  assert.equal(definition.defaultMode, "OWNER_AND_QA");
  assert.equal(definition.releaseRisk.risk, "new");
  assert.equal(definition.releaseRisk.highRisk, "money");
  assert.ok(definition.releaseRisk.reason);
  assert.ok(definition.description);
  assert.match(definition.shippedOn, /^\d{4}-\d{2}-\d{2}$/);
});

test("shared picker filtering hides only Fast when Off and restores it when On", () => {
  const catalog = loadTs("src/lib/aiModelOptions.ts");
  const option = catalog.getAiModelOptionById(optionId);
  for (const haiku55Enabled of [false, true]) {
    const visible = (enabled) => catalog.aiModelOptions.filter((candidate) =>
      catalog.isAiModelOptionVisible(candidate, haiku55Enabled, enabled));
    assert.equal(catalog.isAiModelOptionVisible(option, haiku55Enabled), false);
    assert.equal(visible(false).includes(option), false);
    assert.equal(visible(true).includes(option), true);
    assert.deepEqual(visible(true).filter((candidate) => candidate !== option), visible(false));
    assert.equal(visible(false).some((candidate) => candidate.id === "deepseek-v4.1-flash"), true);
  }
});

test("saved and requested Fast choices use each plan default while Off", () => {
  const catalog = loadTs("src/lib/aiModelOptions.ts");
  stubModule("src/app/api/ai/_lib/providerGate.ts", { filterModelOptionForTeam: (option) => option });
  stubModule("src/app/api/ai/_lib/modelProvider.ts", {});
  const models = loadTs("src/lib/ai/chatStream/models.ts");
  const settings = { providers: { deepseek: true } };
  for (const plan of ["Free", "Pro", "AI", "BYOK"]) {
    for (const haiku55Enabled of [false, true]) {
      const planDefault = catalog.getDefaultAiModelOptionForPlan(plan, true, haiku55Enabled);
      for (const enabled of [false, true]) {
        const expectedId = enabled ? optionId : planDefault.id;
        assert.equal(catalog.resolveAiModelOption([optionId], planDefault, haiku55Enabled, enabled).id, expectedId);
        assert.equal(models.resolveModelSelection("gateway", gatewaySlug, optionId, settings, "aiChat", null, planDefault, haiku55Enabled, enabled).modelOption.id, expectedId);
        assert.equal(models.defaultModelSelection(settings, "aiChat", optionId, true, planDefault, haiku55Enabled, enabled).modelOption.id, expectedId);
        assert.equal(models.defaultModelSelection({ ...settings, featureModels: { aiChat: optionId } }, "aiChat", null, true, planDefault, haiku55Enabled, enabled).modelOption.id, expectedId);
      }
    }
  }
});

test("Fast credentials preserve customer gateway keys and replace direct keys with gateway funding", async () => {
  stubModule("src/lib/ai/teamAiFunding.ts", require("./helpers/team-ai-funding-stub.cjs"));
  stubModule("src/lib/flags.ts", { isFeatureEnabled: async () => false });
  const catalog = loadTs("src/lib/aiModelOptions.ts");
  let gatewayKey = "vck_team_gateway";
  let deepseekKey = "sk-direct-deepseek";
  let agentKey = null;
  let gdprSafeMode = false;
  const keyLookups = [];
  stubModule("src/lib/prisma.ts", {
    default: {
      team: { findUnique: async () => ({ aiProviderSettings: { gdprSafeMode, providers: { deepseek: true } } }) },
      teamByokApiKey: { findUnique: async ({ where }) => {
        const provider = where.teamId_provider.provider;
        keyLookups.push(provider);
        const key = provider === "gateway" ? gatewayKey : provider === "deepseek" ? deepseekKey : null;
        return key ? { enabled: true, ciphertext: key } : null;
      } },
      agentByokApiKey: { findUnique: async () => agentKey ? { enabled: true, ciphertext: agentKey } : null },
    },
  });
  stubModule("src/lib/crypto/byokCipher.ts", { decryptByokSecret: (value) => value });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", {});
  stubModule("src/app/api/ai/_lib/planGate.ts", { storePlanIdForProject: async () => "Pro" });
  stubModule("src/app/api/ai/_lib/modelProvider.ts", {
    isVercelAiGatewayKey: (key) => typeof key === "string" && key.startsWith("vck_"),
    registerManagedGatewayKey: () => {},
  });
  const { getByokOrTeamGatewayApiKeyForModelOption } = loadTs("src/app/api/ai/_lib/byokKeys.ts");
  const option = catalog.getAiModelOptionById(optionId);
  const lookup = { trustedTeamId: "fixture-team", agentId: "fixture-agent", userId: 985 };
  const flags = [{ provider: "deepseek", enabled: true, ciphertext: "sk-request-deepseek" }];
  assert.equal(await getByokOrTeamGatewayApiKeyForModelOption(option, flags, lookup), gatewayKey);
  assert.deepEqual(keyLookups, ["deepseek", "gateway"]);
  keyLookups.length = 0;
  deepseekKey = "vck_deepseek_slot";
  assert.equal(await getByokOrTeamGatewayApiKeyForModelOption(option, undefined, lookup), deepseekKey);
  assert.deepEqual(keyLookups, ["deepseek"]);
  assert.equal(await getByokOrTeamGatewayApiKeyForModelOption(option, flags, lookup), deepseekKey);
  agentKey = "vck_agent_deepseek";
  assert.equal(await getByokOrTeamGatewayApiKeyForModelOption(option, flags, lookup), agentKey);
  agentKey = "sk-agent-deepseek";
  assert.equal(await getByokOrTeamGatewayApiKeyForModelOption(option, flags, lookup), deepseekKey);
  deepseekKey = "sk-direct-deepseek";
  assert.equal(await getByokOrTeamGatewayApiKeyForModelOption(option, flags, lookup), gatewayKey);
  agentKey = null;
  assert.equal(await getByokOrTeamGatewayApiKeyForModelOption(option, undefined, lookup), gatewayKey);
  deepseekKey = null;
  assert.equal(await getByokOrTeamGatewayApiKeyForModelOption(option, undefined, lookup), gatewayKey);
  gatewayKey = undefined;
  assert.equal(await getByokOrTeamGatewayApiKeyForModelOption(option, flags, lookup), undefined);
  gdprSafeMode = true;
  gatewayKey = "vck_team_gateway";
  assert.equal(await getByokOrTeamGatewayApiKeyForModelOption(option, flags, lookup), undefined);
});

test("the model resolver refuses direct credentials even without an option object", () => {
  stubModule("src/app/api/ai/_lib/sharedAllowance.ts", { gatewayCatalogModelSlug: (slug) => slug });
  stubModule("src/app/api/ai/_lib/aiUsage.ts", {});
  stubModule("src/lib/telemetry/aiChatObservability.ts", {});
  stubModule("src/lib/errors/reportError.ts", {});
  const catalog = loadTs("src/lib/aiModelOptions.ts");
  const { resolveAiModel } = loadTs("src/app/api/ai/_lib/modelProvider.ts");
  for (const option of [undefined, catalog.getAiModelOptionById(optionId)]) {
    assert.throws(() => resolveAiModel("gateway", gatewaySlug, "sk-direct-deepseek", option), /dedicated team AI Gateway key/);
    assert.throws(() => resolveAiModel("gateway", gatewaySlug, undefined, option), /dedicated team AI Gateway key/);
    const model = resolveAiModel("gateway", gatewaySlug, "vck_customer_gateway", option);
    assert.equal(model.provider, "gateway");
    assert.equal(model.modelId, gatewaySlug);
  }
});

test("the exact Fast slug uses live gateway catalog pricing without a model override", async () => {
  const previousFetch = global.fetch;
  stubModule("src/lib/redis.ts", { getRedis: async () => null });
  stubModule("src/lib/flags.ts", { isFeatureEnabled: async () => false });
  const requests = [];
  global.fetch = async (url) => {
    requests.push(url);
    return { ok: true, json: async () => ({ data: [{ id: gatewaySlug, pricing: { input: "0.0000006", output: "0.0000024" } }] }) };
  };
  try {
    const { gatewayCatalogModelSlug, modelPricing } = loadTs("src/app/api/ai/_lib/sharedAllowance.ts");
    assert.equal(gatewayCatalogModelSlug(gatewaySlug), gatewaySlug);
    assert.deepEqual(await modelPricing(gatewaySlug), { inputUsdPerToken: 0.0000006, outputUsdPerToken: 0.0000024 });
    assert.deepEqual(requests, ["https://ai-gateway.vercel.sh/v1/models"]);
  } finally {
    global.fetch = previousFetch;
  }
});

test("Settings model responses and writes honor the authenticated user's flag", async () => {
  let enabled = false;
  let settings = { providers: { deepseek: true }, featureModels: { aiChat: optionId } };
  const checks = [];
  stubModule("src/lib/flags.ts", { isFeatureEnabled: async (key, userId) => {
    checks.push([key, userId]);
    return enabled;
  } });
  stubModule("src/lib/auth/getSessionUser.ts", { getSessionUser: async () => ({ userId: 985 }) });
  stubModule("src/lib/prisma.ts", { default: { user: { findUnique: async () => ({ id: 985, accountId: 42 }) } } });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", {});
  stubModule("src/app/api/ai/_lib/planGate.ts", { haiku55ModelEnabled: async () => true });
  stubModule("src/app/api/ai/_lib/byokKeys.ts", {
    resolveTeamCustomEndpoint: async () => undefined,
    getAiDefaultModelContext: async () => ({ plan: "Pro", hasByok: false }),
  });
  stubModule("src/utils/controllers/teams/getTeamAiSettingsForViewer.ts", { getTeamAiSettingsForViewer: async () => ({ ok: true, settings }) });
  stubModule("src/utils/controllers/teams/assertTeamByokAccess.ts", { assertUserCanManageTeamByok: async () => ({ ok: true }) });
  stubModule("src/utils/controllers/teams/updateTeamAiSettingsAtomically.ts", {
    updateTeamAiSettingsAtomically: async (_teamId, update) => (settings = update(settings)),
  });
  const route = loadTs("src/pages/api/teams/aiFeatureModels.ts");
  const handler = route.default ?? route;
  const request = async (method) => {
    let status, body;
    await handler({ method, headers: {}, query: { teamId: "fixture-team" }, body: { teamId: "fixture-team", feature: "aiChat", model: optionId } }, {
      status: (code) => { status = code; return { json: (value) => { body = value; } }; },
    });
    assert.equal(status, 200);
    return body;
  };
  const hidden = await request("GET");
  assert.equal(hidden.aiChat.model, null);
  assert.equal(hidden.aiChat.effectiveModel, "claude-haiku-5-5");
  settings.providers.anthropic = false;
  const filtered = await request("GET");
  const catalog = loadTs("src/lib/aiModelOptions.ts");
  assert.notEqual(catalog.getAiModelDefinition(catalog.getAiModelOptionById(filtered.aiChat.effectiveModel).modelKey).provider, "anthropic");
  delete settings.providers.anthropic;
  enabled = true;
  const shown = await request("GET");
  assert.equal(shown.aiChat.model, optionId);
  assert.equal(shown.aiChat.effectiveModel, optionId);
  enabled = false;
  const fallback = await request("POST");
  assert.equal(fallback.aiChat.model, null);
  assert.equal(fallback.aiChat.effectiveModel, "claude-haiku-5-5");
  enabled = true;
  assert.equal((await request("POST")).aiChat.model, optionId);
  assert.deepEqual(checks.filter(([key]) => key === flagKey), Array.from({ length: 5 }, () => [flagKey, 985]));
});
