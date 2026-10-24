import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7730_DEEPSEEK_FLASH_FAST_FLAG = "htpr-7730-deepseek-flash-fast";

export default {
  key: HTPR_7730_DEEPSEEK_FLASH_FAST_FLAG,
  kind: "feature",
  shippedOn: "2026-10-24",
  defaultMode: "OWNER_AND_QA",
  description:
    "Adds DeepSeek V4.1 Flash Fast through AI Gateway. Off hides the option and uses the plan default for saved or requested choices.",
  releaseRisk: {
    risk: "new",
    reason: "Adds one optional gateway model that costs about 8 times DeepSeek V4.1 Flash and draws on the team's AI allowance; existing models and defaults are unchanged.",
    highRisk: "money",
  },
} as const satisfies FeatureFlagDefinition;
