const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false });
const providers = load(path.join(root, "src/lib/aiProviders.ts"));
const catalog = load(path.join(root, "src/lib/aiModelOptions.ts"));
const customEndpoint = load(path.join(root, "src/lib/ai/customEndpoint.ts"));
const flag = load(path.join(root, "src/lib/flags/definitions/htpr-7732-baseten-byok.ts"));
const providerSyncFlag = load(path.join(root, "src/lib/flags/definitions/htpr-7741-byok-enables-provider.ts"));
const flagKey = "htpr-7732-baseten-byok";
const fakeKey = "fake-baseten-team-secret";
const lookup = { trustedTeamId: "fixture-team", userId: 985 };
const expectedMap = {
  "deepseek-v4.1-flash": "deepseek-ai/DeepSeek-V4.1-Flash-1017",
  "deepseek-v4.1-flash-fast": "deepseek-ai/DeepSeek-V4.1-Flash-1017-Fast",
  "kimi-k3": "moonshotai/Kimi-K3",
  "glm-5.3-flash": "zai-org/GLM-5.3-Flash",
};

function loadModule(relativePath, stubs) {
  const filename = path.join(root, relativePath);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: false },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(code, {
    module: loadedModule, exports: loadedModule.exports,
    require: (id) => {
      assert.ok(Object.hasOwn(stubs, id), `Unexpected dependency: ${id}`);
      return stubs[id];
    },
    Headers, AbortController, setTimeout, clearTimeout, Date, console,
    process: { env: { AI_GATEWAY_API_KEY: "vck_fake-shared" } },
  }, { filename });
  return loadedModule.exports;
}

function routingHarness({ enabled = true, plan = "Pro", saved = true, keyEnabled = true, gdpr = false, providerEnabled = true, nativeKey, gatewayKey, legacyGateway, accessible = true, agentKey } = {}) {
  const calls = { keys: [], agent: [], flags: [], decrypted: [] };
  const settings = { gdprSafeMode: gdpr, providers: { deepseek: providerEnabled, moonshot: providerEnabled, zhipu: providerEnabled } };
  const api = loadModule("src/app/api/ai/_lib/byokKeys.ts", {
    ai: {},
    "@/lib/prisma": { default: {
      team: {
        findUnique: async () => ({ aiProviderSettings: settings }),
        findFirst: async () => accessible ? { id: "fixture-team" } : null,
      },
      project: { findFirst: async () => accessible ? { teamId: "fixture-team" } : null },
      teamByokApiKey: { findUnique: async ({ where }) => {
        const { teamId, provider } = where.teamId_provider;
        calls.keys.push({ teamId, provider });
        if (teamId !== "fixture-team") return null;
        const ciphertext = provider === "baseten" ? (saved ? fakeKey : null)
          : provider === "gateway" ? gatewayKey
          : provider === "openai" ? legacyGateway
          : ["deepseek", "moonshot", "zhipu"].includes(provider) ? nativeKey
          : provider === "managed_gateway" ? "vck_fake-managed" : null;
        return ciphertext ? { enabled: provider === "baseten" ? keyEnabled : true, ciphertext, team: { aiProviderSettings: settings } } : null;
      } },
      agentByokApiKey: { findUnique: async ({ where }) => {
        calls.agent.push(where.agentId_provider.provider);
        return agentKey ? { enabled: true, ciphertext: agentKey } : null;
      } },
    } },
    "@/lib/flags/definitions/htpr-7732-baseten-byok": flag,
    "@/lib/flags/definitions/htpr-7634-openai-only-default": {},
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => { calls.flags.push([key, userId]); return enabled; } },
    "@/lib/crypto/byokCipher": { decryptByokSecret: (value) => { calls.decrypted.push(value); return value; } },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
    "@/app/api/ai/_lib/modelProvider": {
      isVercelAiGatewayKey: (key) => typeof key === "string" && key.startsWith("vck_"),
      registerManagedGatewayKey: () => {},
    },
    "@/lib/aiModelOptions": catalog,
    "@/lib/aiProviders": providers,
    "@/lib/ai/customEndpoint": customEndpoint,
    "@/app/api/ai/_lib/managedGatewayKeys": { MANAGED_TEAM_GATEWAY_PROVIDER: "managed_gateway" },
    "@/app/api/ai/_lib/planGate": { storePlanIdForProject: async () => plan },
    "@/app/api/ai/chat/stream/modelFallback": {},
    "@/lib/ai/teamAiFunding": require("./helpers/team-ai-funding-stub.cjs"),
  });
  return { api, calls };
}

