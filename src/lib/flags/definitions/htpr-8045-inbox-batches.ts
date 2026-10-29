import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8045_INBOX_BATCHES_FLAG = "htpr-8045-inbox-batches";

export default {
  key: HTPR_8045_INBOX_BATCHES_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-26",
  description: "AI chat pages through the whole inbox and archives only a listed, confirmed batch, naming every cleared ticket and sibling message.",
  releaseRisk: {
    risk: "small",
    reason: "Inbox archives are reversible. Expiring list receipts and exact cross-message previews refuse changed batches; Off restores the existing tools.",
  },
} as const satisfies FeatureFlagDefinition;
