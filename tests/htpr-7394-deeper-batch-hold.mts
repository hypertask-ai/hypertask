import {
  APPROVED_PROVIDER_CAPS_USD,
  batchEligibleWhenCapped,
  batchHoldMicroUsd,
  embeddingDecision,
  monthEndHoldUntilMs,
  nativeWebSearchAllowed,
  providerCapBlocks,
  shouldRevokeManagedKey,
} from "../src/lib/ai/spend/remainingSpend.ts";

const failures: string[] = [];
const check = (name: string, ok: boolean) => {
  if (!ok) failures.push(name);
};

check("capped shared hold", batchEligibleWhenCapped("shared", true, true));
check("capped without hold", !batchEligibleWhenCapped("shared", true, false));
check("customer never", !batchEligibleWhenCapped("customer", true, true));
check("uncapped managed", batchEligibleWhenCapped("managed", false, false));
check("uncapped shared", !batchEligibleWhenCapped("shared", false, false));
check("test cap under", !providerCapBlocks(0.009, 0.01));
check("test cap at", providerCapBlocks(0.01, 0.01));
check("demo cap", !providerCapBlocks(0.009, APPROVED_PROVIDER_CAPS_USD.demo));
check("null spend stays", !shouldRevokeManagedKey({ spendUsd30d: null, teamGone: true }));
check("zero spend gone", shouldRevokeManagedKey({ spendUsd30d: 0, teamGone: true }));
check("byok without key", embeddingDecision({ spendPathOn: true, plan: "BYOK", hasOwnKey: false, overCap: false, canCharge: true }) === "keyword");
check("byok with key", embeddingDecision({ spendPathOn: true, plan: "BYOK", hasOwnKey: true, overCap: false, canCharge: true }) === "customer-key");
check("over cap", embeddingDecision({ spendPathOn: true, plan: "Pro", hasOwnKey: false, overCap: true, canCharge: true }) === "keyword");
check("flag off", embeddingDecision({ spendPathOn: false, plan: "Pro", hasOwnKey: false, overCap: true, canCharge: false }) === "current");
check("native off on our key", !nativeWebSearchAllowed("claude", false, true));
check("native on when flag off", nativeWebSearchAllowed("claude", false, false));
const now = new Date(Date.UTC(2026, 10, 8, 21, 0, 0));
check("month end", monthEndHoldUntilMs(now) === Date.UTC(2026, 11, 1));
check("half price hold", batchHoldMicroUsd([{
  inputTokens: 1,
  outputTokens: 0,
  inputUsdPerToken: 0.000004,
  outputUsdPerToken: 0,
}]) === 2);
check("approved caps", APPROVED_PROVIDER_CAPS_USD.trials === 40
  && APPROVED_PROVIDER_CAPS_USD.hypertask === 68
  && APPROVED_PROVIDER_CAPS_USD.embeddings === 1
  && APPROVED_PROVIDER_CAPS_USD.unusedCustomerKey === 10
  && APPROVED_PROVIDER_CAPS_USD.valentinBoards === 4
  && APPROVED_PROVIDER_CAPS_USD.vetsak === 1);

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("deeper-batch-hold-ok");
