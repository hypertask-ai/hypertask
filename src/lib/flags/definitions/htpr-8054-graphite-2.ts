import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8054_GRAPHITE_2_FLAG = "htpr-8054-graphite-2";

export default {
  key: HTPR_8054_GRAPHITE_2_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-26",
  description: "Adds Graphite 2 with the approved grey palette, IBM Plex typography and Iconoir rail icons. Existing themes stay unchanged.",
  releaseRisk: {
    risk: "small",
    reason: "One optional theme; switching off restores existing theme choices.",
  },
} as const satisfies FeatureFlagDefinition;
