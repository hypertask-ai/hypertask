const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false });
const catalog = load(path.join(root, "src/lib/aiModelOptions.ts"));
const forced = load(path.join(root, "src/lib/ai/forcedTeamKey.ts"));
const flag = load(path.join(root, "src/lib/flags/definitions/htpr-8049-always-use-this-key.ts"));
const flagKey = "htpr-8049-always-use-this-key";
const basetenFlagKey = "htpr-7732-baseten-byok";
const lookup = { trustedTeamId: "fixture-team", userId: 985 };
const managedKey = "vck_fake-managed";

function routingHarness({ enabled = true, forcedProvider = "baseten", ownKeyOnly = false, plan = "Pro", basetenEnabled = true, gdprSafeMode = false, secrets = {} } = {}) {
  const settings = {
    ...(ownKeyOnly ? { ownKeyOnly: true } : {}),
    ...(gdprSafeMode ? { gdprSafeMode: true } : {}),
  };
  const stored = {
    baseten: "team-baseten-secret",
    deepseek: "team-deepseek-secret",
    managed_gateway: managedKey,
    ...(forcedProvider === "gateway" ? { gateway: "vck_team-gateway" } : {}),
    ...secrets,
  };
  return loadModule("src/app/api/ai/_lib/byokKeys.ts", {
    ai: {},
    "@/lib/prisma": { default: {
      team: {
        findUnique: async () => ({ aiProviderSettings: settings }),
        findFirst: async () => ({ id: "fixture-team" }),
      },
      project: { findFirst: async () => ({ teamId: "fixture-team" }) },
      teamByokApiKey: {
        findFirst: async () => forcedProvider ? { provider: forcedProvider } : null,
        findUnique: async ({ where }) => {
          const provider = where.teamId_provider.provider;
          const ciphertext = stored[provider];
          return ciphertext ? { enabled: true, ciphertext, team: { aiProviderSettings: settings } } : null;
        },
      },
      agentByokApiKey: { findUnique: async () => ({ enabled: true, ciphertext: "agent-secret" }) },
    } },
    "@/lib/flags": { isFeatureEnabled: async (key) => {
      if (key === flagKey) return enabled;
      if (key === basetenFlagKey) return basetenEnabled;
      return false;
    } },
    "@/lib/crypto/byokCipher": { decryptByokSecret: (value) => value },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
    "@/app/api/ai/_lib/modelProvider": {
      isVercelAiGatewayKey: (key) => typeof key === "string" && key.startsWith("vck_"),
      registerManagedGatewayKey: () => {},
    },
    "@/app/api/ai/_lib/planGate": { storePlanIdForProject: async () => plan, backgroundClaudeModelEnabled: async () => false, haiku55ModelEnabled: async () => false },
    "@/app/api/ai/chat/stream/modelFallback": { previousModelForFailedStream: () => null },
    "@/lib/ai/modelFundingGuard": { fallbackRunsOnOurOwnGatewayKey: () => false },
  });
}

