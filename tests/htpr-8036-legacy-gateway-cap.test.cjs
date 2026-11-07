const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

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
  stubModule("src/lib/flags.ts", { isFeatureEnabled: async () => false });
  stubModule("src/app/api/ai/_lib/planAllowancePolicy.ts", {
    teamPlanAllowanceEnabled: async () => false,
  });
  stubModule("src/app/api/ai/_lib/planGate.ts", {
    assertImageModelAllowedForPlan: async () => {},
    assertModelAllowedForPlan: async () => {},
    haiku55ModelEnabled: async () => false,
    storePlanIdForProject: async () => plan,
  });
}

function installAiStub() {
  const ai = require("ai");
  require.cache[require.resolve("ai")].exports = {
    ...ai,
    createGateway: () => (slug) => ({ raw: true, modelId: slug, provider: "gateway" }),
    wrapLanguageModel: (options) => ({
      capped: options.providerId === "gateway" || options.model?.capped === true,
      raw: options.model?.raw === true,
      modelId: options.model?.modelId,
    }),
  };
}

function loadPair() {
  installAiStub();
  const jiti = require("jiti")(path.join(root, `tests/jiti-entry-${++jitiEntryId}.cjs`), {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  });
  return {
    keys: jiti(path.join(root, "src/app/api/ai/_lib/byokKeys.ts")),
    models: jiti(path.join(root, "src/app/api/ai/_lib/modelProvider.ts")),
  };
}

function stubKeys(plan, rows) {
  stubPlan(plan);
  stubModule("src/lib/prisma.ts", {
    default: {
      teamByokApiKey: {
        findUnique: async ({ where }) => rows[where.teamId_provider.provider] ?? null,
        deleteMany: async () => ({ count: 0 }),
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
}

test("a paid team old gateway row that stores our managed key hits the cap", async () => {
  const key = "vck_legacy_same_as_managed";
  const previous = process.env.AI_GATEWAY_API_KEY;
  process.env.AI_GATEWAY_API_KEY = "vck_shared_not_this_team";
  stubKeys("Pro", {
    gateway: { id: "legacy-row", enabled: true, ciphertext: key, updatedAt: new Date("2026-01-02T00:00:00Z") },
    managed_gateway: { id: "managed-row", enabled: true, ciphertext: key, updatedAt: new Date("2026-03-04T00:00:00Z") },
  });
  try {
    const { keys, models } = loadPair();
    assert.equal(models.gatewayFundingSourceForApiKey(key), "customer");
    const funding = await keys.getTeamGatewayFunding({ trustedTeamId: "paid-team" }, { includeProvenance: true });
    assert.deepEqual(funding, {
      apiKey: key,
      source: "managed",
      managedKeyId: "managed-row",
      managedKeyUpdatedAt: "2026-03-04T00:00:00.000Z",
    });
    assert.equal(models.gatewayFundingSourceForApiKey(key), "managed");
    const capped = models.resolveGatewayModel("openai/gpt-6-luna", funding.apiKey, funding.source);
    assert.equal(capped.capped, true);
  } finally {
    if (previous === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = previous;
  }
});

test("a different customer gateway key stays uncapped", async () => {
  const customer = "vck_real_customer_gateway";
  const managed = "vck_our_managed_gateway";
  const previous = process.env.AI_GATEWAY_API_KEY;
  process.env.AI_GATEWAY_API_KEY = "vck_shared_not_the_customer";
  stubKeys("BYOK", {
    gateway: { id: "customer-row", enabled: true, ciphertext: customer, updatedAt: new Date("2026-02-02T00:00:00Z") },
    managed_gateway: { id: "managed-row", enabled: true, ciphertext: managed, updatedAt: new Date("2026-02-03T00:00:00Z") },
  });
  const { keys, models } = loadPair();
  const funding = await keys.getTeamGatewayFunding({ trustedTeamId: "byok-team" });
  assert.deepEqual(funding, { apiKey: customer, source: "customer" });
  const raw = models.resolveGatewayModel("openai/gpt-6-luna", funding.apiKey, funding.source);
  assert.equal(raw.capped, false);
  if (previous === undefined) delete process.env.AI_GATEWAY_API_KEY;
  else process.env.AI_GATEWAY_API_KEY = previous;
});

test("a disabled managed key copied into an old row is not served uncapped", async () => {
  const key = "vck_disabled_managed";
  stubKeys("Pro", {
    gateway: { id: "legacy-row", enabled: true, ciphertext: key, updatedAt: new Date("2026-02-02T00:00:00Z") },
    managed_gateway: { id: "managed-row", enabled: false, ciphertext: key, updatedAt: new Date("2026-02-03T00:00:00Z") },
  });
  const { keys } = loadPair();
  assert.equal(await keys.getTeamGatewayFunding({ trustedTeamId: "paid-team" }), undefined);
});

test("an old row that holds a platform key and no managed row is capped", async () => {
  const key = "vck_platform_leftover";
  const previous = process.env.GATEWAY_KEY_HYPERTASK;
  const previousShared = process.env.AI_GATEWAY_API_KEY;
  process.env.GATEWAY_KEY_HYPERTASK = key;
  process.env.AI_GATEWAY_API_KEY = "vck_shared_not_the_platform_key";
  stubKeys("Pro", {
    gateway: { id: "legacy-row", enabled: true, ciphertext: key, updatedAt: new Date("2026-05-01T00:00:00Z") },
  });
  try {
    const { keys, models } = loadPair();
    const funding = await keys.getTeamGatewayFunding({ trustedTeamId: "paid-team" }, { includeProvenance: true });
    assert.equal(funding.source, "managed");
    assert.equal(funding.apiKey, key);
    assert.equal(funding.managedKeyId, "legacy-row");
    assert.equal(models.resolveGatewayModel("openai/gpt-6-luna", key, "managed").capped, true);
    assert.equal(models.resolveGatewayModel("openai/gpt-6-luna", "vck_unregistered", "managed").capped, true);
    assert.equal(models.gatewayFundingSourceForApiKey("vck_unregistered"), "customer");
  } finally {
    if (previous === undefined) delete process.env.GATEWAY_KEY_HYPERTASK;
    else process.env.GATEWAY_KEY_HYPERTASK = previous;
    if (previousShared === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = previousShared;
  }
});

test("a customer key in an old provider slot still wins when it is not ours", async () => {
  stubKeys("BYOK", {
    openai: { id: "customer-openai", enabled: true, ciphertext: "vck_customer_openai_slot", updatedAt: new Date("2026-01-01T00:00:00Z") },
  });
  const { keys } = loadPair();
  assert.equal(
    await keys.getTeamGatewayApiKey({ trustedTeamId: "byok-team" }),
    "vck_customer_openai_slot",
  );
  assert.equal(
    (await keys.getTeamGatewayFunding({ trustedTeamId: "byok-team" })).source,
    "customer",
  );
});
