const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false });
const providers = load(path.join(root, "src/lib/aiProviders.ts"));
const catalog = load(path.join(root, "src/lib/aiModelOptions.ts"));
const flag = load(path.join(root, "src/lib/flags/definitions/htpr-7741-byok-enables-provider.ts"));

function moduleWithStubs(file, stubs) {
  const filename = path.join(root, file);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(code, {
    module: loaded, exports: loaded.exports, Headers,
    console: { error() {} },
    require: (id) => {
      if (Object.hasOwn(stubs, id)) return stubs[id];
      throw new Error(`Unexpected dependency: ${id}`);
    },
  }, { filename });
  return loaded.exports;
}

function harness({ settings = {}, rows = {}, enabled = true, paid = true, owner = true, failSettings = false } = {}) {
  const state = { settings: structuredClone(settings), rows: structuredClone(rows) };
  const handler = moduleWithStubs("src/pages/api/teams/byokKeys.ts", {
    "@/lib/prisma": { __esModule: true, default: { user: { findUnique: async () => ({ id: 985 }) } } },
    "@/lib/aiProviders": providers,
    "@/lib/crypto/byokCipher": { encryptByokSecret: () => "fixture-ciphertext" },
    "@/lib/crypto/maskByokSecret": {},
    "@/lib/ai/customEndpoint": {},
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 985 }) },
    "@/lib/freeTier": { isPaidTeam: async () => paid },
    "@/utils/controllers/teams/assertTeamByokAccess": {
      assertUserCanManageTeamByok: async () => owner ? { ok: true } : { ok: false, status: 403, message: "Forbidden" },
    },
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => {
      assert.equal(key, "htpr-7741-byok-enables-provider");
      assert.equal(userId, 985);
      return enabled;
    } },
    "@/lib/flags/definitions/htpr-7741-byok-enables-provider": flag,
    "@/utils/controllers/teams/updateTeamAiSettingsAtomically": {
      withLockedTeamAiSettings: async (teamId, run) => {
        assert.equal(teamId, "fixture-team");
        const next = structuredClone(state);
        const transaction = {
          teamByokApiKey: {
            upsert: async ({ where, create, update }) => {
              const provider = where.teamId_provider.provider;
              next.rows[provider] = next.rows[provider] ? { ...next.rows[provider], ...update } : create;
              return next.rows[provider];
            },
            findUnique: async ({ where }) => next.rows[where.teamId_provider.provider] ?? null,
            deleteMany: async ({ where }) => { delete next.rows[where.provider]; return { count: 1 }; },
          },
          team: { update: async ({ data }) => {
            if (failSettings) throw new Error("Fixture settings write failed");
            next.settings = data.aiProviderSettings;
          } },
        };
        const result = await run(transaction, next.settings);
        state.settings = next.settings;
        state.rows = next.rows;
        return result;
      },
    },
  }).default;
  const gate = moduleWithStubs("src/app/api/ai/_lib/providerGate.ts", {
    "@/lib/prisma": {},
    "@/lib/aiProviders": providers,
    "@/lib/aiModelOptions": catalog,
    "@/utils/controllers/projects/getAllIncludes": {},
  });
  return {
    state,
    model: (id) => gate.filterModelOptionForTeam(catalog.getAiModelOptionById(id), state.settings).id,
    post: async (body) => {
      const res = { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
      await handler({ method: "POST", headers: {}, body: { teamId: "fixture-team", ...body } }, res);
      return { status: res.statusCode, body: JSON.parse(JSON.stringify(res.body)) };
    },
  };
}

for (const [provider, model] of [
  ["deepseek", "deepseek-v4.1-flash"],
  ["moonshot", "kimi-k3"],
  ["zhipu", "glm-5.3-flash"],
  ["alibaba", "qwen3.7-plus"],
]) {
  test(`saving an enabled ${provider} key keeps its selected model instead of substituting a fallback`, async () => {
    const h = harness();
    assert.notEqual(h.model(model), model);
    assert.deepEqual(await h.post({ provider, apiKey: "fixture-key" }), { status: 200, body: { ok: true } });
    assert.equal(h.state.rows[provider].enabled, true);
    assert.equal(h.model(model), model);
  });
}

