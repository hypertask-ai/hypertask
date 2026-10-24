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

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

function loadByok(flagOn) {
  for (const relativePath of [
    "src/lib/flags.ts",
    "src/lib/prisma.ts",
    "src/lib/crypto/byokCipher.ts",
    "src/app/api/ai/_lib/planGate.ts",
    "src/app/api/ai/_lib/byokKeys.ts",
    "src/lib/ai/teamAiFunding.ts",
    "src/utils/controllers/projects/getAllIncludes.ts",
  ]) {
    delete require.cache[path.join(root, relativePath)];
  }
  stubModule("src/lib/flags.ts", {
    isFeatureEnabled: async (key) => flagOn && key === "htpr-7844-team-ai-key-only",
  });
  stubModule("src/app/api/ai/_lib/planGate.ts", {
    storePlanIdForProject: async () => "BYOK",
    haikuDefaultModelEnabled: async () => false,
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
        findUnique: async () => ({
          aiKeyOnly: true,
          aiProviderSettings: null,
          byokApiKeys: [{ provider: "claude", ciphertext: TEAM_KEY }],
        }),
      },
      teamByokApiKey: {
        findUnique: async (args) => {
          const provider = args.where.teamId_provider.provider;
          return provider === "claude" ? { enabled: true, ciphertext: TEAM_KEY } : null;
        },
      },
      agentByokApiKey: { findUnique: async () => null },
    },
  });
  const jiti = require("jiti")(__filename, {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  });
  return jiti(path.join(root, "src/app/api/ai/_lib/byokKeys.ts"));
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
    assert.equal(JSON.stringify(side).includes(PLATFORM.AI_GATEWAY_API_KEY), false);
    assert.equal(JSON.stringify(side).includes(PLATFORM.TURBOPUFFER_EMBEDDINGS_API_KEY), false);
    assert.equal(JSON.stringify(side).includes(PLATFORM.DEEPGRAM_API_KEY), false);
  });
});

test("flag off still uses the shared gateway key", async () => {
  await withPlatformKeys(async () => {
    const byok = loadByok(false);
    const funding = await byok.getTeamGatewayFunding({ trustedTeamId: TEAM_ID, userId: 7 });
    assert.equal(funding.source, "shared");
    assert.equal(funding.apiKey, PLATFORM.AI_GATEWAY_API_KEY);
  });
});
