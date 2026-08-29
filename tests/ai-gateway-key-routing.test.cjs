const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

const stubbedModulePaths = [
  "src/app/api/ai/_lib/byokKeys.ts",
  "src/app/api/ai/_lib/customInstructions.ts",
  "src/app/api/ai/_lib/editorAi.ts",
  "src/app/api/ai/_lib/modelProvider.ts",
  "src/app/api/ai/_lib/planGate.ts",
  "src/app/api/ai/_lib/providerGate.ts",
  "src/lib/crypto/byokCipher.ts",
  "src/lib/prisma.ts",
  "src/utils/controllers/projects/getAllIncludes.ts",
  "src/utils/controllers/turbopuffer/turbopufferHelper.ts",
];

function resetModules() {
  for (const relativePath of stubbedModulePaths) {
    delete require.cache[path.join(root, relativePath)];
  }
}

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

function stubPlan(plan = "Pro") {
  stubModule("src/app/api/ai/_lib/planGate.ts", {
    assertImageModelAllowedForPlan: async () => {},
    assertModelAllowedForPlan: async () => {},
    storePlanIdForProject: async () =>
      typeof plan === "function" ? plan() : plan,
  });
}

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/jiti-entry-${++jitiEntryId}.cjs`),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
    },
  );
  return jiti(path.join(root, relativePath));
}

test("canonical and custom deal Stripe prices map to Pro", () => {
  process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID_02 =
    "price_1QjJeDIhmcH60VcciHzZ3mTJ";
  process.env.NEXT_PUBLIC_STRIPE_YEARLY_PRICE_ID_02 =
    "price_1QjJf8IhmcH60VccNUrF7YJf";

  const { planKindFromStripePriceId } = loadTs(
    "src/lib/planFromStripePriceId.ts",
  );

  assert.deepEqual(
    planKindFromStripePriceId("price_1QjJeDIhmcH60VcciHzZ3mTJ"),
    { storePlanId: "Pro", billingInterval: "month" },
  );
  assert.deepEqual(
    planKindFromStripePriceId("price_1QjJf8IhmcH60VccNUrF7YJf"),
    { storePlanId: "Pro", billingInterval: "year" },
  );
  assert.deepEqual(
    planKindFromStripePriceId("price_1QCKkpIhmcH60Vcc2RqVACTc"),
    { storePlanId: "Pro", billingInterval: "month" },
  );
});

test("platform-managed team gateway key is used without byokProviderFlags", async () => {
  resetModules();
  stubPlan();
  const teamGatewayKey = "vck_team_gateway_key";
  const defaultGatewayKey = "vck_default_gateway_key";
  const projectId = 3853;
  const userId = 1000;
  const teamId = "team_gateway";
  const findUniqueCalls = [];

  process.env.AI_GATEWAY_API_KEY = defaultGatewayKey;

  stubModule("src/lib/prisma.ts", {
    default: {
      project: {
        findFirst: async ({ where, select }) => {
          assert.equal(where.id, projectId);
          assert.equal(select.teamId, true);
          return { teamId };
        },
      },
      teamByokApiKey: {
        findUnique: async (args) => {
          findUniqueCalls.push(args);
          const provider = args.where.teamId_provider.provider;
          return provider === "managed_gateway"
            ? { enabled: true, ciphertext: teamGatewayKey }
            : null;
        },
      },
    },
  });
  stubModule("src/lib/crypto/byokCipher.ts", {
    decryptByokSecret: (ciphertext) => ciphertext,
  });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", {
    getProjectWhere: () => ({}),
    taskWriteAccessWhere: () => ({}),
  });

  const { selectTaskWriterModel } = loadTs("src/app/api/ai/_lib/editorAi.ts");

  const selected = await selectTaskWriterModel({
    sourceSelected: "openai",
    modelSelected: "gpt-5.5",
    byokProviderFlags: [],
    projectId,
    userId,
    feature: "task-writer",
  });

  assert.deepEqual(
    findUniqueCalls.map((call) => call.where),
    [
      { teamId_provider: { teamId, provider: "openai" } },
      { teamId_provider: { teamId, provider: "gateway" } },
      { teamId_provider: { teamId, provider: "openai" } },
      { teamId_provider: { teamId, provider: "claude" } },
      { teamId_provider: { teamId, provider: "managed_gateway" } },
    ],
  );
  assert.ok(selected.model);
  const { getTeamGatewayFunding } = loadTs("src/app/api/ai/_lib/byokKeys.ts");
  assert.deepEqual(await getTeamGatewayFunding({ trustedTeamId: teamId }), {
    apiKey: teamGatewayKey,
    source: "managed",
  });
  assert.notEqual(teamGatewayKey, defaultGatewayKey);
});

test("customer gateway BYOK overrides the platform-managed team key", async () => {
  resetModules();
  stubPlan("BYOK");
  const teamId = "team_customer_gateway";
  const customerGatewayKey = "vck_customer_gateway";
  const managedGatewayKey = "vck_managed_gateway";

  stubModule("src/lib/prisma.ts", {
    default: {
      teamByokApiKey: {
        findUnique: async ({ where }) => {
          const provider = where.teamId_provider.provider;
          if (provider === "gateway") {
            return { enabled: true, ciphertext: customerGatewayKey };
          }
          if (provider === "managed_gateway") {
            return { enabled: true, ciphertext: managedGatewayKey };
          }
          return null;
        },
      },
    },
  });
  stubModule("src/lib/crypto/byokCipher.ts", {
    decryptByokSecret: (ciphertext) => ciphertext,
  });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", {
    getProjectWhere: () => ({}),
    taskWriteAccessWhere: () => ({}),
  });

  const { getTeamGatewayApiKey, getTeamGatewayFunding } = loadTs(
    "src/app/api/ai/_lib/byokKeys.ts",
  );
  assert.equal(
    await getTeamGatewayApiKey({ trustedTeamId: teamId }),
    customerGatewayKey,
  );
  assert.deepEqual(await getTeamGatewayFunding({ trustedTeamId: teamId }), {
    apiKey: customerGatewayKey,
    source: "customer",
  });
});

test("customer vck credentials in provider flags override funded team keys", async () => {
  resetModules();
  stubPlan("BYOK");
  const customerGatewayKey = "vck_customer_provider_flag";

  stubModule("src/lib/prisma.ts", {
    default: {
      teamByokApiKey: {
        findUnique: async () => {
          throw new Error("funded team lookup must not run");
        },
      },
    },
  });
  stubModule("src/lib/crypto/byokCipher.ts", {
    decryptByokSecret: (ciphertext) => ciphertext,
  });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", {
    getProjectWhere: () => ({}),
    taskWriteAccessWhere: () => ({}),
  });

  const { getByokOrTeamGatewayApiKey } = loadTs(
    "src/app/api/ai/_lib/byokKeys.ts",
  );
  assert.equal(
    await getByokOrTeamGatewayApiKey(
      "openai",
      [{ provider: "openai", enabled: true, ciphertext: customerGatewayKey }],
      { trustedTeamId: "funded_team" },
    ),
    customerGatewayKey,
  );
});

test("GDPR safe mode blocks China-hosted runtime credentials and gateway fallback", async () => {
  resetModules();
  stubPlan("BYOK");
  const teamId = "gdpr_safe_team";
  const settings = {
    gdprSafeMode: true,
    providers: { deepseek: true },
  };
  process.env.AI_GATEWAY_API_KEY = "vck_shared_allowance";

  stubModule("src/lib/prisma.ts", {
    default: {
      team: {
        findUnique: async ({ where, select }) => {
          assert.deepEqual(where, { id: teamId });
          assert.equal(select.aiProviderSettings, true);
          return { aiProviderSettings: settings };
        },
      },
      teamByokApiKey: {
        findUnique: async ({ where }) => ({
          enabled: true,
          ciphertext: "saved-deepseek-key",
          team: { aiProviderSettings: settings },
          provider: where.teamId_provider.provider,
        }),
      },
    },
  });
  stubModule("src/lib/crypto/byokCipher.ts", {
    decryptByokSecret: (ciphertext) => ciphertext,
  });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", {
    getProjectWhere: () => ({}),
    taskWriteAccessWhere: () => ({}),
  });

  const {
    getByokApiKeyForProvider,
    getByokOrTeamGatewayApiKey,
    resolveTeamByokApiKey,
  } = loadTs("src/app/api/ai/_lib/byokKeys.ts");
  const lookup = { trustedTeamId: teamId };

  assert.equal(
    await getByokApiKeyForProvider(
      "deepseek",
      [
        {
          provider: "deepseek",
          enabled: true,
          ciphertext: "flag-deepseek-key",
        },
      ],
      lookup,
    ),
    undefined,
  );
  assert.equal(await resolveTeamByokApiKey("deepseek", lookup), undefined);
  assert.equal(
    await getByokOrTeamGatewayApiKey("deepseek", [], lookup),
    undefined,
  );
});

test("GDPR safe mode allows only declared-compliant custom endpoints", async () => {
  resetModules();
  stubPlan("BYOK");
  const teamId = "gdpr_custom_team";
  const settings = { gdprSafeMode: true };
  const { serializeCustomEndpointConfig } = loadTs(
    "src/lib/ai/customEndpoint.ts",
  );
  const compliant = serializeCustomEndpointConfig({
    apiKey: "compliant-custom-key",
    baseUrl: "https://eu.example.com/v1",
    gdprCompliant: true,
    modelId: "eu-model",
  });
  const undeclared = serializeCustomEndpointConfig({
    apiKey: "undeclared-custom-key",
    baseUrl: "https://unknown.example.com/v1",
    gdprCompliant: false,
    modelId: "unknown-model",
  });
  let savedCiphertext = compliant;

  stubModule("src/lib/prisma.ts", {
    default: {
      team: {
        findUnique: async () => ({ aiProviderSettings: settings }),
      },
      teamByokApiKey: {
        findUnique: async () => ({
          enabled: true,
          ciphertext: savedCiphertext,
          team: { aiProviderSettings: settings },
        }),
      },
    },
  });
  stubModule("src/lib/crypto/byokCipher.ts", {
    decryptByokSecret: (ciphertext) => ciphertext,
  });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", {
    getProjectWhere: () => ({}),
    taskWriteAccessWhere: () => ({}),
  });

  const {
    getByokApiKeyForProvider,
    getByokOrTeamGatewayApiKey,
    resolveTeamCustomEndpoint,
  } = loadTs("src/app/api/ai/_lib/byokKeys.ts");
  const lookup = { trustedTeamId: teamId };

  assert.equal(
    (await resolveTeamCustomEndpoint(lookup)).apiKey,
    "compliant-custom-key",
  );
  assert.equal(
    await getByokApiKeyForProvider(
      "custom",
      [{ provider: "custom", enabled: true, ciphertext: compliant }],
      lookup,
    ),
    "compliant-custom-key",
  );

  savedCiphertext = undeclared;
  assert.equal(await resolveTeamCustomEndpoint(lookup), undefined);
  assert.equal(
    await getByokOrTeamGatewayApiKey(
      "custom",
      [{ provider: "custom", enabled: true, ciphertext: undeclared }],
      lookup,
    ),
    undefined,
  );
});

test("platform-managed gateway keys are not customer BYOK providers", () => {
  resetModules();
  const { BYOK_PROVIDER_KEYS } = loadTs("src/lib/aiProviders.ts");
  const { MANAGED_TEAM_GATEWAY_PROVIDER } = loadTs(
    "src/app/api/ai/_lib/managedGatewayKeys.ts",
  );

  assert.equal(MANAGED_TEAM_GATEWAY_PROVIDER, "managed_gateway");
  assert.equal(
    BYOK_PROVIDER_KEYS.includes(MANAGED_TEAM_GATEWAY_PROVIDER),
    false,
  );
});

test("allowance-wrapped Gateway models retain team-tag routing", () => {
  resetModules();
  const sharedGatewayKey = "vck_shared_tagged_gateway";
  process.env.AI_GATEWAY_API_KEY = sharedGatewayKey;

  const { providerOptionsForAiModel, resolveGatewayModel } = loadTs(
    "src/app/api/ai/_lib/modelProvider.ts",
  );
  const model = resolveGatewayModel("openai/gpt-5.4-mini", sharedGatewayKey);

  assert.equal(model.provider, "gateway");
  assert.deepEqual(
    providerOptionsForAiModel(model, "chat", {
      teamId: "team-tagged",
      projectId: 15,
      userId: 6,
    }),
    {
      gateway: {
        tags: ["chat", "team:team-tagged", "board:15", "user:6"],
      },
    },
  );
});

test("automatic system features keep team attribution without member spend", () => {
  resetModules();
  const sharedGatewayKey = "vck_shared_system_gateway";
  process.env.AI_GATEWAY_API_KEY = sharedGatewayKey;

  const { providerOptionsForAiModel, resolveGatewayModel } = loadTs(
    "src/app/api/ai/_lib/modelProvider.ts",
  );
  const model = resolveGatewayModel("openai/gpt-5.4-mini", sharedGatewayKey);

  assert.deepEqual(
    providerOptionsForAiModel(model, "summary", {
      teamId: "team-system",
      projectId: 15,
      userId: 6,
    }),
    {
      gateway: {
        tags: [
          "summary",
          "included-with-hypertask",
          "team:team-system",
          "board:15",
        ],
      },
    },
  );
});

test("premium team inference fails closed when the team has no dedicated key", async () => {
  resetModules();
  const defaultGatewayKey = "vck_default_gateway_key";
  const projectId = 3854;
  const userId = 1000;
  const teamId = "team_without_key";

  process.env.AI_GATEWAY_API_KEY = defaultGatewayKey;
  delete process.env.AI_GATEWAY_ENABLED;

  stubModule("src/lib/prisma.ts", {
    default: {
      project: {
        findFirst: async () => ({ teamId }),
      },
      team: {
        findUnique: async () => ({
          id: teamId,
          activeSubscriptionPlanId: "sub_pro",
          compedUntil: null,
          subscriptionPlan: [
            {
              subscriptionId: "sub_pro",
              subscriptionStatus: "active",
              priceId: "price_1QjJeDIhmcH60VcciHzZ3mTJ",
            },
          ],
        }),
      },
      teamByokApiKey: {
        findUnique: async () => null,
      },
    },
  });
  stubModule("src/lib/crypto/byokCipher.ts", {
    decryptByokSecret: (ciphertext) => ciphertext,
  });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", {
    getProjectWhere: () => ({}),
    taskWriteAccessWhere: () => ({}),
  });

  const { selectTaskWriterModel } = loadTs("src/app/api/ai/_lib/editorAi.ts");

  await assert.rejects(
    selectTaskWriterModel({
      sourceSelected: "openai",
      modelSelected: "gpt-5.5",
      byokProviderFlags: [],
      projectId,
      userId,
      feature: "task-writer",
    }),
    /dedicated team AI Gateway key/,
  );
});

test("Free and BYOK teams use the shared included-allowance gateway key", async () => {
  resetModules();
  const sharedGatewayKey = "vck_shared_free_allowance";
  const teamId = "team_free_allowance";
  let plan = "Free";
  process.env.AI_GATEWAY_API_KEY = sharedGatewayKey;

  stubModule("src/lib/prisma.ts", {
    default: {
      project: { findFirst: async () => ({ teamId }) },
      teamByokApiKey: { findUnique: async () => null },
    },
  });
  stubModule("src/lib/crypto/byokCipher.ts", {
    decryptByokSecret: (ciphertext) => ciphertext,
  });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", {
    getProjectWhere: () => ({}),
    taskWriteAccessWhere: () => ({}),
  });
  stubModule("src/app/api/ai/_lib/planGate.ts", {
    storePlanIdForProject: async () => plan,
  });

  const { getTeamGatewayApiKey, getTeamGatewayFunding } = loadTs(
    "src/app/api/ai/_lib/byokKeys.ts",
  );

  assert.equal(
    await getTeamGatewayApiKey({ trustedTeamId: teamId }),
    sharedGatewayKey,
  );
  assert.deepEqual(await getTeamGatewayFunding({ trustedTeamId: teamId }), {
    apiKey: sharedGatewayKey,
    source: "shared",
  });
  plan = "BYOK";
  assert.equal(
    await getTeamGatewayApiKey({ trustedTeamId: teamId }),
    sharedGatewayKey,
  );
});

test("caller-supplied team IDs cannot select the shared allowance without access", async () => {
  resetModules();
  process.env.AI_GATEWAY_API_KEY = "vck_shared_free_allowance";

  stubModule("src/lib/prisma.ts", {
    default: {
      team: { findFirst: async () => null },
      teamByokApiKey: {
        findUnique: async () => {
          throw new Error("key lookup must not run for an inaccessible team");
        },
      },
    },
  });
  stubModule("src/lib/crypto/byokCipher.ts", {
    decryptByokSecret: (ciphertext) => ciphertext,
  });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", {
    getProjectWhere: () => ({}),
    taskWriteAccessWhere: () => ({}),
  });
  stubModule("src/app/api/ai/_lib/planGate.ts", {
    storePlanIdForProject: async () => {
      throw new Error("plan lookup must not run for an inaccessible team");
    },
  });

  const { getTeamGatewayApiKey } = loadTs("src/app/api/ai/_lib/byokKeys.ts");
  assert.equal(
    await getTeamGatewayApiKey({ teamId: "other_team", userId: 1000 }),
    undefined,
  );
});

test("current plan prevents stale funded rows from surviving a downgrade", async () => {
  resetModules();
  const sharedGatewayKey = "vck_shared_free_allowance";
  const customerGatewayKey = "vck_customer_gateway";
  const managedGatewayKey = "vck_managed_gateway";
  let plan = "Free";
  let includeCustomerGateway = true;
  process.env.AI_GATEWAY_API_KEY = sharedGatewayKey;
  stubPlan(() => plan);

  stubModule("src/lib/prisma.ts", {
    default: {
      teamByokApiKey: {
        findUnique: async ({ where }) => {
          const provider = where.teamId_provider.provider;
          if (provider === "gateway" && includeCustomerGateway) {
            return { enabled: true, ciphertext: customerGatewayKey };
          }
          if (provider === "managed_gateway") {
            return { enabled: true, ciphertext: managedGatewayKey };
          }
          return null;
        },
      },
    },
  });
  stubModule("src/lib/crypto/byokCipher.ts", {
    decryptByokSecret: (ciphertext) => ciphertext,
  });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", {
    getProjectWhere: () => ({}),
    taskWriteAccessWhere: () => ({}),
  });

  const { getTeamGatewayApiKey } = loadTs("src/app/api/ai/_lib/byokKeys.ts");
  const lookup = { trustedTeamId: "downgraded_team" };

  assert.equal(await getTeamGatewayApiKey(lookup), sharedGatewayKey);
  plan = "BYOK";
  includeCustomerGateway = false;
  assert.equal(await getTeamGatewayApiKey(lookup), sharedGatewayKey);
  plan = "Pro";
  assert.equal(await getTeamGatewayApiKey(lookup), managedGatewayKey);
});

test("BYOK system routes honor customer vck keys in legacy provider slots", async () => {
  resetModules();
  const customerGatewayKey = "vck_customer_openai_slot";
  stubPlan("BYOK");

  stubModule("src/lib/prisma.ts", {
    default: {
      teamByokApiKey: {
        findUnique: async ({ where }) =>
          where.teamId_provider.provider === "openai"
            ? { enabled: true, ciphertext: customerGatewayKey }
            : null,
      },
    },
  });
  stubModule("src/lib/crypto/byokCipher.ts", {
    decryptByokSecret: (ciphertext) => ciphertext,
  });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", {
    getProjectWhere: () => ({}),
    taskWriteAccessWhere: () => ({}),
  });

  const { getTeamGatewayApiKey } = loadTs("src/app/api/ai/_lib/byokKeys.ts");
  assert.equal(
    await getTeamGatewayApiKey({ trustedTeamId: "byok_team" }),
    customerGatewayKey,
  );
});

test("the managed gateway registry covers 14 teams without using the shared key", () => {
  const registry = JSON.parse(
    fs.readFileSync(
      path.join(root, "config/managed-team-gateway-keys.json"),
      "utf8",
    ),
  );
  const credentialNames = new Set(
    registry.map((target) => target.credentialEnv),
  );

  assert.equal(registry.length, 14);
  assert.equal(credentialNames.size, 11);
  assert.equal(credentialNames.has("GATEWAY_KEY_TRIALS"), false);
  assert.ok(
    registry.every(
      (target) => target.teamId || (target.teamIdPrefix && target.ownerEmail),
    ),
  );
});

test("managed-key migration deletes only the exact legacy ciphertext it verified", () => {
  const routeSource = fs.readFileSync(
    path.join(root, "src/app/api/mcp/admin/team-gateway-keys/route.ts"),
    "utf8",
  );

  assert.match(
    routeSource,
    /const observedCiphertext = matchingLegacyRows\.get/,
  );
  assert.match(routeSource, /ciphertext: observedCiphertext/);
});

test("task writer option ids map to provider options and legacy model strings fall back", async () => {
  resetModules();
  const projectId = 3855;
  const teamContext = { teamId: "team_model_options", settings: {} };
  process.env.AI_GATEWAY_API_KEY = "vck_default_gateway_key";
  delete process.env.AI_GATEWAY_ENABLED;

  stubModule("src/lib/prisma.ts", {
    default: {
      project: {
        findFirst: async () => null,
        findUnique: async () => ({
          team: {
            activeSubscriptionPlanId: "sub_pro",
            subscriptionPlan: [
              {
                subscriptionId: "sub_pro",
                subscriptionStatus: "active",
                priceId: "price_1QCKkpIhmcH60Vcc2RqVACTc",
              },
            ],
          },
        }),
      },
      team: {
        findUnique: async ({ where }) =>
          where.id === "team_pro" || where.id === "team_model_options"
            ? {
                activeSubscriptionPlanId: "sub_pro",
                subscriptionPlan: [
                  {
                    subscriptionId: "sub_pro",
                    subscriptionStatus: "active",
                    priceId: "price_1QCKkpIhmcH60Vcc2RqVACTc",
                  },
                ],
              }
            : { activeSubscriptionPlanId: null, subscriptionPlan: [] },
      },
      teamByokApiKey: {
        findUnique: async ({ where }) =>
          where.teamId_provider.provider === "gateway"
            ? { enabled: true, ciphertext: "vck_team_model_options" }
            : null,
      },
    },
  });
  stubModule("src/lib/crypto/byokCipher.ts", {
    decryptByokSecret: (ciphertext) => ciphertext,
  });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", {
    getProjectWhere: () => ({}),
    taskWriteAccessWhere: () => ({}),
  });

  const { selectTaskWriterModel } = loadTs("src/app/api/ai/_lib/editorAi.ts");
  const { defaultAiModelOption, preferredAiModelOption } = loadTs(
    "src/lib/aiModelOptions.ts",
  );

  assert.equal(defaultAiModelOption.id, "gpt-5.4-mini");
  assert.equal(preferredAiModelOption.id, "gpt-5.6-luna");
  assert.equal(preferredAiModelOption.effort, "standard");
  assert.deepEqual(preferredAiModelOption.providerOptions?.openai, {
    reasoningEffort: "medium",
  });

  const gptThinking = await selectTaskWriterModel({
    sourceSelected: "openai",
    modelSelected: "gpt-5.5-thinking",
    byokProviderFlags: [],
    teamContext,
  });
  assert.equal(gptThinking.provider, "openai");
  assert.equal(gptThinking.modelId, "gpt-5.5");
  assert.deepEqual(gptThinking.providerOptions?.openai, {
    reasoningEffort: "high",
  });

  const luna = await selectTaskWriterModel({
    sourceSelected: "openai",
    modelSelected: "gpt-5.6-luna",
    byokProviderFlags: [],
    teamContext,
  });
  assert.equal(luna.provider, "openai");
  assert.equal(luna.modelId, "gpt-5.6-luna");
  assert.deepEqual(luna.providerOptions?.openai, {
    reasoningEffort: "medium",
  });

  const paidDefault = await selectTaskWriterModel({
    aiFeature: "taskWriter",
    byokProviderFlags: [],
    teamContext,
  });
  assert.equal(paidDefault.provider, "openai");
  assert.equal(paidDefault.modelId, "gpt-5.6-luna");
  assert.deepEqual(paidDefault.providerOptions?.openai, {
    reasoningEffort: "medium",
  });

  for (const modelId of ["gpt-5.6-terra"]) {
    const gpt56 = await selectTaskWriterModel({
      sourceSelected: "openai",
      modelSelected: modelId,
      byokProviderFlags: [],
      projectId,
      teamContext,
    });
    assert.equal(gpt56.provider, "openai");
    assert.equal(gpt56.modelId, modelId);
    assert.deepEqual(gpt56.providerOptions?.openai, {
      reasoningEffort: "medium",
    });
  }

  await assert.rejects(
    selectTaskWriterModel({
      sourceSelected: "openai",
      modelSelected: "gpt-5.6-sol",
      byokProviderFlags: [],
      teamContext: { teamId: "team_free", settings: {} },
    }),
    /paid plan or your own API key/,
  );

  const paidTeamGrok = await selectTaskWriterModel({
    sourceSelected: "gateway",
    modelSelected: "grok-4.5",
    modelOptionId: "grok-4.5",
    byokProviderFlags: [],
    teamContext: { teamId: "team_pro", settings: {} },
  });
  assert.equal(paidTeamGrok.modelId, "xai/grok-4.5");

  await assert.rejects(
    selectTaskWriterModel({
      sourceSelected: "gateway",
      modelSelected: "grok-4.5",
      modelOptionId: "grok-4.5",
      byokProviderFlags: [],
    }),
    /paid plan or your own API key/,
  );

  const claudeInstant = await selectTaskWriterModel({
    sourceSelected: "claude",
    modelSelected: "claude-sonnet-5-instant",
    byokProviderFlags: [],
    teamContext,
  });
  assert.equal(claudeInstant.provider, "claude");
  assert.equal(claudeInstant.modelId, "claude-sonnet-5");
  assert.deepEqual(claudeInstant.providerOptions?.anthropic, {
    thinking: { type: "disabled" },
    effort: "low",
  });
  assert.equal("temperature" in claudeInstant.settings, false);

  const legacySelection = await selectTaskWriterModel({
    sourceSelected: "claude",
    modelSelected: "claude-sonnet-5",
    byokProviderFlags: [],
    teamContext,
  });
  assert.equal(legacySelection.provider, "openai");
  assert.equal(legacySelection.modelId, "gpt-5.6-luna");
  assert.deepEqual(legacySelection.providerOptions?.openai, {
    reasoningEffort: "medium",
  });
});

test("a new Free team defaults to Mini without tripping the premium plan gate", async () => {
  resetModules();
  const teamId = "team_free_default";
  process.env.AI_GATEWAY_API_KEY = "vck_shared_allowance";

  stubModule("src/lib/prisma.ts", {
    default: {
      team: {
        findUnique: async ({ where }) => {
          assert.equal(where.id, teamId);
          return { activeSubscriptionPlanId: null, subscriptionPlan: [] };
        },
      },
      teamByokApiKey: {
        findUnique: async () => null,
      },
    },
  });
  stubModule("src/lib/crypto/byokCipher.ts", {
    decryptByokSecret: (ciphertext) => ciphertext,
  });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", {
    getProjectWhere: () => ({}),
    taskWriteAccessWhere: () => ({}),
  });

  const { selectTaskWriterModel } = loadTs("src/app/api/ai/_lib/editorAi.ts");
  const selected = await selectTaskWriterModel({
    aiFeature: "taskWriter",
    teamContext: { teamId, settings: {} },
  });

  assert.equal(selected.provider, "openai");
  assert.equal(selected.modelId, "gpt-5.4-mini");
});

test("model and effort dimensions resolve every supported provider configuration", () => {
  const {
    aiModelOptions,
    getAiEffortLabel,
    getAiModelOption,
    getAiModelOptionById,
  } = loadTs("src/lib/aiModelOptions.ts");

  assert.equal(getAiEffortLabel("gpt-5.6-luna", "light"), "Light");
  assert.equal(getAiEffortLabel("gpt-5.6-luna", "standard"), "Standard");
  assert.equal(getAiEffortLabel("gpt-5.6-luna", "high"), "High");
  assert.equal(getAiEffortLabel("gpt-5.5", "light"), "Instant");
  assert.equal(getAiEffortLabel("gpt-5.5", "high"), "Thinking");
  assert.equal(getAiEffortLabel("claude-sonnet-5", "light"), "Instant");
  assert.equal(getAiEffortLabel("claude-opus-5", "high"), "Thinking");
  assert.equal(getAiEffortLabel("grok-4.1-fast", "light"), "Instant");
  assert.equal(getAiEffortLabel("grok-4.20", "high"), "Thinking");

  const openAiReasoning = (reasoningEffort) => ({
    openai: { reasoningEffort },
  });
  const claudeThinking = (type, effort) => ({
    anthropic: { thinking: { type }, effort },
  });
  const expected = [
    ["gpt-5.6-luna", "light", openAiReasoning("low")],
    ["gpt-5.6-luna", "standard", openAiReasoning("medium")],
    ["gpt-5.6-luna", "high", openAiReasoning("high")],
    ["gpt-5.6-terra", "light", openAiReasoning("low")],
    ["gpt-5.6-terra", "standard", openAiReasoning("medium")],
    ["gpt-5.6-terra", "high", openAiReasoning("high")],
    ["gpt-5.6-sol", "light", openAiReasoning("low")],
    ["gpt-5.6-sol", "standard", openAiReasoning("medium")],
    ["gpt-5.6-sol", "high", openAiReasoning("high")],
    ["gpt-5.5", "light", openAiReasoning("low")],
    ["gpt-5.5", "high", openAiReasoning("high")],
    ["gpt-5.4-mini", undefined, undefined],
    ["claude-sonnet-5", "light", claudeThinking("disabled", "low")],
    ["claude-sonnet-5", "high", claudeThinking("adaptive", "high")],
    ["claude-opus-5", "light", claudeThinking("disabled", "low")],
    ["claude-opus-5", "high", claudeThinking("adaptive", "high")],
    ["deepseek-v4-flash", undefined, undefined],
    ["deepseek-v4-pro", undefined, undefined],
    ["kimi-k2.5", undefined, undefined],
    ["kimi-k2.6", undefined, undefined],
    ["kimi-k3", undefined, undefined],
    ["qwen3.7-plus", undefined, undefined],
    ["glm-5.2", undefined, undefined],
    ["gemini-3.5-flash-lite", undefined, undefined],
    ["gemini-3.6-flash", undefined, undefined],
    ["grok-4.1-fast", "light", undefined],
    ["grok-4.1-fast", "high", undefined],
    ["grok-4.20", "light", undefined],
    ["grok-4.20", "high", undefined],
    ["grok-4.5", "standard", undefined],
    ["claude-haiku-4.5", undefined, undefined],
    ["custom", undefined, undefined],
  ];

  for (const [modelKey, effort, providerOptions] of expected) {
    const option = getAiModelOption(modelKey, effort);
    assert.ok(option, `${modelKey}/${effort ?? "none"} should resolve`);
    assert.deepEqual(option.providerOptions, providerOptions);
  }

  const legacyDimensions = {
    "gpt-5.5-instant": ["gpt-5.5", "light"],
    "gpt-5.5-thinking": ["gpt-5.5", "high"],
    "gpt-5.6-luna": ["gpt-5.6-luna", "standard"],
    "gpt-5.6-terra": ["gpt-5.6-terra", "standard"],
    "gpt-5.6-sol": ["gpt-5.6-sol", "standard"],
    "gpt-5.4-mini": ["gpt-5.4-mini", undefined],
    "claude-sonnet-5-instant": ["claude-sonnet-5", "light"],
    "claude-sonnet-5-thinking": ["claude-sonnet-5", "high"],
    "claude-opus-5-instant": ["claude-opus-5", "light"],
    "claude-opus-5-thinking": ["claude-opus-5", "high"],
    "deepseek-v4-flash": ["deepseek-v4-flash", undefined],
    "deepseek-v4-pro": ["deepseek-v4-pro", undefined],
    "kimi-k2.5": ["kimi-k2.5", undefined],
    "kimi-k2.6": ["kimi-k2.6", undefined],
    "kimi-k3": ["kimi-k3", undefined],
    "qwen3.7-plus": ["qwen3.7-plus", undefined],
    "glm-5.2": ["glm-5.2", undefined],
    "gemini-3.1-flash-lite": ["gemini-3.5-flash-lite", undefined],
    "gemini-3.5-flash": ["gemini-3.6-flash", undefined],
    "grok-4.1-fast-instant": ["grok-4.1-fast", "light"],
    "grok-4.1-fast-thinking": ["grok-4.1-fast", "high"],
    "grok-4.20-instant": ["grok-4.20", "light"],
    "grok-4.20-thinking": ["grok-4.20", "high"],
    "grok-4.5": ["grok-4.5", "standard"],
    "claude-haiku-4.5": ["claude-haiku-4.5", undefined],
    custom: ["custom", undefined],
  };

  for (const [id, dimensions] of Object.entries(legacyDimensions)) {
    const option = getAiModelOptionById(id);
    assert.ok(option, `${id} should remain loadable`);
    assert.deepEqual([option.modelKey, option.effort], dimensions);
  }

  assert.equal(aiModelOptions.length, expected.length);
});

test("openai and claude require gateway or direct byok keys", () => {
  resetModules();
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.AI_GATEWAY_ENABLED;

  const { resolveAiModel } = loadTs("src/app/api/ai/_lib/modelProvider.ts");
  const { getAiModelOptionById } = loadTs("src/lib/aiModelOptions.ts");

  assert.throws(
    () => resolveAiModel("openai", "gpt-5.4-mini"),
    /dedicated team AI Gateway key or direct BYOK key/,
  );
  assert.throws(
    () => resolveAiModel("claude", "claude-sonnet-5"),
    /dedicated team AI Gateway key or direct BYOK key/,
  );
  assert.doesNotThrow(() =>
    resolveAiModel("openai", "gpt-5.4-mini", "sk-customer-key"),
  );
  assert.doesNotThrow(() =>
    resolveAiModel("claude", "claude-sonnet-5", "sk-ant-customer-key"),
  );

  const googleDirect = resolveAiModel(
    "gateway",
    "google/gemini-3.1-flash-lite-preview",
    "google-customer-key",
    undefined,
    "google",
  );
  assert.equal(googleDirect.config.provider, "openai.chat");
  assert.equal(
    googleDirect.config.url({ path: "/chat/completions" }),
    "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  );

  const xaiDirect = resolveAiModel(
    "gateway",
    "xai/grok-4.1-fast-non-reasoning",
    "xai-customer-key",
    getAiModelOptionById("grok-4.1-fast-instant"),
    "xai",
  );
  assert.equal(xaiDirect.config.provider, "openai.chat");
  assert.equal(xaiDirect.modelId, "grok-4-1-fast-non-reasoning");
  assert.equal(
    xaiDirect.config.url({ path: "/chat/completions" }),
    "https://api.x.ai/v1/chat/completions",
  );

  const customDirect = resolveAiModel("custom", "custom", {
    apiKey: "custom-customer-key",
    baseUrl: "https://gateway.example.com/v1",
    modelId: "llama-4-70b",
  });
  assert.equal(customDirect.config.provider, "openai.chat");
  assert.equal(
    customDirect.config.url({ path: "/chat/completions" }),
    "https://gateway.example.com/v1/chat/completions",
  );
});

test("gateway text and image models require the explicit team key", async () => {
  resetModules();
  const teamGatewayKey = "vck_team_image_key";
  const platformGatewayKey = "vck_platform_gateway_key";
  process.env.AI_GATEWAY_API_KEY = platformGatewayKey;

  const { resolveGatewayImageModel, resolveGatewayModel } = loadTs(
    "src/app/api/ai/_lib/modelProvider.ts",
  );

  assert.throws(
    () => resolveGatewayModel("google/gemini-3-pro-image"),
    /dedicated team AI Gateway key/,
  );
  assert.throws(
    () => resolveGatewayImageModel("openai/gpt-image-1"),
    /dedicated team AI Gateway key/,
  );

  const languageImageModel = resolveGatewayModel(
    "google/gemini-3-pro-image",
    teamGatewayKey,
  );
  const nativeImageModel = resolveGatewayImageModel(
    "openai/gpt-image-1",
    teamGatewayKey,
  );
  for (const model of [languageImageModel, nativeImageModel]) {
    const headers = await model.config.headers();
    assert.equal(headers.authorization, `Bearer ${teamGatewayKey}`);
    assert.notEqual(headers.authorization, `Bearer ${platformGatewayKey}`);
  }

  const imageRoute = fs.readFileSync(
    path.join(root, "src/app/api/ai/generate-image/route.ts"),
    "utf8",
  );
  assert.match(
    imageRoute,
    /getTeamGatewayApiKey\(\{[\s\S]*?trustedTeamId: teamContext\.teamId,[\s\S]*?\}\)/,
  );
  assert.match(imageRoute, /resolveGatewayModel\(modelId, gatewayApiKey\)/);
  assert.match(
    imageRoute,
    /resolveGatewayImageModel\(modelId, gatewayApiKey\)/,
  );
  assert.match(
    imageRoute,
    /sharedAiAllowanceErrorMessage\(error\)[\s\S]*?status: 429/,
  );
});

test("provider defaults and explicit team settings resolve consistently", () => {
  const {
    enabledProvidersForTeam,
    isByokProviderRestrictedInGdprSafeMode,
    isGdprSafeModeEnabled,
    resolveTeamProviderEnabled,
  } = loadTs("src/lib/aiProviders.ts");

  assert.deepEqual(enabledProvidersForTeam(undefined), [
    "openai",
    "anthropic",
    "google",
    "xai",
  ]);
  assert.equal(resolveTeamProviderEnabled(undefined, "deepseek"), false);
  assert.equal(
    resolveTeamProviderEnabled(
      { providers: { openai: false, deepseek: true } },
      "openai",
    ),
    false,
  );
  assert.deepEqual(
    enabledProvidersForTeam({
      providers: {
        openai: false,
        anthropic: false,
        google: false,
        xai: false,
        deepseek: true,
      },
    }),
    ["deepseek"],
  );
  assert.equal(isGdprSafeModeEnabled({ gdprSafeMode: true }), true);
  assert.equal(isByokProviderRestrictedInGdprSafeMode("deepseek"), true);
  assert.equal(isByokProviderRestrictedInGdprSafeMode("custom"), false);
  assert.equal(
    resolveTeamProviderEnabled(
      { gdprSafeMode: true, providers: { deepseek: true } },
      "deepseek",
    ),
    false,
  );
  assert.deepEqual(
    enabledProvidersForTeam({
      gdprSafeMode: true,
      providers: { openai: true, deepseek: true, moonshot: true },
    }),
    ["openai", "anthropic", "google", "xai"],
  );

  const { shouldBlockAiDueToByokProvider } = loadTs(
    "src/lib/byokSelectedProviderGate.ts",
  );
  assert.equal(
    shouldBlockAiDueToByokProvider(
      { storePlanId: "BYOK", byokProviderFlags: [] },
      "gateway",
    ),
    false,
  );
  assert.equal(
    shouldBlockAiDueToByokProvider(
      {
        storePlanId: "BYOK",
        byokProviderFlags: [{ provider: "gateway", enabled: true }],
      },
      "openai",
    ),
    false,
  );
});

test("AI model mention labels resolve to a base model option", () => {
  const { resolveAiImageModelMention, resolveAiModelMention } = loadTs(
    "src/lib/aiModelOptions.ts",
  );

  const resolved = resolveAiModelMention("Opus 5");
  assert.equal(resolved.definition.key, "claude-opus-5");
  assert.equal(resolved.modelOption.id, "claude-opus-5-instant");

  assert.equal(
    resolveAiImageModelMention("Nano Banana").gatewayModel,
    "google/gemini-3-pro-image",
  );
  assert.equal(
    resolveAiImageModelMention("GPT Image").gatewayModel,
    "openai/gpt-image-1",
  );
});

test("disabled provider selections fall back and gateway-only models keep full slugs", async () => {
  resetModules();
  stubPlan();
  process.env.AI_GATEWAY_API_KEY = "vck_default_gateway_key";
  delete process.env.AI_GATEWAY_ENABLED;

  let settings = { providers: { openai: false, anthropic: true } };
  stubModule("src/lib/prisma.ts", {
    default: {
      project: {
        findFirst: async () => ({
          teamId: "team_provider_gate",
          team: { aiProviderSettings: settings },
        }),
      },
      team: {
        findUnique: async () => ({ aiProviderSettings: settings }),
      },
      teamByokApiKey: {
        findUnique: async ({ where }) =>
          where.teamId_provider.provider === "gateway"
            ? { enabled: true, ciphertext: "vck_team_provider_gate" }
            : null,
      },
    },
  });
  stubModule("src/lib/crypto/byokCipher.ts", {
    decryptByokSecret: (ciphertext) => ciphertext,
  });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", {
    getProjectWhere: () => ({}),
    taskWriteAccessWhere: () => ({}),
  });

  const { selectTaskWriterModel } = loadTs("src/app/api/ai/_lib/editorAi.ts");
  const fallback = await selectTaskWriterModel({
    sourceSelected: "openai",
    modelOptionId: "gpt-5.6-luna",
    projectId: 4338,
    userId: 1000,
  });
  assert.equal(fallback.provider, "claude");
  assert.equal(fallback.modelId, "claude-haiku-4.5");

  settings = {
    providers: { openai: false, anthropic: false, google: false, xai: false },
  };
  await assert.rejects(
    selectTaskWriterModel({
      sourceSelected: "openai",
      modelOptionId: "gpt-5.6-luna",
      projectId: 4338,
      userId: 1000,
    }),
    /No AI providers are enabled for this team/,
  );

  settings = { providers: { deepseek: true } };
  const gatewayOnly = await selectTaskWriterModel({
    sourceSelected: "gateway",
    modelOptionId: "deepseek-v4-flash",
    projectId: 4338,
    userId: 1000,
  });
  assert.equal(gatewayOnly.provider, "gateway");
  assert.equal(gatewayOnly.modelId, "deepseek/deepseek-v4-flash");
  assert.equal(gatewayOnly.model.config.provider, "gateway");

  settings = { providers: { xai: true } };
  const grok = await selectTaskWriterModel({
    sourceSelected: "gateway",
    modelOptionId: "grok-4.20-thinking",
    projectId: 4338,
    userId: 1000,
  });
  assert.equal(grok.provider, "gateway");
  assert.equal(grok.modelId, "xai/grok-4.20-reasoning");
  assert.equal(grok.model.config.provider, "gateway");
  assert.equal(grok.providerOptions?.openai, undefined);
});

test("provider key routes a gateway catalog model direct before team and platform gateway keys", async () => {
  resetModules();
  stubPlan();
  const directKey = "sk-deepseek-team-key";
  const teamGatewayKey = "vck_team_gateway_key";
  process.env.AI_GATEWAY_API_KEY = "vck_platform_gateway_key";

  const findUniqueCalls = [];
  stubModule("src/lib/prisma.ts", {
    default: {
      project: {
        findFirst: async () => ({
          teamId: "team_direct_deepseek",
          team: { aiProviderSettings: { providers: { deepseek: true } } },
        }),
      },
      team: {
        findUnique: async () => ({
          aiProviderSettings: { providers: { deepseek: true } },
        }),
      },
      teamByokApiKey: {
        findUnique: async (args) => {
          findUniqueCalls.push(args);
          const provider = args.where.teamId_provider.provider;
          if (provider === "deepseek") {
            return { enabled: true, ciphertext: directKey };
          }
          if (provider === "gateway") {
            return { enabled: true, ciphertext: teamGatewayKey };
          }
          return null;
        },
      },
    },
  });
  stubModule("src/lib/crypto/byokCipher.ts", {
    decryptByokSecret: (ciphertext) => ciphertext,
  });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", {
    getProjectWhere: () => ({}),
    taskWriteAccessWhere: () => ({}),
  });

  const { selectTaskWriterModel } = loadTs("src/app/api/ai/_lib/editorAi.ts");
  const selected = await selectTaskWriterModel({
    sourceSelected: "gateway",
    modelOptionId: "deepseek-v4-flash",
    projectId: 4390,
    userId: 1000,
  });

  assert.deepEqual(
    findUniqueCalls.map((call) => call.where),
    [
      {
        teamId_provider: {
          teamId: "team_direct_deepseek",
          provider: "deepseek",
        },
      },
    ],
  );
  assert.equal(selected.model.config.provider, "openai.chat");
  assert.equal(
    selected.model.config.url({ path: "/chat/completions" }),
    "https://api.deepseek.com/chat/completions",
  );
  const headers = await selected.model.config.headers();
  assert.equal(headers.authorization, `Bearer ${directKey}`);
  assert.notEqual(headers.authorization, `Bearer ${teamGatewayKey}`);
  assert.notEqual(headers.authorization, "Bearer vck_platform_gateway_key");
});

test("task writer key lookup ignores caller teamId when project lookup resolves a different team", async () => {
  resetModules();
  stubPlan();
  const projectGatewayKey = "vck_project_team_gateway_key";
  const attackerGatewayKey = "vck_attacker_team_gateway_key";
  const projectId = 3855;
  const userId = 1000;
  const projectTeamId = "project_team";
  const callerTeamId = "attacker_team";
  const findUniqueCalls = [];

  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.AI_GATEWAY_ENABLED;

  stubModule("src/lib/prisma.ts", {
    default: {
      project: {
        findFirst: async ({ where, select }) => {
          assert.equal(where.id, projectId);
          assert.equal(select.teamId, true);
          return { teamId: projectTeamId };
        },
      },
      teamByokApiKey: {
        findUnique: async (args) => {
          findUniqueCalls.push(args);
          const teamId = args.where.teamId_provider.teamId;
          const provider = args.where.teamId_provider.provider;
          if (provider !== "gateway") return null;
          return {
            enabled: true,
            ciphertext:
              teamId === callerTeamId ? attackerGatewayKey : projectGatewayKey,
          };
        },
      },
    },
  });
  stubModule("src/lib/crypto/byokCipher.ts", {
    decryptByokSecret: (ciphertext) => ciphertext,
  });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", {
    getProjectWhere: () => ({}),
    taskWriteAccessWhere: () => ({}),
  });

  const { selectTaskWriterModel } = loadTs("src/app/api/ai/_lib/editorAi.ts");

  const selected = await selectTaskWriterModel({
    sourceSelected: "openai",
    modelSelected: "gpt-5.5",
    byokProviderFlags: [],
    teamId: callerTeamId,
    projectId,
    userId,
    feature: "task-writer",
  });

  assert.deepEqual(
    findUniqueCalls.map((call) => call.where),
    [
      { teamId_provider: { teamId: projectTeamId, provider: "openai" } },
      { teamId_provider: { teamId: projectTeamId, provider: "gateway" } },
    ],
  );

  const headers = await selected.model.config.headers();
  assert.equal(headers.authorization, `Bearer ${projectGatewayKey}`);
  assert.notEqual(headers.authorization, `Bearer ${attackerGatewayKey}`);
});

test("custom instruction upload uses the authenticated project team over caller teamId", async () => {
  resetModules();
  stubPlan();
  const projectGatewayKey = "vck_project_team_gateway_key";
  const attackerGatewayKey = "vck_attacker_team_gateway_key";
  const projectId = 3856;
  const userId = 1000;
  const projectTeamId = "project_team";
  const callerTeamId = "attacker_team";
  const findUniqueCalls = [];
  const upsertedRows = [];
  const originalFetch = global.fetch;

  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.AI_GATEWAY_ENABLED;

  global.fetch = async () => ({
    ok: true,
    headers: { get: () => "text/plain" },
    text: async () => "Use the authenticated project team.",
  });

  stubModule("src/lib/prisma.ts", {
    default: {
      project: {
        findFirst: async ({ where, select }) => {
          assert.equal(where.id, projectId);
          assert.equal(select.teamId, true);
          return { id: projectId, teamId: projectTeamId };
        },
      },
      teamByokApiKey: {
        findUnique: async (args) => {
          findUniqueCalls.push(args);
          const teamId = args.where.teamId_provider.teamId;
          return {
            enabled: true,
            ciphertext:
              teamId === callerTeamId ? attackerGatewayKey : projectGatewayKey,
          };
        },
      },
    },
  });
  stubModule("src/lib/crypto/byokCipher.ts", {
    decryptByokSecret: (ciphertext) => ciphertext,
  });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", {
    getProjectWhere: () => ({}),
    taskWriteAccessWhere: () => ({}),
  });
  stubModule("src/utils/controllers/turbopuffer/turbopufferHelper.ts", {
    buildCustomInstructionFileRows: (args) => [
      {
        id: `${args.projectId}:0`,
        projectId: args.projectId,
        teamId: args.teamId,
        source: args.source,
        fileName: args.fileName,
        fileType: args.fileType,
        content: args.content,
        searchText: args.content,
        chunkIndex: 0,
        updatedAt: new Date(0).toISOString(),
      },
    ],
    deleteCustomInstructionFileInTurbopuffer: async () => {},
    searchCustomInstructionFiles: async () => [],
    upsertCustomInstructionFileRowsToTurbopuffer: async (rows) => {
      upsertedRows.push(...rows);
    },
  });

  try {
    const { uploadCustomInstructionFiles } = loadTs(
      "src/app/api/ai/_lib/customInstructions.ts",
    );

    await uploadCustomInstructionFiles({
      userId,
      projectId,
      teamId: callerTeamId,
      urls: ["https://example.com/instructions.txt"],
    });
  } finally {
    global.fetch = originalFetch;
  }

  assert.deepEqual(
    findUniqueCalls.map((call) => call.where),
    [{ teamId_provider: { teamId: projectTeamId, provider: "openai" } }],
  );
  assert.equal(upsertedRows.length, 1);
  assert.equal(upsertedRows[0].teamId, projectTeamId);
  assert.notEqual(upsertedRows[0].teamId, callerTeamId);
});
