import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7730_DEEPSEEK_FLASH_FAST_FLAG = "htpr-7730-deepseek-flash-fast";

export default {
  key: HTPR_7730_DEEPSEEK_FLASH_FAST_FLAG,
  kind: "feature",
  shippedOn: "2026-10-24",
  defaultMode: "EVERYONE",
  description:
    "Adds DeepSeek V4.1 Flash Fast through AI Gateway. Off hides the option and uses the plan default for saved or requested choices.",
  releaseRisk: {
    risk: "small",
    reason: "Adds one optional gateway model without changing existing models or defaults.",
  },
} as const satisfies FeatureFlagDefinition;
