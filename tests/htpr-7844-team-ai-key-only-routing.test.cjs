const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const TEAM_ID = "11111111-1111-4111-8111-111111111111";
const TEAM_KEY = "sk-ant-inne-team-key";
const PLATFORM = {
  AI_GATEWAY_API_KEY: "vck_platform_gateway",
  DEMO_AI_GATEWAY_API_KEY: "vck_platform_demo",
  TURBOPUFFER_EMBEDDINGS_API_KEY: "sk-platform-embeddings",
  DEEPGRAM_API_KEY: "dg-platform-dictation",
};

const { loadModule } = require("./helpers/loadModule.cjs");
function loadByok(flagOn, extraKeys = {}, options = {}) {
  const stubs = {};
  function stubModule(file, exports) {
    stubs["@/" + file.slice(4).replace(/\.ts$/, "")] = exports;
  }
  stubModule("src/app/api/ai/_lib/modelProvider.ts", {
    isVercelAiGatewayKey: (key) => typeof key === "string" && key.startsWith("vck_"),
    registerManagedGatewayKey: () => {},
    resolveAiModel: (provider, model, apiKey) => ({ provider, model, apiKey }),
    aiUsageProviderForCredential: (provider) => `byok:${provider}`,
  });
  stubModule("src/lib/flags.ts", {
    isFeatureEnabled: async (key, userId) => { if (options.flagError) throw new Error("flag unavailable"); assert.equal(userId, 42); return flagOn && key === "htpr-7844-team-ai-key-only"; },
  });
  stubModule("src/app/api/ai/_lib/planGate.ts", {
    storePlanIdForProject: async () => "BYOK",
    haikuDefaultModelEnabled: async () => options.haikuDefault === true,
    haiku55ModelEnabled: async () => false,
    backgroundClaudeModelEnabled: async () => false,
  });
  stubModule("src/lib/crypto/byokCipher.ts", {
    decryptByokSecret: (ciphertext) => ciphertext,
  });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", {
    getProjectWhere: () => ({}),
  });
  stubModule("src/lib/prisma.ts", {
    default: {
      team: {
        findUnique: async (args) => { if (args.select.aiKeyOnly) options.metadataReads?.push(args); if (options.teamError) throw new TypeError("team unavailable"); return ({
          aiKeyOnly: options.aiKeyOnly ?? true,
          aiKeyOnlyPlatformServices: options.aiKeyOnlyPlatformServices ?? false,
          googleAccount: { userId: 42 },
          aiProviderSettings: options.aiProviderSettings ?? null,
        }); },
      },
      teamByokApiKey: {
        findMany: async (args) => {
          options.secretReads?.push(args);
          if (options.keyError) throw new Error("keys unavailable");
          return [
            { provider: "claude", ciphertext: TEAM_KEY },
            ...Object.entries(extraKeys).map(([provider, ciphertext]) => ({ provider, ciphertext })),
          ];
        },
        findUnique: async (args) => {
          const provider = args.where.teamId_provider.provider;
          if (provider === "claude") return { enabled: true, ciphertext: TEAM_KEY };
          return extraKeys[provider] ? { enabled: true, ciphertext: extraKeys[provider] } : null;
        },
      },
      agentByokApiKey: { findUnique: async () => options.agentClaude ? { enabled: true, ciphertext: options.agentClaude } : null },
    },
  });
  return loadModule("src/app/api/ai/_lib/byokKeys.ts", stubs);
}

function withPlatformKeys(run) {
  const previous = {};
  for (const [name, value] of Object.entries(PLATFORM)) {
    previous[name] = process.env[name];
    process.env[name] = value;
  }
  return Promise.resolve()
    .then(run)
    .finally(() => {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });
}

test("key-only routing never returns a platform key", async () => {
  await withPlatformKeys(async () => {
    const byok = loadByok(true);
    const lookup = { trustedTeamId: TEAM_ID, userId: 7 };
    const funding = await byok.getTeamGatewayFunding(lookup);
    assert.equal(funding, undefined);
    await assert.rejects(
      () => byok.getTeamGatewayApiKey(lookup),
      (error) => error.name === "TeamKeyOnlyRefusal" && error.message.includes("own saved keys"),
    );
    await assert.rejects(
      () => byok.getByokOrTeamGatewayApiKey("openai", undefined, lookup),
      (error) => error.name === "TeamKeyOnlyRefusal" && !Object.values(PLATFORM).some((key) => error.message.includes(key)),
    );
    const claude = await byok.getByokOrTeamGatewayApiKey("claude", undefined, lookup);
    assert.equal(claude, TEAM_KEY);
    const side = await byok.keyOnlySideCallModel(lookup, "google");
    assert.equal(side.usageProvider, "byok:claude");
    assert.deepEqual(side.model, { provider: "claude", model: "claude-haiku-4-5", apiKey: TEAM_KEY });
    assert.equal(JSON.stringify(side).includes(PLATFORM.AI_GATEWAY_API_KEY), false);
    assert.equal(JSON.stringify(side).includes(PLATFORM.TURBOPUFFER_EMBEDDINGS_API_KEY), false);
    assert.equal(JSON.stringify(side).includes(PLATFORM.DEEPGRAM_API_KEY), false);
  });
});