function settingsHarness({ enabled = true, paid = true, gdpr = false, allowed = true } = {}) {
  const writes = [], decrypted = [];
  const settings = { gdprSafeMode: gdpr };
  const transaction = { teamByokApiKey: {
    findMany: async () => [{ provider: "baseten", enabled: true, ciphertext: fakeKey }],
    upsert: async (value) => writes.push(value),
    deleteMany: async (value) => writes.push(value),
  } };
  const api = loadModule("src/pages/api/teams/byokKeys.ts", {
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => { assert.ok([flagKey, providerSyncFlag.HTPR_7741_BYOK_ENABLES_PROVIDER_FLAG].includes(key)); assert.equal(userId, 985); return key === flagKey ? enabled : true; } },
    "@/lib/flags/definitions/htpr-7741-byok-enables-provider": providerSyncFlag,
    "@/lib/flags/definitions/htpr-7732-baseten-byok": flag,
    "@/lib/prisma": { default: {
      user: { findUnique: async () => ({ id: 985 }) },
      team: { findUnique: async () => ({ googleAccount: { userId: allowed ? 985 : 1 }, members: [] }) },
    } },
    "@/lib/crypto/byokCipher": {
      decryptByokSecret: (value) => { decrypted.push(value); return value; },
      encryptByokSecret: (value) => `encrypted:${value}`,
    },
    "@/lib/crypto/maskByokSecret": { maskByokSecret: (value) => `masked:${value.slice(-4)}` },
    "@/lib/aiProviders": providers,
    "@/utils/controllers/teams/assertTeamByokAccess": { assertUserCanManageTeamByok: async () => allowed ? { ok: true } : { ok: false, status: 403, message: "Forbidden" } },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 985 }) },
    "@/lib/freeTier": { isPaidTeam: async () => paid },
    "@/utils/controllers/teams/updateTeamAiSettingsAtomically": { withLockedTeamAiSettings: async (_teamId, update) => update(transaction, settings) },
    "@/lib/ai/customEndpoint": customEndpoint,
  }).default;
  return { writes, decrypted, request: async (method, body = {}) => {
    let status, result;
    await api({ method, headers: {}, query: { teamId: "fixture-team" }, body: { teamId: "fixture-team", provider: "baseten", ...body } }, {
      status(code) { status = code; return this; },
      json(value) { result = value; },
    });
    assert.ok(!JSON.stringify(result).includes(fakeKey));
    return { status, body: result };
  } };
}

function testKeyHarness({ enabled = true, paid = true, gdpr = false, allowed = true, responseStatus = 200, networkError = false } = {}) {
  const calls = { keys: 0, network: [], settings: 0 };
  let settings = { gdprSafeMode: gdpr };
  const api = loadModule("src/app/api/settings/byok-test/route.ts", {
    zod: require("zod"),
    "@/app/api/ai/_lib/aiUsage": { logAiUsage: async () => {} },
    "@/lib/flags": { isFeatureEnabled: async () => enabled },
    "@/lib/flags/definitions/htpr-7732-baseten-byok": flag,
    "@/lib/net/fetchWithoutBrotli": { fetchWithoutBrotli: async (url, init) => {
      calls.network.push({ url, init });
      if (networkError) throw new Error(`Provider echoed ${fakeKey}`);
      return { status: responseStatus, text: async () => `Provider echoed ${fakeKey}` };
    } },
    "@/app/api/ai/_lib/planGate": { haiku55ModelEnabled: async () => false },
    "next/server": { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } },
    "node:crypto": { randomUUID: () => "fake-lease-id" },
    "@/app/api/ai/_lib/byokKeys": { resolveTeamByokApiKey: async () => { calls.keys++; return fakeKey; } },
    "@/lib/auth/serverUser": { getServerCookieUser: async () => ({ id: 985 }) },
    "@/lib/aiProviders": providers,
    "@/utils/controllers/teams/assertTeamByokAccess": { assertUserCanManageTeamByok: async () => allowed ? { ok: true } : { ok: false, status: 403, message: "Forbidden" } },
    "@/lib/freeTier": { isPaidTeam: async () => paid },
    "./providerTest": load(path.join(root, "src/app/api/settings/byok-test/providerTest.ts")),
    "@/lib/ai/customEndpoint": customEndpoint,
    "@/utils/controllers/teams/updateTeamAiSettingsAtomically": { updateTeamAiSettingsAtomically: async (_teamId, update) => { calls.settings++; return (settings = update(settings)); } },
  });
  return { calls, request: (body = {}) => api.POST({ json: async () => ({ teamId: "fixture-team", provider: "baseten", ...body }) }) };
}

