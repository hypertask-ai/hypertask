import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7322_AGENT_FEATURE_DISCOVERY_FLAG = "htpr-7322-agent-feature-discovery";

export default {
  key: HTPR_7322_AGENT_FEATURE_DISCOVERY_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-21",
  description:
    "Lets agents discover available product features and warns when an agent creates a page that duplicates a built-in destination.",
  releaseRisk: {
    risk: "small",
    reason:
      "Adds a read-only catalog and nonblocking page warnings; disabling it stops catalog reads and warnings without changing page creation.",
  },
} as const satisfies FeatureFlagDefinition;
