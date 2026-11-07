const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/loadModule.cjs");

const definition = loadModule("src/lib/flags/definitions/htpr-8100-no-paid-fallback.ts");

function guardWithFunding(fundingFor) {
  return loadModule("src/lib/ai/modelFundingGuard.ts", {
    "@/app/api/ai/_lib/modelProvider": { gatewayFundingSourceForApiKey: fundingFor },
  });
}

test("the flag is a bugfix money flag that starts at Owner and QA with a release-risk entry", () => {
  assert.equal(definition.HTPR_8100_NO_PAID_FALLBACK_FLAG, "htpr-8100-no-paid-fallback");
  assert.equal(definition.default.key, "htpr-8100-no-paid-fallback");
  assert.equal(definition.default.kind, "bugfix");
  assert.equal(definition.default.defaultMode, "OWNER_AND_QA");
  assert.equal(definition.default.shippedOn, "2026-11-03");
  assert.equal(definition.default.releaseRisk.highRisk, "money");
  assert.equal(definition.default.releaseRisk.risk, "small");
  assert.ok(definition.default.releaseRisk.reason.trim().length > 0);
  assert.deepEqual(Array.from(definition.default.related), ["htpr-7075-background-claude"]);
  assert.ok(definition.default.description.trim().length > 0);
});

test("a fallback paid by our own shared gateway key is refused", () => {
  const guard = guardWithFunding((apiKey) => apiKey === "vck_shared_platform_key" ? "shared" : "customer");
  assert.equal(guard.fallbackRunsOnOurOwnGatewayKey("vck_shared_platform_key"), true);
});

test("a team's own key keeps its fallback", () => {
  const guard = guardWithFunding((apiKey) => {
    if (apiKey === "vck_shared_platform_key") return "shared";
    if (apiKey === "vck_managed_team_key") return "managed";
    return "customer";
  });
  assert.equal(guard.fallbackRunsOnOurOwnGatewayKey("vck_managed_team_key"), false);
  assert.equal(guard.fallbackRunsOnOurOwnGatewayKey("sk-team-own-key"), false);
  assert.equal(guard.fallbackRunsOnOurOwnGatewayKey({ kind: "baseten", apiKey: "x", modelKey: "y" }), false);
  assert.equal(guard.fallbackRunsOnOurOwnGatewayKey(undefined), false);
});