function settingsHarness({ enabled = true, allowed = true, paid = true, basetenEnabled = true, ownKeyOnly = false } = {}) {
  const rows = {
    baseten: { enabled: true, ciphertext: "team-baseten-secret", alwaysUse: false },
    deepseek: { enabled: true, ciphertext: "team-deepseek-secret", alwaysUse: true },
  };
  const transaction = { teamByokApiKey: {
    findMany: async () => Object.entries(rows).map(([provider, row]) => ({ provider, ...row })),
    findUnique: async ({ where }) => rows[where.teamId_provider.provider] ?? null,
    updateMany: async ({ where, data }) => {
      for (const [provider, row] of Object.entries(rows)) {
        const providerMatch = where.provider ? where.provider === provider : where.NOT?.provider !== provider;
        if (where.teamId === "fixture-team" && providerMatch && (where.alwaysUse === undefined || row.alwaysUse === where.alwaysUse)) {
          Object.assign(row, data);
        }
      }
    },
    update: async ({ where, data }) => {
      Object.assign(rows[where.teamId_provider.provider], data);
    },
    upsert: async ({ where, update, create }) => {
      const provider = where.teamId_provider.provider;
      rows[provider] = rows[provider] ? { ...rows[provider], ...update } : { ...create };
    },
    deleteMany: async () => {},
  }, team: { update: async () => {} } };
  const api = loadModule("src/pages/api/teams/byokKeys.ts", {
    "@/lib/flags": { isFeatureEnabled: async (key) => {
      if (key === flagKey) return enabled;
      if (key === basetenFlagKey) return basetenEnabled;
      return true;
    } },
    "@/lib/prisma": { default: {
      user: { findUnique: async () => ({ id: 985 }) },
      team: { findUnique: async () => ({ googleAccount: { userId: allowed ? 985 : 1 }, members: [] }) },
    } },
    "@/lib/crypto/byokCipher": { decryptByokSecret: (value) => value, encryptByokSecret: (value) => value },
    "@/lib/crypto/maskByokSecret": { maskByokSecret: (value) => `masked:${value.slice(-4)}` },
    "@/utils/controllers/teams/assertTeamByokAccess": { assertUserCanManageTeamByok: async () => allowed ? { ok: true } : { ok: false, status: 403, message: "Forbidden" } },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 985 }) },
    "@/lib/freeTier": { isPaidTeam: async () => paid },
    "@/utils/controllers/teams/updateTeamAiSettingsAtomically": { withLockedTeamAiSettings: async (_teamId, update) => update(transaction, ownKeyOnly ? { ownKeyOnly: true } : {}) },
  }).default;
  return { rows, request: async (method, body = {}) => {
    let status, result;
    await api({ method, headers: {}, query: { teamId: "fixture-team" }, body: { teamId: "fixture-team", ...body } }, {
      status(code) { status = code; return this; },
      json(value) { result = value; },
    });
    return { status, body: result };
  } };
}

test("the switch is a money-risk feature flag that stays with the owner and QA until release", () => {
  const definition = flag.default;
  assert.equal(flag.HTPR_8049_ALWAYS_USE_THIS_KEY_FLAG, flagKey);
  assert.equal(definition.key, flagKey);
  assert.equal(definition.kind, "feature");
  assert.equal(definition.defaultMode, "OWNER_AND_QA");
  assert.equal(definition.releaseRisk.highRisk, "money");
  assert.match(definition.description, /Search and dictation stay on Hypertask keys/);
});

test("a forced key's models are the only ones that match, and other providers do not", () => {
  const flash = catalog.getAiModelOptionById("deepseek-v4.1-flash");
  const luna = catalog.getAiModelOptionById("gpt-6-luna");
  const pro = catalog.getAiModelOptionById("deepseek-v4-pro");
  const custom = catalog.getAiModelOptionById("custom");
  assert.equal(forced.modelOptionMatchesForcedKey(flash, "baseten"), true);
  assert.equal(forced.modelOptionMatchesForcedKey(luna, "baseten"), false);
  assert.equal(forced.modelOptionMatchesForcedKey(pro, "deepseek"), true);
  assert.equal(forced.modelOptionMatchesForcedKey(flash, "deepseek"), true);
  assert.equal(forced.modelOptionMatchesForcedKey(luna, "openai"), true);
  assert.equal(forced.modelOptionMatchesForcedKey(flash, "openai"), false);
  assert.equal(forced.modelOptionMatchesForcedKey(luna, "gateway"), true);
  assert.equal(forced.modelOptionMatchesForcedKey(custom, "gateway"), false);
  assert.equal(forced.modelOptionMatchesForcedKey(custom, "custom"), true);
  assert.equal(forced.forcedByokProvider([{ provider: "baseten", enabled: true, alwaysUse: true }, { provider: "deepseek", enabled: true, alwaysUse: false }]), "baseten");
  assert.equal(forced.forcedByokProvider([{ provider: "baseten", enabled: false, alwaysUse: true }]), null);
});

test("flag off keeps the allowance key for a model the team key does not serve", async () => {
  const api = routingHarness({ enabled: false, forcedProvider: "baseten" });
  const credential = await api.getByokOrTeamGatewayApiKeyForModelOption(catalog.getAiModelOptionById("gpt-6-luna"), [], lookup);
  assert.equal(credential, managedKey);
  const funding = await api.getTeamGatewayFunding(lookup);
  assert.equal(funding.source, "managed");
  assert.equal(funding.apiKey, managedKey);
});

