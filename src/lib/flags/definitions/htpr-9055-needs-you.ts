import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9055_NEEDS_YOU_FLAG = "htpr-9055-needs-you";

export default {
  key: HTPR_9055_NEEDS_YOU_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-11",
  description: "Needs you ranks inbox tickets by stored Jev scores and simple rules. Own-AI-account teams are skipped.",
  releaseRisk: { risk: "small", reason: "Read-only ranking in an existing tab. No notices are archived or changed by ranking; rules handle Jev outages." },
} as const satisfies FeatureFlagDefinition;
