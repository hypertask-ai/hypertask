const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("remaining spend hold rules", () => {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
    import { APPROVED_PROVIDER_CAPS_USD, batchEligibleWhenCapped, batchHoldMicroUsd, embeddingDecision, monthEndHoldUntilMs, nativeWebSearchAllowed, providerCapBlocks, shouldRevokeManagedKey } from "./src/lib/ai/spend/remainingSpend.ts";
    const now = new Date(Date.UTC(2026, 10, 8));
    const ok = batchEligibleWhenCapped("shared", true, true) && !batchEligibleWhenCapped("shared", true, false) && !batchEligibleWhenCapped("customer", true, true) && batchEligibleWhenCapped("managed", false, false) && !batchEligibleWhenCapped("shared", false, false) && !providerCapBlocks(0.009, 0.01) && providerCapBlocks(0.01, 0.01) && !providerCapBlocks(0.009, APPROVED_PROVIDER_CAPS_USD.demo) && !shouldRevokeManagedKey({ spendUsd30d: null, teamGone: true }) && shouldRevokeManagedKey({ spendUsd30d: 0, teamGone: true }) && embeddingDecision({ spendPathOn: true, plan: "BYOK", hasOwnKey: false, overCap: false, canCharge: true }) === "keyword" && embeddingDecision({ spendPathOn: true, plan: "BYOK", hasOwnKey: true, overCap: false, canCharge: true }) === "customer-key" && embeddingDecision({ spendPathOn: true, plan: "Pro", hasOwnKey: false, overCap: true, canCharge: true }) === "keyword" && embeddingDecision({ spendPathOn: false, plan: "Pro", hasOwnKey: false, overCap: true, canCharge: false }) === "current" && !nativeWebSearchAllowed("claude", false, true) && nativeWebSearchAllowed("claude", false, false) && monthEndHoldUntilMs(now) === Date.UTC(2026, 11, 1) && batchHoldMicroUsd([{ inputTokens: 1, outputTokens: 0, inputUsdPerToken: 0.000004, outputUsdPerToken: 0 }]) === 2 && APPROVED_PROVIDER_CAPS_USD.trials === 40 && APPROVED_PROVIDER_CAPS_USD.hypertask === 68 && APPROVED_PROVIDER_CAPS_USD.embeddings === 1 && APPROVED_PROVIDER_CAPS_USD.unusedCustomerKey === 10 && APPROVED_PROVIDER_CAPS_USD.valentinBoards === 4 && APPROVED_PROVIDER_CAPS_USD.vetsak === 1;
    if (!ok) process.exit(1);
    console.log("deeper-batch-hold-ok");
  `], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  console.log(result.stdout.trim());
  const held = `${read("src/lib/ai/batch/submitBatch.ts")}\n${read("src/lib/ai/batch/collectBatches.ts")}\n${read("src/app/api/ai/_lib/editorAi.ts")}`;
  assert.match(held, /await holdPlanBatch[\s\S]*startGatewayBatch\(args\.gatewayKey[\s\S]*await settleHeldBatch[\s\S]*applySlackBatch[\s\S]*isFeatureEnabled\(HTPR_7394_REMAINING_AI_SPEND_FLAG/);
});
