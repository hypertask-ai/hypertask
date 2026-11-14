const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/loadModule.cjs");

const registered = [];

function loadKeys(plan, rows) {
  return loadModule("src/app/api/ai/_lib/byokKeys.ts", {
    "@/lib/prisma": { default: { teamByokApiKey: {
      findUnique: async ({ where }) => rows[where.teamId_provider.provider] ?? null,
      deleteMany: async () => ({ count: 0 }),
    } } },
    "@/lib/crypto/byokCipher": { decryptByokSecret: (ciphertext) => ciphertext },
    "@/app/api/ai/_lib/planGate": {
      backgroundClaudeModelEnabled: async () => false,
      haiku55ModelEnabled: async () => false,
      storePlanIdForProject: async () => plan,
    },
    "@/app/api/ai/_lib/modelProvider": {
      isVercelAiGatewayKey: (key) => typeof key === "string" && key.startsWith("vck_"),
      registerManagedGatewayKey: (key) => { registered.push(key); },
      resolveAiModel: () => undefined,
      inheritAiModelUsage: () => undefined,
      configureAiModelUsage: () => undefined,
      aiUsageProviderForCredential: () => undefined,
      providerOptionsForAiModel: () => undefined,
    },
    "@/lib/ai/modelFundingGuard": { fallbackRunsOnOurOwnGatewayKey: () => false },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
    "@/lib/aiModelOptions": { getAiModelDefinition: () => undefined, getAiModelOptionById: () => undefined, isHaiku55Model: () => false },
    "@/lib/aiProviders": {
      BASETEN_MODEL_SLUGS: [], getAiProviderInfo: () => undefined,
      isByokProviderRestrictedInGdprSafeMode: () => false, isGdprSafeModeEnabled: () => false, resolveTeamProviderEnabled: () => false,
    },
    "@/lib/ai/customEndpoint": { parseCustomEndpointConfig: () => null },
    "@/app/api/ai/chat/stream/modelFallback": { previousModelForFailedStream: () => undefined },
  });
}

function row(id, ciphertext, enabled, updatedAt) {
  return { id, enabled, ciphertext, updatedAt: new Date(updatedAt), team: { aiProviderSettings: null } };
}

test("legacy gateway rows classify our keys as capped and leave customer keys alone", async () => {
  const previousShared = process.env.AI_GATEWAY_API_KEY;
  const previousPlatform = process.env.GATEWAY_KEY_HYPERTASK;
  const team = { trustedTeamId: "paid-team" };
  try {
    process.env.AI_GATEWAY_API_KEY = "vck_shared_not_this_team";
    delete process.env.GATEWAY_KEY_HYPERTASK;
    const same = "vck_legacy_same_as_managed";
    const sameKeys = loadKeys("Pro", {
      gateway: row("legacy-row", same, true, "2026-01-02T00:00:00Z"),
      managed_gateway: row("managed-row", same, true, "2026-03-04T00:00:00Z"),
    });
    const sameFunding = await sameKeys.getTeamGatewayFunding(team, { includeProvenance: true });
    assert.equal(sameFunding.source, "managed");
    assert.equal(sameFunding.managedKeyId, "managed-row");

    const customer = "vck_real_customer_gateway";
    const customerKeys = loadKeys("BYOK", {
      gateway: row("customer-row", customer, true, "2026-02-02T00:00:00Z"),
      managed_gateway: row("managed-row", "vck_our_managed_gateway", true, "2026-02-03T00:00:00Z"),
    });
    assert.deepEqual(await customerKeys.getTeamGatewayFunding({ trustedTeamId: "byok-team" }), { apiKey: customer, source: "customer" });

    const disabled = "vck_disabled_managed";
    const disabledKeys = loadKeys("Pro", {
      gateway: row("legacy-row", disabled, true, "2026-02-02T00:00:00Z"),
      managed_gateway: row("managed-row", disabled, false, "2026-02-03T00:00:00Z"),
    });
    assert.equal(await disabledKeys.getTeamGatewayFunding(team), undefined);

    const platform = "vck_platform_leftover";
    process.env.GATEWAY_KEY_HYPERTASK = platform;
    const platformKeys = loadKeys("Pro", { gateway: row("legacy-row", platform, true, "2026-05-01T00:00:00Z") });
    const platformFunding = await platformKeys.getTeamGatewayFunding(team);
    assert.deepEqual([platformFunding.source, platformFunding.apiKey], ["managed", platform]);

    const laterCustomer = "vck_later_customer";
    const kept = loadKeys("Pro", {
      gateway: row("gw", platform, true, "2026-05-01T00:00:00Z"),
      openai: row("oa", laterCustomer, true, "2026-06-01T00:00:00Z"),
    });
    const keptFunding = await kept.getTeamGatewayFunding(team);
    assert.deepEqual([keptFunding.source, keptFunding.apiKey], ["managed", platform]);

    registered.length = 0;
    const slot = "vck_platform_openai_slot";
    process.env.GATEWAY_KEY_HYPERTASK = slot;
    const slotKeys = loadKeys("Pro", { openai: row("customer-openai", slot, true, "2026-01-01T00:00:00Z") });
    assert.equal(await slotKeys.getByokOrTeamGatewayApiKey("openai", null, team), slot);
    assert.ok(registered.includes(slot));

    delete process.env.GATEWAY_KEY_HYPERTASK;
    const customerSlotKeys = loadKeys("BYOK", { openai: row("customer-openai", "vck_customer_openai_slot", true, "2026-01-01T00:00:00Z") });
    assert.equal((await customerSlotKeys.getTeamGatewayFunding({ trustedTeamId: "byok-team" })).source, "customer");
  } finally {
    if (previousShared === undefined) delete process.env.AI_GATEWAY_API_KEY;
    else process.env.AI_GATEWAY_API_KEY = previousShared;
    if (previousPlatform === undefined) delete process.env.GATEWAY_KEY_HYPERTASK;
    else process.env.GATEWAY_KEY_HYPERTASK = previousPlatform;
  }
});
