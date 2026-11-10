import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8977_LIGHT_QUERIES_FLAG = "htpr-8977-light-queries";

export default {
  key: HTPR_8977_LIGHT_QUERIES_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-10",
  releaseRisk: {
    risk: "new",
    reason:
      "Scoped comment counts and inbox waiting-task reads replace Prisma _count joins that scanned the whole Comment table. Responses stay identical when on.",
  },
  description: "Use indexed grouped comment counts on agent task lists, task reads, and inbox waiting tasks.",
} as const satisfies FeatureFlagDefinition;
