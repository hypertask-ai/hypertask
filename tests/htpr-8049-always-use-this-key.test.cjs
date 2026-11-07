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
const forced = load(path.join(root, "src/lib/ai/forcedTeamKey.ts"));
const flag = load(path.join(root, "src/lib/flags/definitions/htpr-8049-always-use-this-key.ts"));
const basetenFlag = load(path.join(root, "src/lib/flags/definitions/htpr-7732-baseten-byok.ts"));
const providerSyncFlag = load(path.join(root, "src/lib/flags/definitions/htpr-7741-byok-enables-provider.ts"));
const flagKey = "htpr-8049-always-use-this-key";
const lookup = { trustedTeamId: "fixture-team", userId: 985 };
const managedKey = "vck_fake-managed";

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

function routingHarness({ enabled = true, forcedProvider = "baseten", ownKeyOnly = false, secrets = {} } = {}) {
  const settings = ownKeyOnly ? { ownKeyOnly: true } : {};
  const stored = {
    baseten: "team-baseten-secret",
    deepseek: "team-deepseek-secret",
    managed_gateway: managedKey,
    ...secrets,
  };
  const api = loadModule("src/app/api/ai/_lib/byokKeys.ts", {
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
    "@/lib/flags/definitions/htpr-7732-baseten-byok": basetenFlag,
    "@/lib/flags/definitions/htpr-7634-openai-only-default": {},
    "@/lib/flags/definitions/htpr-8049-always-use-this-key": flag,
    "@/lib/flags/definitions/htpr-8100-no-paid-fallback": { HTPR_8100_NO_PAID_FALLBACK_FLAG: "htpr-8100-no-paid-fallback" },
    "@/lib/ai/forcedTeamKey": forced,
    "@/lib/flags": { isFeatureEnabled: async (key) => key === flagKey ? enabled : true },
    "@/lib/crypto/byokCipher": { decryptByokSecret: (value) => value },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
    "@/app/api/ai/_lib/modelProvider": {
      isVercelAiGatewayKey: (key) => typeof key === "string" && key.startsWith("vck_"),
      registerManagedGatewayKey: () => {},
    },
    "@/lib/aiModelOptions": catalog,
    "@/lib/aiProviders": providers,
    "@/lib/ai/customEndpoint": customEndpoint,
    "@/app/api/ai/_lib/managedGatewayKeys": { MANAGED_TEAM_GATEWAY_PROVIDER: "managed_gateway" },
    "@/app/api/ai/_lib/planGate": { storePlanIdForProject: async () => "Pro", backgroundClaudeModelEnabled: async () => false },
    "@/app/api/ai/chat/stream/modelFallback": {},
    "@/lib/ai/modelFundingGuard": { fallbackRunsOnOurOwnGatewayKey: () => false },
  });
  return api;
}

function settingsHarness({ enabled = true, allowed = true, paid = true } = {}) {
  const rows = {
    baseten: { enabled: true, ciphertext: "team-baseten-secret", alwaysUse: false },
    deepseek: { enabled: true, ciphertext: "team-deepseek-secret", alwaysUse: true },
  };
  const writes = [];
  const transaction = { teamByokApiKey: {
    findMany: async () => Object.entries(rows).map(([provider, row]) => ({ provider, ...row })),
    findUnique: async ({ where }) => rows[where.teamId_provider.provider] ?? null,
    updateMany: async ({ where, data }) => {
      writes.push({ updateMany: { where, data } });
      for (const [provider, row] of Object.entries(rows)) {
        const providerMatch = where.provider ? where.provider === provider : where.NOT?.provider !== provider;
        if (where.teamId === "fixture-team" && providerMatch && (where.alwaysUse === undefined || row.alwaysUse === where.alwaysUse)) {
          Object.assign(row, data);
        }
      }
    },
    update: async ({ where, data }) => {
      writes.push({ update: { where, data } });
      Object.assign(rows[where.teamId_provider.provider], data);
    },
    upsert: async ({ where, create, update }) => {
      writes.push({ upsert: { where, create, update } });
      const provider = where.teamId_provider.provider;
      rows[provider] = rows[provider] ? { ...rows[provider], ...update } : { ...create };
    },
    deleteMany: async (value) => writes.push({ deleteMany: value }),
  }, team: { update: async () => {} } };
  const api = loadModule("src/pages/api/teams/byokKeys.ts", {
    "@/lib/flags": { isFeatureEnabled: async (key) => key === flagKey ? enabled : true },
    "@/lib/flags/definitions/htpr-7741-byok-enables-provider": providerSyncFlag,
    "@/lib/flags/definitions/htpr-7732-baseten-byok": basetenFlag,
    "@/lib/flags/definitions/htpr-8049-always-use-this-key": flag,
    "@/lib/prisma": { default: {
      user: { findUnique: async () => ({ id: 985 }) },
      team: { findUnique: async () => ({ googleAccount: { userId: allowed ? 985 : 1 }, members: [] }) },
    } },
    "@/lib/crypto/byokCipher": { decryptByokSecret: (value) => value, encryptByokSecret: (value) => value },
    "@/lib/crypto/maskByokSecret": { maskByokSecret: (value) => `masked:${value.slice(-4)}` },
    "@/lib/aiProviders": providers,
    "@/utils/controllers/teams/assertTeamByokAccess": { assertUserCanManageTeamByok: async () => allowed ? { ok: true } : { ok: false, status: 403, message: "Forbidden" } },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 985 }) },
    "@/lib/freeTier": { isPaidTeam: async () => paid },
    "@/utils/controllers/teams/updateTeamAiSettingsAtomically": { withLockedTeamAiSettings: async (_teamId, update) => update(transaction, {}) },
    "@/lib/ai/customEndpoint": customEndpoint,
  }).default;
  return { rows, writes, request: async (method, body = {}) => {
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

test("a forced-key failure stays the pause message instead of a generic model error", () => {
  const errors = load(path.join(root, "src/lib/ai/chatStream/errors.ts"));
  const error = new Error(forced.forcedTeamKeyPauseMessage("baseten"));
  error.name = "ForcedTeamKeyError";
  assert.equal(errors.userFacingErrorMessage(error, "model-stream", "byok:openai"), error.message);
  assert.match(error.message, /Allowance is not used/);
});