test("flag on uses the forced Baseten key and refuses allowance for other models", async () => {
  const api = routingHarness({ enabled: true, forcedProvider: "baseten" });
  const flash = await api.getByokOrTeamGatewayApiKeyForModelOption(catalog.getAiModelOptionById("deepseek-v4.1-flash"), [], { ...lookup, agentId: "fixture-agent" });
  assert.equal(flash.kind, "baseten");
  assert.equal(flash.apiKey, "team-baseten-secret");
  await assert.rejects(
    () => api.getByokOrTeamGatewayApiKeyForModelOption(catalog.getAiModelOptionById("gpt-6-luna"), [], lookup),
    (error) => error.name === "ForcedTeamKeyError" && error.message.includes("Allowance is not used") && error.message.includes("Baseten"),
  );
  await assert.rejects(
    () => api.getTeamGatewayApiKey(lookup),
    (error) => error.name === "ForcedTeamKeyError",
  );
  assert.equal(await api.getTeamGatewayFunding(lookup), undefined);
  assert.equal(await api.getByokApiKeyForProvider("openai", [{ provider: "openai", enabled: true, ciphertext: "request-key" }], lookup), undefined);
  const context = await api.getOpenAiOnlyDefaultContext(lookup);
  assert.equal(context.hasDirectOpenAiKey, false);
});

test("a forced gateway key serves the provider models it can run", async () => {
  const api = routingHarness({ forcedProvider: "gateway" });
  const credential = await api.getByokOrTeamGatewayApiKey("claude", [], lookup);
  assert.equal(credential, "vck_team-gateway");
  assert.equal(await api.getByokOrTeamGatewayApiKeyForModelOption(catalog.getAiModelOptionById("gpt-6-luna"), [], lookup), "vck_team-gateway");
  await assert.rejects(
    () => api.getByokOrTeamGatewayApiKey("custom", [], lookup),
    (error) => error.name === "ForcedTeamKeyError",
  );
});

test("a forced gateway key pauses a GDPR-restricted provider instead of using allowance", async () => {
  const api = routingHarness({ forcedProvider: "gateway", gdprSafeMode: true });
  await assert.rejects(
    () => api.getByokOrTeamGatewayApiKey("deepseek", [], lookup),
    (error) => error.name === "ForcedTeamKeyError" && error.message.includes("Allowance is not used"),
  );
  assert.equal(await api.getByokOrTeamGatewayApiKey("claude", [], lookup), "vck_team-gateway");
  await assert.rejects(
    () => api.getByokOrTeamGatewayApiKeyForModelOption(catalog.getAiModelOptionById("deepseek-v4-pro"), [], lookup),
    (error) => error.name === "ForcedTeamKeyError",
  );
});

test("a forced key on a free plan pauses instead of using the key or the allowance", async () => {
  const api = routingHarness({ forcedProvider: "baseten", plan: "Free" });
  await assert.rejects(
    () => api.getByokOrTeamGatewayApiKeyForModelOption(catalog.getAiModelOptionById("deepseek-v4.1-flash"), [], lookup),
    (error) => error.name === "ForcedTeamKeyError",
  );
  assert.equal(await api.getTeamGatewayFunding(lookup), undefined);
  assert.equal(await api.getByokApiKeyForProvider("baseten", [], lookup), undefined);
});

test("a forced Baseten key pauses when the Baseten flag is off", async () => {
  const api = routingHarness({ forcedProvider: "baseten", basetenEnabled: false });
  await assert.rejects(
    () => api.getByokOrTeamGatewayApiKeyForModelOption(catalog.getAiModelOptionById("deepseek-v4.1-flash"), [], lookup),
    (error) => error.name === "ForcedTeamKeyError",
  );
  assert.equal(await api.getTeamGatewayFunding(lookup), undefined);
});

test("a forced DeepSeek key serves its fast model instead of the allowance", async () => {
  const api = routingHarness({ forcedProvider: "deepseek" });
  const credential = await api.getByokOrTeamGatewayApiKeyForModelOption(catalog.getAiModelOptionById("deepseek-v4.1-flash-fast"), [], lookup);
  assert.equal(credential, "team-deepseek-secret");
});

