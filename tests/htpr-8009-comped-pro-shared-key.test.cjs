const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/loadModule.cjs");

const sharedKey = "vck_shared_platform_key";
const compedPro = { compedUntil: new Date(Date.now() + 86_400_000), compedPlan: "Pro" };

function loadKeys(plan, rows, team) {
  return loadModule("src/app/api/ai/_lib/byokKeys.ts", {
    "@/lib/prisma": { default: {
      teamByokApiKey: {
        findUnique: async ({ where }) => rows[where.teamId_provider.provider] ?? null,
        deleteMany: async () => ({ count: 0 }),
      },
      team: { findUnique: async () => team },
    } },
    "@/lib/crypto/byokCipher": { decryptByokSecret: (ciphertext) => ciphertext },
    "@/app/api/ai/_lib/planGate": {
      backgroundClaudeModelEnabled: async () => false,
      haiku55ModelEnabled: async () => false,
      storePlanIdForProject: async () => plan,
    },
    "@/app/api/ai/_lib/modelProvider": {
      isVercelAiGatewayKey: (key) => typeof key === "string" && key.startsWith("vck_"),
      gatewayFundingSourceForApiKey: () => "customer",
      registerManagedGatewayKey: () => {},
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

const previousShared = process.env.AI_GATEWAY_API_KEY;
test.beforeEach(() => { process.env.AI_GATEWAY_API_KEY = sharedKey; });
test.after(() => {
  if (previousShared === undefined) delete process.env.AI_GATEWAY_API_KEY;
  else process.env.AI_GATEWAY_API_KEY = previousShared;
});

test("a comped Pro team with no key of its own is funded from the shared key", async () => {
  const keys = loadKeys("Pro", {}, compedPro);
  assert.deepEqual(await keys.getTeamGatewayFunding({ trustedTeamId: "comped-pro" }), {
    apiKey: sharedKey,
    source: "shared",
  });
});

test("a Pro team that is not comped keeps no funding when it has no key", async () => {
  const keys = loadKeys("Pro", {}, { compedUntil: null, compedPlan: null });
  assert.equal(await keys.getTeamGatewayFunding({ trustedTeamId: "paid-pro" }), undefined);
});

test("an expired comp does not fund a Pro team from the shared key", async () => {
  const keys = loadKeys("Pro", {}, { compedUntil: new Date(Date.now() - 86_400_000), compedPlan: "Pro" });
  assert.equal(await keys.getTeamGatewayFunding({ trustedTeamId: "expired-comp" }), undefined);
});

test("a comped BYOK team falls back to the shared key through its own plan", async () => {
  const keys = loadKeys("BYOK", {}, { compedUntil: new Date(Date.now() + 86_400_000), compedPlan: "BYOK" });
  assert.deepEqual(await keys.getTeamGatewayFunding({ trustedTeamId: "comped-byok" }), {
    apiKey: sharedKey,
    source: "shared",
  });
});

test("a disabled per-team managed key is never replaced by the shared key", async () => {
  const keys = loadKeys("Pro", {
    managed_gateway: row("managed-row", "vck_disabled_managed", false, "2026-02-03T00:00:00Z"),
  }, compedPro);
  assert.equal(await keys.getTeamGatewayFunding({ trustedTeamId: "comped-pro" }), undefined);
});

test("a comped Pro team with its own gateway key keeps that key", async () => {
  const own = "vck_real_customer_gateway";
  const keys = loadKeys("Pro", {
    gateway: row("customer-row", own, true, "2026-02-02T00:00:00Z"),
  }, compedPro);
  assert.deepEqual(await keys.getTeamGatewayFunding({ trustedTeamId: "comped-pro" }), {
    apiKey: own,
    source: "customer",
  });
});

test("no shared key configured leaves a comped Pro team unfunded", async () => {
  delete process.env.AI_GATEWAY_API_KEY;
  const keys = loadKeys("Pro", {}, compedPro);
  assert.equal(await keys.getTeamGatewayFunding({ trustedTeamId: "comped-pro" }), undefined);
});
