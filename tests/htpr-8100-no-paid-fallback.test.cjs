const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
  fsCache: false,
});

const definition = jiti(path.join(root, "src/lib/flags/definitions/htpr-8100-no-paid-fallback.ts"));

function guardWithFunding(fundingFor) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, "src/lib/ai/modelFundingGuard.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(code, {
    module: loaded,
    exports: loaded.exports,
    require: (id) => id === "@/app/api/ai/_lib/modelProvider"
      ? { gatewayFundingSourceForApiKey: fundingFor }
      : require(id),
  }, { filename: path.join(root, "src/lib/ai/modelFundingGuard.ts") });
  return loaded.exports;
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
  const stubbed = guardWithFunding((apiKey) => apiKey === "vck_shared_platform_key" ? "shared" : "customer");
  assert.equal(stubbed.fallbackRunsOnOurOwnGatewayKey("vck_shared_platform_key"), true);
});

test("a team's own key keeps its fallback", () => {
  const stubbed = guardWithFunding((apiKey) => {
    if (apiKey === "vck_shared_platform_key") return "shared";
    if (apiKey === "vck_managed_team_key") return "managed";
    return "customer";
  });
  assert.equal(stubbed.fallbackRunsOnOurOwnGatewayKey("vck_managed_team_key"), false);
  assert.equal(stubbed.fallbackRunsOnOurOwnGatewayKey("sk-team-own-key"), false);
  assert.equal(stubbed.fallbackRunsOnOurOwnGatewayKey({ kind: "baseten", apiKey: "x", modelKey: "y" }), false);
  assert.equal(stubbed.fallbackRunsOnOurOwnGatewayKey(undefined), false);
});
