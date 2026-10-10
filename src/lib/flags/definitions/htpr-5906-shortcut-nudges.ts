import type { FeatureFlagDefinition } from "../definitions";

export const SHORTCUT_NUDGES_FLAG = "htpr-5906-shortcut-nudges";

export default {
  key: SHORTCUT_NUDGES_FLAG,
  shippedOn: "2026-09-08",
  description:
    "Shows a shortcut tip on the next task page after three mouse-click notification archives in the inbox.",
  releaseRisk: {
    "risk": "new",
    "reason": "Adds a keyboard shortcut tip after repeated mouse-based inbox actions."
  },
} as const satisfies FeatureFlagDefinition;