test("key-only chat does not use a saved openai key or a customer gateway key", async () => {
  await withPlatformKeys(async () => {
    const byok = loadByok(true, { openai: "sk-team-openai", gateway: "vck_customer_gateway" });
    const lookup = { trustedTeamId: TEAM_ID, userId: 7 };
    await assert.rejects(
      () => byok.getByokOrTeamGatewayApiKey("openai", undefined, lookup),
      (error) => error.name === "TeamKeyOnlyRefusal" && !error.message.includes("sk-team-openai") && !error.message.includes("vck_customer_gateway"),
    );
    assert.equal(await byok.getTeamGatewayFunding(lookup), undefined);
    assert.equal(await byok.getByokOrTeamGatewayApiKey("claude", undefined, lookup), TEAM_KEY);
  });
});

test("key-only model options and the haiku shortcut stay on the team claude key", async () => {
  await withPlatformKeys(async () => {
    const byok = loadByok(true, {}, { haikuDefault: true, agentClaude: "sk-ant-agent-other" });
    const catalog = require("jiti")(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } })(path.join(root, "src/lib/aiModelOptions.ts"));
    const lookup = { trustedTeamId: TEAM_ID, userId: 7, agentId: "agent-1" };
    await assert.rejects(
      () => byok.getByokOrTeamGatewayApiKeyForModelOption(catalog.getAiModelOptionById("gpt-6-luna"), undefined, lookup),
      (error) => error.name === "TeamKeyOnlyRefusal" && !error.message.includes("sk-ant-agent-other"),
    );
    await assert.rejects(
      () => byok.getByokOrTeamGatewayApiKeyForModelOption({ source: "custom", modelKey: "custom-endpoint" }, undefined, lookup),
      (error) => error.name === "TeamKeyOnlyRefusal",
    );
    const haiku = catalog.getAiModelOptionById("claude-haiku-4.5") ?? catalog.getAiModelOptionById("claude-haiku-5-5");
    assert.equal(await byok.getByokOrTeamGatewayApiKeyForModelOption(haiku, undefined, lookup), TEAM_KEY);
    const context = await byok.getAiDefaultModelContext(lookup);
    assert.equal(context.byok.provider, "claude");
    assert.equal(context.byok.credential, TEAM_KEY);
  });
});

test("flag off pauses key-only teams, while other teams remain unrestricted", async () => {
  await withPlatformKeys(async () => {
    const byok = loadByok(false);
    await assert.rejects(() => byok.getTeamGatewayApiKey({ trustedTeamId: TEAM_ID, userId: 7 }), { name: "TeamKeyOnlyRefusal" });
    const unrestricted = loadByok(false, {}, { aiKeyOnly: false });
    const result = await unrestricted.getTeamGatewayFunding({ trustedTeamId: TEAM_ID, userId: 7 });
    assert.equal(result.source, "shared");
    assert.equal(result.apiKey, PLATFORM.AI_GATEWAY_API_KEY);
  });
});


test("funding failures never fall back to platform keys", async () => {
  for (const [options, expected] of [
    [{ flagError: true }, { message: "flag unavailable" }],
    [{ teamError: true }, { message: "team unavailable" }],
    [{ keyError: true }, { message: "keys unavailable" }],
  ]) {
    const byok = loadByok(true, {}, options);
    await assert.rejects(() => byok.getByokOrTeamGatewayApiKey("claude", undefined, { trustedTeamId: TEAM_ID }), expected);
  }
});

test("background funding uses the team owner and respects disabled Anthropic", async () => {
  const enabled = loadByok(true);
  assert.equal(await enabled.getByokOrTeamGatewayApiKey("claude", undefined, { trustedTeamId: TEAM_ID }), TEAM_KEY);
  assert.equal(await enabled.getByokOrTeamGatewayApiKey("claude", undefined, { trustedTeamId: TEAM_ID, projectId: 123 }), TEAM_KEY);
  await assert.rejects(() => enabled.getByokOrTeamGatewayApiKey("claude", undefined, { projectId: 123 }), { name: "TeamKeyOnlyRefusal" });
  const disabled = loadByok(true, {}, { aiProviderSettings: { providers: { anthropic: false } } });
  await assert.rejects(
    () => disabled.getByokOrTeamGatewayApiKey("claude", undefined, { trustedTeamId: TEAM_ID }),
    { name: "TeamKeyOnlyRefusal" },
  );
});

test("unrestricted teams do not depend on flag availability", async () => {
  await withPlatformKeys(async () => {
    const byok = loadByok(false, {}, { aiKeyOnly: false, flagError: true });
    const funding = await byok.getTeamGatewayFunding({ trustedTeamId: TEAM_ID });
    assert.equal(funding.apiKey, PLATFORM.AI_GATEWAY_API_KEY);
  });
});

test("funding reads secrets only for enabled key-only teams", async () => {
  const secretReads = [];
  const metadataReads = [];
  const request = { trustedTeamId: TEAM_ID };
  const unrestricted = loadByok(true, {}, { aiKeyOnly: false, secretReads, metadataReads });
  await unrestricted.getTeamGatewayFunding(request);
  assert.deepEqual(metadataReads, [{ where: { id: TEAM_ID }, select: { aiKeyOnly: true, aiKeyOnlyPlatformServices: true, aiProviderSettings: true, googleAccount: { select: { userId: true } } } }]);
  const disabled = loadByok(false, {}, { secretReads });
  await assert.rejects(() => disabled.getTeamGatewayApiKey(request), { name: "TeamKeyOnlyRefusal" });
  assert.deepEqual(secretReads, []);
  const restricted = loadByok(true, {}, { secretReads });
  assert.equal(await restricted.getByokOrTeamGatewayApiKey("claude", undefined, request), TEAM_KEY);
  assert.deepEqual(secretReads, [{
    where: { teamId: TEAM_ID, enabled: true },
    select: { provider: true, ciphertext: true },
  }]);
});