test("own-key-only teams keep today's routing when the switch would otherwise force a key", async () => {
  const api = routingHarness({ enabled: true, forcedProvider: "baseten", ownKeyOnly: true });
  const credential = await api.getByokOrTeamGatewayApiKeyForModelOption(catalog.getAiModelOptionById("gpt-6-luna"), [], lookup);
  assert.equal(credential, managedKey);
  assert.equal((await api.getTeamGatewayFunding(lookup)).source, "managed");
});

test("the settings switch is owner-only, one key at a time, and hidden from the flag-off API", async () => {
  const off = settingsHarness({ enabled: false });
  assert.equal((await off.request("POST", { provider: "baseten", alwaysUse: true })).status, 403);
  assert.equal(off.rows.deepseek.alwaysUse, true);

  const denied = settingsHarness({ allowed: false });
  assert.equal((await denied.request("POST", { provider: "baseten", alwaysUse: true })).status, 403);

  const missing = settingsHarness();
  assert.equal((await missing.request("POST", { provider: "openai", alwaysUse: true })).status, 400);

  const unpaid = settingsHarness({ paid: false });
  assert.equal((await unpaid.request("POST", { provider: "baseten", alwaysUse: true })).status, 402);
  assert.equal((await unpaid.request("POST", { provider: "deepseek", alwaysUse: false })).status, 200);
  assert.equal(unpaid.rows.deepseek.alwaysUse, false);

  const exempt = settingsHarness({ ownKeyOnly: true });
  assert.equal((await exempt.request("POST", { provider: "baseten", alwaysUse: true })).status, 400);

  const hiddenBaseten = settingsHarness({ basetenEnabled: false });
  assert.equal((await hiddenBaseten.request("POST", { provider: "baseten", alwaysUse: true })).status, 403);

  const on = settingsHarness();
  assert.equal((await on.request("POST", { provider: "baseten", alwaysUse: true })).status, 200);
  assert.equal(on.rows.baseten.alwaysUse, true);
  assert.equal(on.rows.deepseek.alwaysUse, false);
  const listed = await on.request("GET");
  assert.equal(listed.status, 200);
  assert.equal(listed.body.keys.find((key) => key.provider === "baseten").alwaysUse, true);
  assert.equal(listed.body.keys.find((key) => key.provider === "deepseek").alwaysUse, false);
  assert.equal((await on.request("POST", { provider: "baseten", alwaysUse: false })).status, 200);
  assert.equal(on.rows.baseten.alwaysUse, false);
});

test("turning a key off clears Always use this key", async () => {
  const api = settingsHarness();
  assert.equal((await api.request("POST", { provider: "deepseek", enabled: false })).status, 200);
  assert.equal(api.rows.deepseek.enabled, false);
  assert.equal(api.rows.deepseek.alwaysUse, false);
});

test("saving a replacement secret while the key is off clears Always use this key", async () => {
  const api = settingsHarness();
  assert.equal((await api.request("POST", { provider: "deepseek", apiKey: "replaced-secret", enabled: false })).status, 200);
  assert.equal(api.rows.deepseek.enabled, false);
  assert.equal(api.rows.deepseek.alwaysUse, false);
  assert.equal(api.rows.deepseek.ciphertext, "replaced-secret");

  api.rows.custom = { enabled: true, ciphertext: "old-custom", alwaysUse: true };
  const custom = await api.request("POST", {
    provider: "custom",
    apiKey: "custom-secret",
    baseUrl: "https://example.com/v1",
    modelId: "custom-model",
    gdprCompliant: true,
    enabled: false,
  });
  assert.equal(custom.status, 200);
  assert.equal(api.rows.custom.enabled, false);
  assert.equal(api.rows.custom.alwaysUse, false);
});

test("a forced-key failure stays the pause message instead of a generic model error", () => {
  const errors = load(path.join(root, "src/lib/ai/chatStream/errors.ts"));
  const error = new Error(forced.forcedTeamKeyPauseMessage("baseten"));
  error.name = "ForcedTeamKeyError";
  assert.equal(errors.userFacingErrorMessage(error, "model-stream", "byok:openai"), error.message);
  assert.match(error.message, /Allowance is not used/);
});
