import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7919_ALLOWANCE_PERCENT_FLAG = "htpr-7919-allowance-percent";

export default {
  key: HTPR_7919_ALLOWANCE_PERCENT_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-27",
  description: "Show included AI as usage percentages, not dollar amounts, in Settings and plan copy.",
  releaseRisk: {
    risk: "small",
    highRisk: "money",
    reason: "Changes allowance wording beside paid plans. Prices, checkout, funding and enforced caps stay unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
