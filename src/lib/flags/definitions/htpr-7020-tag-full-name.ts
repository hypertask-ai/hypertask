import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7020_TAG_FULL_NAME_FLAG = "htpr-7020-tag-full-name";

export default {
  key: HTPR_7020_TAG_FULL_NAME_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-10",
  description: "Shows the full tag name on hover in task details when a long tag is truncated.",
  releaseRisk: {
    "risk": "small",
    "reason": "Hovering a tag in ticket details shows its full name in the existing tooltip."
  },
} as const satisfies FeatureFlagDefinition;
