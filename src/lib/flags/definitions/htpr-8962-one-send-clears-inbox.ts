import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8962_ONE_SEND_CLEARS_INBOX_FLAG = "htpr-8962-one-send-clears-inbox";

export default {
  key: HTPR_8962_ONE_SEND_CLEARS_INBOX_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-10",
  description:
    "The desktop comment box has one Send on the right. For a task in your inbox, Send also removes your inbox entry because you have now seen it. The discard draft trash moves to the far left as a quiet icon.",
  releaseRisk: {
    risk: "small",
    reason:
      "Reuses the existing comment send and inbox entry archive. The task itself is never archived, and Off restores the Send + button.",
  },
} as const satisfies FeatureFlagDefinition;
