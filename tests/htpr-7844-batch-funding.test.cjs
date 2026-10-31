const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/loadModule.cjs");

for (const scenario of ["team-error", "key-error", "flag-error", "denied", "allowed"]) {
  test(`fresh batch funding: ${scenario}`, async () => {
    const updates = [];
    const providerCalls = [];
    const failure = new Error("database unavailable");
    const batch = {
      id: "batch", gatewayBatchId: "gateway-batch", kind: "other", teamId: "team",
      userId: 1, model: "model", items: {}, createdAt: new Date(),
    };
    const prisma = {
      team: { findUnique: async () => {
        if (scenario === "team-error") throw failure;
        return { aiKeyOnly: scenario !== "allowed", aiKeyOnlyPlatformServices: false, aiProviderSettings: null, googleAccount: { userId: 42 } };
      } },
      teamByokApiKey: { findMany: async () => {
        if (scenario === "key-error") throw failure;
        return [];
      } },
      aiBatch: {
        findMany: async () => [batch],
        update: async ({ data }) => { updates.push(data); },
        updateMany: async ({ data }) => { updates.push(data); return { count: 1 }; },
      },
      slackWatchedThread: { findMany: async () => [] },
    };
    const stubs = {
      "@/lib/prisma": { default: prisma },
      "@/lib/flags": { isFeatureEnabled: async () => {
        if (scenario === "flag-error") throw failure;
        return true;
      } },
      "@/lib/crypto/byokCipher": { decryptByokSecret: (value) => value },
      "@/app/api/ai/_lib/planGate": { storePlanIdForProject: async () => "Free" },
      "@/app/api/ai/_lib/modelProvider": { isVercelAiGatewayKey: (key) => key?.startsWith("vck_") },
      "@/utils/controllers/projects/getAllIncludes": {},
      "@/app/api/ai/_lib/aiUsage": {},
      "@/app/api/ai/_lib/sharedAllowance": {},
      "@/lib/ai/batch/gatewayBatch": {
        gatewayBatchState: async (...args) => { providerCalls.push(args); return "pending"; },
        cancelGatewayBatch: async () => { throw new Error("Unexpected cancellation"); },
      },
      "@/lib/ai/labelClassifier": {},
      "@/lib/configs/general.config": { generalConfig: {} },
      "@/lib/slack/threadSummary": {},
      "@/utils/controllers/comments/createCommentService": {},
    };
    const previousKey = process.env.AI_GATEWAY_API_KEY;
    process.env.AI_GATEWAY_API_KEY = "vck_batch_fixture";
    try {
      const result = await loadModule("src/lib/ai/batch/collectBatches.ts", stubs).collectBatches();
      assert.equal(result.cancelled, scenario === "denied" ? 1 : 0);
      assert.equal(result.completed, 0);
      assert.deepEqual(updates.filter((update) => update.status).map((update) => update.status),
        scenario === "denied" ? ["applying", "cancelled"] : []);
      assert.deepEqual(providerCalls, scenario === "allowed" ? [["vck_batch_fixture", "gateway-batch"]] : []);
    } finally {
      if (previousKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
      else process.env.AI_GATEWAY_API_KEY = previousKey;
    }
  });
}