test("Baseten is BYOK-only with exactly four installed mappings and a money-risk Owner + QA feature flag", () => {
  assert.deepEqual(providers.BASETEN_MODEL_SLUGS, expectedMap);
  assert.equal(providers.BYOK_PROVIDER_KEYS.filter((key) => key === "baseten").length, 1);
  assert.equal(providers.isByokProviderKey("baseten"), true);
  assert.equal(providers.AI_PROVIDERS.some((provider) => provider.key === "baseten"), false);
  assert.equal(providers.isByokProviderRestrictedInGdprSafeMode("baseten"), true);
  assert.equal(providers.BASETEN_BYOK_PROVIDER.keyUrl, "https://app.baseten.co/settings/api_keys");
  assert.equal(providers.BASETEN_BYOK_PROVIDER.badge, "Aggregator");
  for (const key of Object.keys(expectedMap)) assert.equal(catalog.getAiModelOptionById(key).modelKey, key);
  const definition = flag.default ?? flag;
  assert.equal(flag.HTPR_7732_BASETEN_BYOK_FLAG, flagKey);
  assert.equal(definition.key, flagKey);
  assert.equal(definition.kind, "feature");
  assert.equal(definition.defaultMode, "OWNER_AND_QA");
  assert.equal(definition.releaseRisk.risk, "new");
  assert.match(definition.releaseRisk.reason, /Only teams that save a Baseten key/);
  assert.equal(definition.releaseRisk.highRisk, "money");
});

test("all four options use only the enabled saved paid-team Baseten key before platform funding", async () => {
  for (const plan of ["Pro", "AI", "BYOK"]) {
    const h = routingHarness({ plan });
    for (const modelKey of Object.keys(expectedMap)) {
      const credential = await h.api.getByokOrTeamGatewayApiKeyForModelOption(catalog.getAiModelOptionById(modelKey), [{ provider: "baseten", enabled: true, ciphertext: "fake-request-key" }], { ...lookup, agentId: "fixture-agent" });
      assert.equal(credential.kind, "baseten");
      assert.equal(credential.apiKey, fakeKey);
      assert.equal(credential.modelKey, modelKey);
    }
    assert.ok(h.calls.flags.every(([key, userId]) => key === flagKey && userId === 985));
    assert.equal(h.calls.agent.includes("baseten"), false);
    assert.equal(h.calls.decrypted.includes("fake-request-key"), false);
  }
});

test("native, native-agent and customer gateway credentials retain precedence", async () => {
  for (const modelKey of Object.keys(expectedMap)) {
    const option = catalog.getAiModelOptionById(modelKey);
    const customer = routingHarness({ gatewayKey: "vck_fake-customer" });
    assert.equal(await customer.api.getByokOrTeamGatewayApiKeyForModelOption(option, [], lookup), "vck_fake-customer");
    const legacy = routingHarness({ legacyGateway: "vck_fake-legacy" });
    assert.equal(await legacy.api.getByokOrTeamGatewayApiKeyForModelOption(option, [], lookup), "vck_fake-legacy");
    const native = routingHarness({ nativeKey: "fake-native", gatewayKey: "vck_fake-customer" });
    assert.equal(await native.api.getByokOrTeamGatewayApiKeyForModelOption(option, [], lookup), modelKey.endsWith("-fast") ? "vck_fake-customer" : "fake-native");
    const agent = routingHarness({ agentKey: "fake-native-agent", gatewayKey: "vck_fake-customer" });
    assert.equal(await agent.api.getByokOrTeamGatewayApiKeyForModelOption(option, [], { ...lookup, agentId: "fixture-agent" }), modelKey.endsWith("-fast") ? "vck_fake-customer" : "fake-native-agent");
  }
});

test("off, missing, disabled, Free, GDPR and disabled native-provider cases never route to Baseten", async () => {
  for (const config of [{ enabled: false }, { saved: false }, { keyEnabled: false }, { plan: "Free" }, { gdpr: true }, { providerEnabled: false }]) {
    const h = routingHarness({ ...config, gatewayKey: "vck_fake-customer" });
    for (const modelKey of Object.keys(expectedMap)) {
      const credential = await h.api.getByokOrTeamGatewayApiKeyForModelOption(catalog.getAiModelOptionById(modelKey), [{ provider: "baseten", enabled: true, ciphertext: "fake-request-key" }], lookup);
      assert.notEqual(credential?.kind, "baseten");
      assert.notEqual(credential, fakeKey);
      if (config.enabled === false || config.saved === false || config.keyEnabled === false) assert.equal(credential, "vck_fake-customer");
      if (config.gdpr) assert.equal(credential, undefined);
    }
    if (config.enabled === false || config.plan === "Free") assert.equal(h.calls.keys.some(({ provider }) => provider === "baseten"), false);
  }
});