test("enabling a saved key enables its models and preserves other settings", async () => {
  const h = harness({ settings: { gdprSafeMode: false, featureModels: { chat: "gpt-6-luna" }, providers: { google: false, deepseek: false } }, rows: { deepseek: { enabled: false, ciphertext: "fixture-ciphertext" } } });
  assert.equal((await h.post({ provider: "deepseek", enabled: true })).status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(h.state.settings)), { gdprSafeMode: false, featureModels: { chat: "gpt-6-luna" }, providers: { google: false, deepseek: true } });
  assert.equal(h.model("deepseek-v4.1-flash"), "deepseek-v4.1-flash");
});

test("legacy flat provider overrides survive saving an Anthropic key", async () => {
  const h = harness({ settings: { google: false, anthropic: false } });
  assert.equal((await h.post({ provider: "claude", apiKey: "fixture-key" })).status, 200);
  assert.equal(providers.resolveTeamProviderEnabled(h.state.settings, "anthropic"), true);
  assert.equal(providers.resolveTeamProviderEnabled(h.state.settings, "google"), false);
});

test("key rotation retains the stored switch, while explicit enable on save turns models on", async () => {
  for (const storedEnabled of [false, true]) {
    const h = harness({ rows: { deepseek: { enabled: storedEnabled, ciphertext: "old-fixture" } } });
    assert.equal((await h.post({ provider: "deepseek", apiKey: "fixture-key" })).status, 200);
    assert.equal(h.state.rows.deepseek.enabled, storedEnabled);
    assert.equal(providers.resolveTeamProviderEnabled(h.state.settings, "deepseek"), storedEnabled);
    assert.equal((await h.post({ provider: "deepseek", apiKey: "fixture-key", enabled: true })).status, 200);
    assert.equal(h.model("deepseek-v4.1-flash"), "deepseek-v4.1-flash");
  }
});

test("disabled or empty keys and gateway keys do not enable provider models", async () => {
  for (const body of [
    { provider: "deepseek", apiKey: "fixture-key", enabled: false },
    { provider: "deepseek", enabled: true },
    { provider: "gateway", apiKey: "vck_fixture" },
  ]) {
    const h = harness();
    assert.equal((await h.post(body)).status, 200);
    assert.equal(providers.resolveTeamProviderEnabled(h.state.settings, "deepseek"), false);
  }
});

test("turning off or clearing a key never changes the team's provider choices", async () => {
  for (const body of [{ enabled: false }, { clearSecret: true }]) {
    const h = harness({ settings: { providers: { deepseek: true } }, rows: { deepseek: { enabled: true, ciphertext: "fixture-ciphertext" } } });
    assert.equal((await h.post({ provider: "deepseek", ...body })).status, 200);
    assert.equal(h.model("deepseek-v4.1-flash"), "deepseek-v4.1-flash");
  }
});

test("GDPR safe mode still refuses a China-hosted key before either setting changes", async () => {
  const h = harness({ settings: { gdprSafeMode: true } });
  const res = await h.post({ provider: "deepseek", apiKey: "fixture-key" });
  assert.equal(res.status, 400);
  assert.equal(res.body.message, "Turn off GDPR safe mode before using this provider");
  assert.deepEqual(h.state.rows, {});
  assert.equal(providers.resolveTeamProviderEnabled(h.state.settings, "deepseek"), false);
});

test("non-owners and unpaid teams still cannot save provider keys", async () => {
  for (const [options, status] of [[{ owner: false }, 403], [{ paid: false }, 402]]) {
    const h = harness(options);
    assert.equal((await h.post({ provider: "deepseek", apiKey: "fixture-key" })).status, status);
    assert.deepEqual(h.state.rows, {});
  }
});

test("a failed provider update rolls back the key save in the same transaction", async () => {
  const h = harness({ failSettings: true });
  assert.equal((await h.post({ provider: "deepseek", apiKey: "fixture-key" })).status, 500);
  assert.deepEqual(h.state.rows, {});
  assert.equal(providers.resolveTeamProviderEnabled(h.state.settings, "deepseek"), false);
});

test("flag off preserves the old independent provider settings", async () => {
  const h = harness({ enabled: false });
  assert.equal((await h.post({ provider: "deepseek", apiKey: "fixture-key" })).status, 200);
  assert.equal(h.state.rows.deepseek.enabled, true);
  assert.equal(providers.resolveTeamProviderEnabled(h.state.settings, "deepseek"), false);
  assert.notEqual(h.model("deepseek-v4.1-flash"), "deepseek-v4.1-flash");
});
