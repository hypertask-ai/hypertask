import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8146_SETTINGS_NAME_FLAG = "htpr-8146-settings-name";

export default {
  key: HTPR_8146_SETTINGS_NAME_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-29",
  description: "Names the existing Settings button for screen readers without changing its appearance.",
  releaseRisk: {
    risk: "small",
    reason: "Only adds an accessible name to the rail gear; Off restores its previous markup.",
  },
} as const satisfies FeatureFlagDefinition;