test("unmapped models, caller ciphertext, agent overrides and inaccessible teams cannot select a Baseten key", async () => {
  const h = routingHarness();
  for (const modelKey of ["deepseek-v4-pro", "gpt-6-luna"]) {
    const credential = await h.api.getByokOrTeamGatewayApiKeyForModelOption(catalog.getAiModelOptionById(modelKey), [], lookup);
    assert.equal(credential, "vck_fake-managed");
  }
  assert.equal(h.calls.keys.some(({ provider }) => provider === "baseten"), false);
  assert.equal(await h.api.resolveAgentByokApiKey("baseten", { ...lookup, agentId: "fixture-agent" }), undefined);
  const missing = routingHarness({ saved: false, agentKey: "fake-agent-key" });
  assert.equal(await missing.api.getByokApiKeyForProvider("baseten", [{ provider: "baseten", enabled: true, ciphertext: "fake-request-key" }], { ...lookup, agentId: "fixture-agent" }), undefined);
  assert.equal(missing.calls.agent.length, 0);
  for (const context of [{ teamId: "other-team", userId: 985 }, { projectId: 15, userId: 985 }, { ...lookup, trustedTeamId: "other-team" }]) {
    const denied = routingHarness({ accessible: false });
    assert.equal(await denied.api.getByokApiKeyForProvider("baseten", [], context), undefined);
    assert.equal(denied.calls.decrypted.includes(fakeKey), false);
  }
});

test("settings GET hides Baseten while off or GDPR-safe and only returns a mask while on", async () => {
  for (const config of [{ enabled: false }, { gdpr: true }, {}]) {
    const h = settingsHarness(config);
    const result = await h.request("GET");
    assert.equal(result.status, 200);
    const key = result.body.keys.find((row) => row.provider === "baseten");
    if (config.enabled === false || config.gdpr) {
      assert.equal(key, undefined);
      assert.equal(h.decrypted.length, 0);
    } else {
      assert.equal(key.maskedKey, "masked:cret");
      assert.equal(key.hasSecret, true);
    }
  }
});

test("save and enable require server flag, plan, authorization and GDPR permission", async () => {
  for (const [config, status] of [[{ enabled: false }, 403], [{ paid: false }, 402], [{ allowed: false }, 403], [{ gdpr: true }, 400], [{}, 200]]) {
    for (const body of [{ apiKey: fakeKey }, { enabled: true }, { enabled: false, apiKey: fakeKey }]) {
      const h = settingsHarness(config);
      assert.equal((await h.request("POST", body)).status, status);
      assert.equal(h.writes.length, status === 200 ? 1 : 0);
      if (status === 200 && body.apiKey) assert.equal(h.writes[0].create.ciphertext, `encrypted:${fakeKey}`);
    }
  }
});

test("rollback still allows authorized removal and disable even on Free or in GDPR safe mode", async () => {
  for (const body of [{ clearSecret: true }, { enabled: false }]) {
    const h = settingsHarness({ enabled: false, paid: false, gdpr: true });
    assert.equal((await h.request("POST", body)).status, 200);
    assert.equal(h.writes.length, 1);
    const denied = settingsHarness({ enabled: false, allowed: false });
    assert.equal((await denied.request("POST", body)).status, 403);
    assert.equal(denied.writes.length, 0);
  }
});

test("Test key refuses flag-off, Free, unauthorized and GDPR-safe calls before any network", async () => {
  for (const [config, status] of [[{ enabled: false }, 403], [{ paid: false }, 402], [{ allowed: false }, 403], [{ gdpr: true }, 409]]) {
    const h = testKeyHarness(config);
    const result = await h.request();
    assert.equal(result.status, status);
    assert.equal(h.calls.network.length, 0);
    if (!config.gdpr) assert.equal(h.calls.keys, 0);
    assert.ok(!JSON.stringify(result).includes(fakeKey));
  }
});

test("Test key probes Flash with Bearer auth and never returns a provider-echoed key", async () => {
  for (const [config, expected] of [[{}, "works"], [{ responseStatus: 401 }, "invalid"], [{ responseStatus: 402 }, "no_credit"], [{ networkError: true }, "error"]]) {
    const h = testKeyHarness(config);
    const result = await h.request();
    assert.equal(result.body.result, expected);
    assert.equal(h.calls.network.length, 1);
    assert.equal(h.calls.settings, 2);
    const { url, init } = h.calls.network[0];
    assert.equal(url, "https://inference.baseten.co/v1/chat/completions");
    assert.equal(init.headers.Authorization, `Bearer ${fakeKey}`);
    assert.equal(JSON.parse(init.body).model, expectedMap["deepseek-v4.1-flash"]);
    assert.equal(JSON.parse(init.body).max_tokens, 1);
    assert.ok(!JSON.stringify(result).includes(fakeKey));
  }
});
